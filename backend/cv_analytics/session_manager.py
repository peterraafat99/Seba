"""
Session Manager
================
Thread-safe registry of all active CV monitoring sessions.
One entry per classroom that currently has a running video loop.

Stores the active CVWorker instance, the DB session_id, and metadata
so the WebSocket broadcaster and REST endpoints can reference the same state.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Dict, Optional

logger = logging.getLogger(__name__)


@dataclass
class ActiveSession:
    """Runtime state for one active classroom CV session."""
    session_id: int                   # DB cv_sessions.id
    classroom_id: int
    session_type: str                 # 'class' | 'exam'
    worker: object                    # CVWorker instance (typed as object to avoid circular import)
    started_by: Optional[int] = None  # user_id who started it


class SessionManager:
    """
    Global registry of active CV sessions.
    All methods are thread-safe.

    Usage
    -----
    # In cv_router.py at startup:
    session_manager = SessionManager()

    # Start a session:
    session_manager.register(classroom_id=5, session=active_session)

    # Stop a session:
    session_manager.unregister(classroom_id=5)

    # Check if running:
    session_manager.is_active(classroom_id=5)
    """

    def __init__(self):
        self._sessions: Dict[int, ActiveSession] = {}  # classroom_id → ActiveSession
        self._lock = threading.Lock()

    def register(self, classroom_id: int, session: ActiveSession) -> None:
        """Register a new active session for a classroom."""
        with self._lock:
            if classroom_id in self._sessions:
                logger.warning(
                    f"[SessionManager] Classroom {classroom_id} already has an active session. "
                    "Overwriting."
                )
            self._sessions[classroom_id] = session
            logger.info(
                f"[SessionManager] Session {session.session_id} registered "
                f"for classroom {classroom_id} (type={session.session_type})."
            )

    def unregister(self, classroom_id: int) -> Optional[ActiveSession]:
        """Remove and return the session for a classroom."""
        with self._lock:
            session = self._sessions.pop(classroom_id, None)
            if session:
                logger.info(
                    f"[SessionManager] Session {session.session_id} unregistered "
                    f"for classroom {classroom_id}."
                )
            return session

    def get(self, classroom_id: int) -> Optional[ActiveSession]:
        """Return the active session for a classroom, or None."""
        with self._lock:
            return self._sessions.get(classroom_id)

    def is_active(self, classroom_id: int) -> bool:
        """True if there is a running CV session for this classroom."""
        with self._lock:
            return classroom_id in self._sessions

    def list_active(self) -> Dict[int, ActiveSession]:
        """Return a snapshot of all active sessions."""
        with self._lock:
            return dict(self._sessions)

    def stop_all(self) -> None:
        """
        Emergency stop: signal all active workers to stop.
        Called on application shutdown.
        """
        with self._lock:
            classroom_ids = list(self._sessions.keys())

        for cid in classroom_ids:
            session = self.unregister(cid)
            if session and hasattr(session.worker, "stop"):
                try:
                    session.worker.stop()
                    logger.info(f"[SessionManager] Stopped worker for classroom {cid}.")
                except Exception as e:
                    logger.error(f"[SessionManager] Error stopping worker for {cid}: {e}")


# ---------------------------------------------------------------------------
# Module-level singleton — imported by cv_router.py and cv_worker.py
# ---------------------------------------------------------------------------
session_manager = SessionManager()
