"""
WebSocket Broadcaster
======================
Manages all active WebSocket connections for CV analytics streaming.

Architecture:
  - CVWorker runs in a background thread (synchronous, blocking)
  - WebSocket handlers run in the async event loop
  - Bridge: CVWorker puts JSON payloads into an asyncio.Queue
  - Broadcaster coroutine reads the queue and fans out to all connected clients

One broadcaster instance per classroom (keyed by classroom_id).

Heartbeat:
  If no state changes occur, a heartbeat payload is sent every WS_HEARTBEAT_INTERVAL
  seconds so the frontend knows the connection is alive.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket, WebSocketDisconnect

from cv_analytics.config import WS_HEARTBEAT_INTERVAL

logger = logging.getLogger(__name__)


class ClassroomWSManager:
    """
    Manages WebSocket connections for a single classroom.

    Usage (in FastAPI WebSocket endpoint):
        manager = ws_broadcaster.get_manager(classroom_id)
        await manager.connect(websocket)
        try:
            await manager.listen(websocket)  # blocks until disconnect
        finally:
            await manager.disconnect(websocket)
    """

    def __init__(self, classroom_id: int, class_id_str: str):
        self.classroom_id = classroom_id
        self.class_id_str = class_id_str
        self._connections: Set[WebSocket] = set()
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._broadcaster_task: Optional[asyncio.Task] = None

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)
        logger.info(
            f"[WS] Client connected to classroom {self.classroom_id}. "
            f"Total: {len(self._connections)}"
        )
        # Start broadcaster if not already running
        if self._broadcaster_task is None or self._broadcaster_task.done():
            self._broadcaster_task = asyncio.create_task(self._broadcast_loop())

    async def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)
        logger.info(
            f"[WS] Client disconnected from classroom {self.classroom_id}. "
            f"Remaining: {len(self._connections)}"
        )

    async def listen(self, websocket: WebSocket) -> None:
        """Keep the connection alive until the client disconnects."""
        try:
            while True:
                # We don't expect client messages, but we must read to detect disconnect
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass

    def push_payload(self, payload: Dict[str, Any]) -> None:
        """
        Called from the CV worker thread (synchronous context).
        Puts a payload into the async queue without blocking.
        """
        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            # Drop oldest item to make room
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(payload)
            except Exception:
                pass

    async def _broadcast_loop(self) -> None:
        """
        Async coroutine that reads from the queue and broadcasts to all clients.
        Also emits a heartbeat every WS_HEARTBEAT_INTERVAL seconds.
        """
        logger.info(f"[WS] Broadcaster started for classroom {self.classroom_id}.")
        while True:
            try:
                try:
                    payload = await asyncio.wait_for(
                        self._queue.get(), timeout=WS_HEARTBEAT_INTERVAL
                    )
                except asyncio.TimeoutError:
                    # Heartbeat: no update from CV worker, send a keep-alive
                    payload = self._heartbeat_payload()

                if not self._connections:
                    await asyncio.sleep(0.1)
                    continue

                message = json.dumps(payload, default=str)
                dead_connections: Set[WebSocket] = set()

                for ws in list(self._connections):
                    try:
                        await ws.send_text(message)
                    except Exception:
                        dead_connections.add(ws)

                self._connections -= dead_connections

            except asyncio.CancelledError:
                logger.info(f"[WS] Broadcaster cancelled for classroom {self.classroom_id}.")
                break
            except Exception as e:
                logger.error(f"[WS] Broadcaster error: {e}")
                await asyncio.sleep(0.5)

    def _heartbeat_payload(self) -> Dict[str, Any]:
        return {
            "class_id": self.class_id_str,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": "heartbeat",
            "metrics": {"total_detected": 0, "focused_count": 0, "distracted_count": 0},
            "students": [],
        }

    def stop(self) -> None:
        if self._broadcaster_task and not self._broadcaster_task.done():
            self._broadcaster_task.cancel()


class WSBroadcaster:
    """
    Global registry of per-classroom WebSocket managers.

    Module-level singleton imported by cv_router.py.
    """

    def __init__(self):
        self._managers: Dict[int, ClassroomWSManager] = {}

    def get_manager(self, classroom_id: int) -> ClassroomWSManager:
        """Get or create the WebSocket manager for a classroom."""
        if classroom_id not in self._managers:
            self._managers[classroom_id] = ClassroomWSManager(
                classroom_id=classroom_id,
                class_id_str=str(classroom_id),
            )
        return self._managers[classroom_id]

    def remove_manager(self, classroom_id: int) -> None:
        """Stop and remove the manager when a session ends."""
        manager = self._managers.pop(classroom_id, None)
        if manager:
            manager.stop()

    def push(self, classroom_id: int, payload: Dict[str, Any]) -> None:
        """
        Push a payload to all clients watching a classroom.
        Called from the CV worker thread.
        """
        manager = self._managers.get(classroom_id)
        if manager:
            manager.push_payload(payload)


# Module-level singleton
ws_broadcaster = WSBroadcaster()
