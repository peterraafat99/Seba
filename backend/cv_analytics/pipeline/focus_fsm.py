"""
Focus State Machine
====================
Maintains the real-time attention state of every tracked student.
Thread-safe: uses a threading.Lock for all state mutations.

Operates in two modes:

  CLASS MODE (is_exam=False):
    - Distraction trigger: pitch > PITCH_THRESHOLD OR abs(yaw) > YAW_THRESHOLD
    - Timer: 10 seconds of continuous distraction → state = NOT_FOCUS
    - Recovery: angles return to normal → clear timer → state = FOCUSED

  EXAM MODE (is_exam=True):
    - Shorter timer: 3 seconds for basic distraction
    - Neighbor glance: abs(yaw) > NEIGHBOR_YAW_THRESHOLD sustained → NEIGHBOR_GLANCE event
    - Rapid scan: yaw direction changes > N times in W seconds → RAPID_SCAN event (cheat signal)
      e.g. looking left, then right, then left in 5 seconds = suspicious

State values:
  FOCUSED       - angles within normal range
  NOT_FOCUS     - distraction timer expired
  UNKNOWN       - no face recognized (UNKNOWN label from FAISS)
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Deque, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants — Class Mode Defaults
# ---------------------------------------------------------------------------
DEFAULT_PITCH_THRESHOLD = 25.0      # degrees (absolute) — raised to avoid false positives from camera angle
DEFAULT_YAW_THRESHOLD = 25.0        # degrees (absolute) — lowered for better left/right sensitivity
DEFAULT_DISTRACTION_TIMER = 3.0     # seconds — reduced from 10s so it reacts quickly
INSTANT_YAW_THRESHOLD = 35.0        # Strong lateral turn → instant NOT_FOCUS, no timer needed

# Exam Mode Defaults
EXAM_DISTRACTION_TIMER = 2.0        # seconds (much stricter)
EXAM_NEIGHBOR_YAW_THRESHOLD = 22.0  # degrees — lateral look toward seat-neighbor
EXAM_RAPID_CHANGE_COUNT = 3         # direction reversals within window
EXAM_RAPID_CHANGE_WINDOW = 5.0      # seconds


# ---------------------------------------------------------------------------
# State & Event Types
# ---------------------------------------------------------------------------

FOCUSED = "FOCUSED"
NOT_FOCUS = "NOT FOCUS"
UNKNOWN_STATE = "UNKNOWN"

EVENT_DISTRACTED = "distracted"
EVENT_RECOVERED = "recovered"
EVENT_NEIGHBOR_GLANCE = "neighbor_glance"
EVENT_RAPID_SCAN = "rapid_scan"


@dataclass
class StudentFocusState:
    """Per-student state tracked by the FSM."""
    student_id: str
    status: str = FOCUSED

    # Distraction timer
    distraction_start_ts: Optional[float] = None  # Unix timestamp
    distraction_event_logged: bool = False         # Have we logged this event to DB?

    # Latest pose reading
    pitch: float = 0.0
    yaw: float = 0.0

    # Exam mode: yaw direction history for rapid-scan detection
    # Each entry: (timestamp, direction) where direction is 'L' or 'R'
    yaw_direction_history: Deque = field(default_factory=lambda: deque(maxlen=50))
    last_yaw_direction: Optional[str] = None
    rapid_scan_flagged: bool = False
    rapid_scan_ts: Optional[float] = None

    # Track bbox for WebSocket payload
    bbox: List[int] = field(default_factory=lambda: [0, 0, 0, 0])


@dataclass
class FocusEvent:
    """Emitted when a notable state change occurs."""
    student_id: str
    event_type: str   # EVENT_DISTRACTED | EVENT_RECOVERED | EVENT_NEIGHBOR_GLANCE | EVENT_RAPID_SCAN
    pitch: float
    yaw: float
    timestamp: float  # Unix timestamp


class FocusStateMachine:
    """
    Manages focus states for all active tracked students.

    Usage
    -----
    fsm = FocusStateMachine(is_exam=False)

    # Call each frame for every tracked student:
    events = fsm.update(
        student_id="42",
        pitch=-25.0,
        yaw=5.0,
        bbox=[100, 50, 200, 150],
    )
    # events is a list of FocusEvent (may be empty)

    snapshot = fsm.get_snapshot()  # Dict[student_id, StudentFocusState]
    """

    def __init__(
        self,
        is_exam: bool = False,
        pitch_threshold: float = DEFAULT_PITCH_THRESHOLD,
        yaw_threshold: float = DEFAULT_YAW_THRESHOLD,
        distraction_timer: Optional[float] = None,
        neighbor_yaw_threshold: float = EXAM_NEIGHBOR_YAW_THRESHOLD,
        rapid_change_count: int = EXAM_RAPID_CHANGE_COUNT,
        rapid_change_window: float = EXAM_RAPID_CHANGE_WINDOW,
    ):
        self.is_exam = is_exam
        self.pitch_threshold = pitch_threshold
        self.yaw_threshold = yaw_threshold

        # Timer defaults differ by mode
        if distraction_timer is not None:
            self.distraction_timer = distraction_timer
        else:
            self.distraction_timer = EXAM_DISTRACTION_TIMER if is_exam else DEFAULT_DISTRACTION_TIMER

        # Exam-specific parameters
        self.neighbor_yaw_threshold = neighbor_yaw_threshold
        self.rapid_change_count = rapid_change_count
        self.rapid_change_window = rapid_change_window

        self._states: Dict[str, StudentFocusState] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(
        self,
        student_id: str,
        pitch: float,
        yaw: float,
        bbox: List[int],
    ) -> List[FocusEvent]:
        """
        Process one frame of pose data for a student.
        Returns a (possibly empty) list of state-change events.
        """
        with self._lock:
            state = self._get_or_create(student_id)
            state.pitch = pitch
            state.yaw = yaw
            state.bbox = bbox
            now = time.time()

            events: List[FocusEvent] = []

            # 1. Class-mode + exam-mode: basic distraction logic
            is_distracted = self._is_distracted(pitch, yaw)
            events.extend(self._process_distraction(state, is_distracted, pitch, yaw, now))

            # 2. Exam-mode only: neighbor glance + rapid scan
            if self.is_exam:
                events.extend(self._process_neighbor_glance(state, yaw, now))
                events.extend(self._process_rapid_scan(state, yaw, now))

            return events

    def remove_student(self, student_id: str) -> None:
        """Remove a student's state (e.g. they left the frame for too long)."""
        with self._lock:
            self._states.pop(student_id, None)

    def get_snapshot(self) -> Dict[str, StudentFocusState]:
        """Thread-safe copy of all current student states."""
        with self._lock:
            return dict(self._states)

    def get_student_status(self, student_id: str) -> str:
        """Return the current status string for a student."""
        with self._lock:
            state = self._states.get(student_id)
            return state.status if state else UNKNOWN_STATE

    def reset(self) -> None:
        """Clear all state (e.g. between sessions)."""
        with self._lock:
            self._states.clear()

    # ------------------------------------------------------------------
    # Internal Logic
    # ------------------------------------------------------------------

    def _get_or_create(self, student_id: str) -> StudentFocusState:
        if student_id not in self._states:
            self._states[student_id] = StudentFocusState(student_id=student_id)
        return self._states[student_id]

    def _is_distracted(self, pitch: float, yaw: float) -> bool:
        """True if head angles exceed distraction thresholds."""
        pitch_bad = abs(pitch) > self.pitch_threshold
        yaw_bad = abs(yaw) > self.yaw_threshold
        return pitch_bad or yaw_bad

    def _is_instantly_distracted(self, pitch: float, yaw: float) -> bool:
        """True for strong lateral turns that need no timer — instant NOT_FOCUS."""
        return abs(yaw) > INSTANT_YAW_THRESHOLD

    def _process_distraction(
        self,
        state: StudentFocusState,
        is_distracted: bool,
        pitch: float,
        yaw: float,
        now: float,
    ) -> List[FocusEvent]:
        events: List[FocusEvent] = []

        # Strong lateral turn → instant NOT_FOCUS without waiting for the timer
        if self._is_instantly_distracted(pitch, yaw):
            if state.status != NOT_FOCUS:
                state.status = NOT_FOCUS
                state.distraction_start_ts = now
                state.distraction_event_logged = True
                events.append(FocusEvent(
                    student_id=state.student_id,
                    event_type=EVENT_DISTRACTED,
                    pitch=pitch,
                    yaw=yaw,
                    timestamp=now,
                ))
                logger.debug(f"[FSM] {state.student_id} → NOT_FOCUS INSTANT (yaw={yaw:.1f}°)")
            return events

        if is_distracted:
            if state.distraction_start_ts is None:
                # Start the distraction timer
                state.distraction_start_ts = now
                state.distraction_event_logged = False
            else:
                elapsed = now - state.distraction_start_ts
                if elapsed >= self.distraction_timer and not state.distraction_event_logged:
                    # Timer expired — transition to NOT_FOCUS
                    prev_status = state.status
                    state.status = NOT_FOCUS
                    state.distraction_event_logged = True
                    if prev_status != NOT_FOCUS:
                        events.append(FocusEvent(
                            student_id=state.student_id,
                            event_type=EVENT_DISTRACTED,
                            pitch=pitch,
                            yaw=yaw,
                            timestamp=now,
                        ))
                        logger.debug(f"[FSM] {state.student_id} → NOT_FOCUS (elapsed={elapsed:.1f}s)")
        else:
            # Angles back to normal — recover
            if state.distraction_start_ts is not None:
                was_distracted = state.status == NOT_FOCUS
                state.distraction_start_ts = None
                state.distraction_event_logged = False
                state.status = FOCUSED
                if was_distracted:
                    events.append(FocusEvent(
                        student_id=state.student_id,
                        event_type=EVENT_RECOVERED,
                        pitch=pitch,
                        yaw=yaw,
                        timestamp=now,
                    ))
                    logger.debug(f"[FSM] {state.student_id} → FOCUSED (recovered)")

        return events

    def _process_neighbor_glance(
        self,
        state: StudentFocusState,
        yaw: float,
        now: float,
    ) -> List[FocusEvent]:
        """
        Exam mode: detect sustained lateral looks toward seat neighbors.
        Fires once per glance event (not on every frame).
        """
        events: List[FocusEvent] = []
        # A neighbor glance is a large lateral yaw that isn't just 'looking away'
        # (which is handled by basic distraction). Here we specifically log the
        # directional neighbor aspect as a separate exam event.
        if abs(yaw) > self.neighbor_yaw_threshold:
            # Only log once per sustained glance (use distraction_event_logged as proxy
            # — in exam mode the distraction timer is short so this fires quickly)
            if state.distraction_event_logged:
                events.append(FocusEvent(
                    student_id=state.student_id,
                    event_type=EVENT_NEIGHBOR_GLANCE,
                    pitch=state.pitch,
                    yaw=yaw,
                    timestamp=now,
                ))
        return events

    def _process_rapid_scan(
        self,
        state: StudentFocusState,
        yaw: float,
        now: float,
    ) -> List[FocusEvent]:
        """
        Exam mode: detect rapid left-right head movement.
        Tracks yaw direction changes in a rolling time window.
        If direction changes >= rapid_change_count in rapid_change_window seconds,
        flag as RAPID_SCAN (cheating signal).
        """
        events: List[FocusEvent] = []

        # Determine current yaw direction (ignore small jitter around 0)
        dead_zone = 5.0  # degrees — ignore minor wobble
        if yaw > dead_zone:
            current_dir: Optional[str] = 'R'
        elif yaw < -dead_zone:
            current_dir = 'L'
        else:
            current_dir = None  # Centered — no directional data

        if current_dir is None:
            return events

        # Detect direction change
        if state.last_yaw_direction is not None and current_dir != state.last_yaw_direction:
            state.yaw_direction_history.append((now, current_dir))

        state.last_yaw_direction = current_dir

        # Count changes within the rolling window
        cutoff = now - self.rapid_change_window
        recent_changes = [
            ts for ts, _ in state.yaw_direction_history if ts >= cutoff
        ]

        if (
            len(recent_changes) >= self.rapid_change_count
            and not state.rapid_scan_flagged
        ):
            state.rapid_scan_flagged = True
            state.rapid_scan_ts = now
            events.append(FocusEvent(
                student_id=state.student_id,
                event_type=EVENT_RAPID_SCAN,
                pitch=state.pitch,
                yaw=yaw,
                timestamp=now,
            ))
            logger.warning(f"[FSM] RAPID SCAN detected for {state.student_id} ({len(recent_changes)} changes in {self.rapid_change_window}s)")

        # Reset rapid scan flag after window passes (allow re-triggering)
        if state.rapid_scan_flagged and state.rapid_scan_ts:
            if now - state.rapid_scan_ts > self.rapid_change_window:
                state.rapid_scan_flagged = False
                state.yaw_direction_history.clear()

        return events
