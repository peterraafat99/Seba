"""
CV Worker
==========
The main background thread that runs the full CV pipeline for one classroom session.

Architecture:
  - Runs as a daemon thread (started by cv_router.py on POST /api/cv/session/start)
  - Reads frames from OpenCV VideoCapture
  - Executes the Tracking-by-Detection pipeline on each frame
  - Pushes JSON payloads to WSBroadcaster on state changes

Pipeline (per frame):
  Every ANCHOR_FRAME_INTERVAL-th frame:
    1. FaceDetectorEmbedder.detect_and_embed() → FaceResult list
    2. ClassFAISSIndex.query_batch()            → student_id assignments
    3. ByteTracker.init_tracks()               → reset tracking baseline

  Frames in between:
    1. ByteTracker.update_from_detections()    → kinematic bbox updates only

  Every frame:
    1. HeadPoseEstimator.estimate() per tracked face
    2. FocusStateMachine.update()  per tracked face
    3. Build JSON payload → push to WSBroadcaster
    4. Persist FocusEvents to DB (async via queue)
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

from cv_analytics.config import ANCHOR_FRAME_INTERVAL, CAPTURE_FPS
from cv_analytics.faiss_index import ClassFAISSIndex
from cv_analytics.pipeline.detector import FaceDetectorEmbedder
from cv_analytics.pipeline.focus_fsm import (
    DEFAULT_PITCH_THRESHOLD,
    DEFAULT_YAW_THRESHOLD,
    EXAM_DISTRACTION_TIMER,
    EXAM_NEIGHBOR_YAW_THRESHOLD,
    EXAM_RAPID_CHANGE_COUNT,
    EXAM_RAPID_CHANGE_WINDOW,
    FOCUSED,
    NOT_FOCUS,
    FocusStateMachine,
)
from cv_analytics.pipeline.pose_estimator import HeadPoseEstimator
from cv_analytics.pipeline.tracker import ByteTracker
from cv_analytics.ws_broadcaster import ws_broadcaster

logger = logging.getLogger(__name__)


class CVWorker:
    """
    Orchestrates the full real-time CV pipeline for one classroom session.

    Parameters
    ----------
    session_id : int        DB cv_sessions.id
    classroom_id : int      Physical classroom ID
    session_type : str      'class' | 'exam'
    camera_source : str     '0' for webcam, or RTSP/file path
    faiss_index : ClassFAISSIndex  Pre-built FAISS index
    exam_config : dict      Optional exam threshold overrides (from PhysicalClassroom.exam_config_json)
    db_event_callback : callable   Called with FocusEvent dicts to persist to DB
    """

    def __init__(
        self,
        session_id: int,
        classroom_id: int,
        session_type: str,
        camera_source: str,
        faiss_index: ClassFAISSIndex,
        exam_config: Optional[Dict] = None,
        db_event_callback: Optional[callable] = None,
        nfc_only: bool = False,
    ):
        self.session_id = session_id
        self.classroom_id = classroom_id
        self.session_type = session_type
        self.camera_source = camera_source
        self.faiss_index = faiss_index
        self.exam_config = exam_config or {}
        self.db_event_callback = db_event_callback
        self.nfc_only = nfc_only

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._cap: Optional[cv2.VideoCapture] = None

        # Pipeline components (initialized in _setup)
        self._detector: Optional[FaceDetectorEmbedder] = None
        self._tracker: Optional[ByteTracker] = None
        self._pose_estimator: Optional[HeadPoseEstimator] = None
        self._fsm: Optional[FocusStateMachine] = None
        self._last_poses: Dict[int, Tuple[float, float]] = {}  # track_id -> (pitch, yaw)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Spin up the background processing thread."""
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name=f"cv-worker-classroom-{self.classroom_id}",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            f"[CVWorker] Started for classroom={self.classroom_id}, "
            f"session={self.session_id}, type={self.session_type}"
        )

    def stop(self) -> None:
        """Signal the worker to stop and wait for thread cleanup."""
        logger.info(f"[CVWorker] Stop requested for classroom {self.classroom_id}.")
        self._stop_event.set()
        
        # Release the capture device from the main thread to unblock the read() call
        if hasattr(self, "_cap") and self._cap:
            try:
                logger.info(f"[CVWorker] Releasing VideoCapture from stop() to break block...")
                self._cap.release()
            except Exception as e:
                logger.error(f"[CVWorker] Error releasing cap in stop(): {e}")

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)
        logger.info(f"[CVWorker] Thread stopped for classroom {self.classroom_id}.")

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # ------------------------------------------------------------------
    # Main Loop
    # ------------------------------------------------------------------

    def _run(self) -> None:
        """Main processing loop — runs in the background thread."""
        self._cap = None
        try:
            self._setup_pipeline()
            self._cap = self._open_camera()
            if self._cap is None:
                logger.error(
                    f"[CVWorker] Failed to open camera '{self.camera_source}'. "
                    "Worker exiting."
                )
                return

            frame_count = 0
            logger.info(f"[CVWorker] Video stream open. Processing frames...")

            while not self._stop_event.is_set():
                if self._cap is None:
                    break
                ret, frame = self._cap.read()
                if not ret:
                    logger.warning("[CVWorker] Frame read failed. Retrying...")
                    time.sleep(0.1)
                    continue

                frame_count += 1
                is_anchor = (frame_count % ANCHOR_FRAME_INTERVAL == 1)

                try:
                    payload = self._process_frame(frame, frame_count, is_anchor)
                    ws_broadcaster.push(self.classroom_id, payload)
                except Exception as e:
                    logger.error(f"[CVWorker] Frame {frame_count} error: {e}", exc_info=True)

        except Exception as e:
            logger.error(f"[CVWorker] Fatal error: {e}", exc_info=True)
        finally:
            if self._cap:
                try:
                    self._cap.release()
                except Exception as e:
                    logger.error(f"[CVWorker] Error releasing cap in finally: {e}")
                self._cap = None
            self._teardown_pipeline()
            logger.info(f"[CVWorker] Cleanup complete for classroom {self.classroom_id}.")

    # ------------------------------------------------------------------
    # NFC Attendance Helper
    # ------------------------------------------------------------------

    def _get_nfc_present_student_ids(self) -> set:
        """Fetch IDs of students who scanned present via NFC in this classroom today."""
        from database import SessionLocal
        from models import AttendanceRecord
        from datetime import datetime, time
        
        present_ids = set()
        db = SessionLocal()
        try:
            today_start = datetime.combine(datetime.today(), time.min)
            records = (
                db.query(AttendanceRecord)
                .filter(
                    AttendanceRecord.classroom_id == self.classroom_id,
                    AttendanceRecord.status == "present",
                    AttendanceRecord.timestamp >= today_start
                )
                .all()
            )
            for r in records:
                present_ids.add(str(r.student_id))
        except Exception as e:
            logger.error(f"[CVWorker] Error fetching NFC attendance: {e}")
        finally:
            db.close()
        return present_ids

    # ------------------------------------------------------------------
    # Frame Processing
    # ------------------------------------------------------------------

    def _process_frame(
        self, frame: np.ndarray, frame_count: int, is_anchor: bool
    ) -> Dict[str, Any]:
        """Process a single frame through the full pipeline."""

        # Fetch NFC present student IDs if in nfc_only mode
        present_set = set()
        if self.nfc_only:
            present_set = self._get_nfc_present_student_ids()

        # ---- ANCHOR FRAME: Detection + Embedding + FAISS + Tracker Init ----
        if is_anchor:
            face_results = self._detector.detect_and_embed(frame)
            bboxes = [r.bbox for r in face_results]
            confidences = [r.det_score for r in face_results]
            embeddings = [r.embedding for r in face_results]

            # Batch FAISS lookup for all detected faces
            if embeddings and any(e is not None for e in embeddings):
                valid_embeddings = [
                    e if e is not None else np.zeros(512, dtype=np.float32)
                    for e in embeddings
                ]
                matches = self.faiss_index.query_batch(valid_embeddings)
                student_ids = [m[0] for m in matches]  # None = UNKNOWN
            else:
                student_ids = [None] * len(face_results)

            # Reset tracker with verified identities
            tracks = self._tracker.init_tracks(bboxes, confidences, student_ids)

        # ---- TRACKER FRAMES: Lightweight detection (no ArcFace) ----
        else:
            # Step 1: Run lightweight detection ONLY (no ArcFace embedding)
            #         to get 5-point facial landmarks for head pose estimation.
            #         RetinaFace detection alone is ~5x cheaper than full
            #         detection + ArcFace recognition.
            face_results = self._detector.detect_only(frame)

            # Step 2: Update ByteTrack with these new detections.
            #         This preserves sticky student IDs from the last anchor frame
            #         while keeping bounding boxes perfectly synchronized.
            bboxes = [r.bbox for r in face_results]
            confidences = [r.det_score for r in face_results]
            tracks = self._tracker.update_from_detections(bboxes, confidences)

        # ---- POSE + FSM: Run every frame for all active tracks ----
        student_states = []
        focused_count = 0
        distracted_count = 0

        def _compute_iou(boxA, boxB):
            xA, yA = max(boxA[0], boxB[0]), max(boxA[1], boxB[1])
            xB, yB = min(boxA[2], boxB[2]), min(boxA[3], boxB[3])
            interArea = max(0, xB - xA) * max(0, yB - yA)
            boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
            boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
            return interArea / float(boxAArea + boxBArea - interArea + 1e-5)

        for track in tracks:
            if self.nfc_only:
                # Ignore unrecognized/UNKNOWN face or non-present student completely
                if not track.student_id or str(track.student_id) not in present_set:
                    continue

            # Map tracker bounding box back to current frame's detections to get 5-pt landmarks (kps)
            best_kps = None
            best_iou = 0.0
            for r in face_results:
                iou = _compute_iou(track.bbox, r.bbox)
                if iou > best_iou and iou > 0.05:
                    best_iou = iou
                    best_kps = r.kps

            pose = self._pose_estimator.estimate(frame, track.bbox, kps=best_kps)
            
            if pose is not None:
                pitch = pose.pitch
                yaw = pose.yaw
                self._last_poses[track.track_id] = (pitch, yaw)
            else:
                # Face lost by detector but coasted by tracker -> reuse last known pose
                pitch, yaw = self._last_poses.get(track.track_id, (0.0, 0.0))

            sid = track.student_id if track.student_id else "UNKNOWN"
            events = self._fsm.update(
                student_id=sid,
                pitch=pitch,
                yaw=yaw,
                bbox=track.bbox,
            )

            # Persist events to DB (non-blocking callback)
            if events and self.db_event_callback:
                for evt in events:
                    try:
                        self.db_event_callback(
                            session_id=self.session_id,
                            student_id=track.student_id,
                            event_type=evt.event_type,
                            pitch=evt.pitch,
                            yaw=evt.yaw,
                            timestamp=evt.timestamp,
                        )
                    except Exception:
                        pass  # Never let DB errors crash the video loop

            status = self._fsm.get_student_status(sid)

            student_states.append({
                "student_id": sid,
                "bbox": track.bbox,
                "pose": {"pitch": round(pitch, 2), "yaw": round(yaw, 2)},
                "status": status,
            })

            if status == FOCUSED:
                focused_count += 1
            elif status == NOT_FOCUS:
                distracted_count += 1

        return self._build_payload(student_states, focused_count, distracted_count)

    # ------------------------------------------------------------------
    # Payload Builder
    # ------------------------------------------------------------------

    def _build_payload(
        self,
        students: List[Dict],
        focused_count: int,
        distracted_count: int,
    ) -> Dict[str, Any]:
        """Build the WebSocket JSON payload per the API spec."""
        return {
            "class_id": str(self.classroom_id),
            "session_id": self.session_id,
            "session_type": self.session_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "type": "update",
            "metrics": {
                "total_detected": len(students),
                "focused_count": focused_count,
                "distracted_count": distracted_count,
                "unknown_count": sum(
                    1 for s in students if s["student_id"] == "UNKNOWN"
                ),
                "focus_rate": round(
                    focused_count / len(students) * 100 if students else 0.0, 1
                ),
            },
            "students": students,
        }

    # ------------------------------------------------------------------
    # Setup / Teardown
    # ------------------------------------------------------------------

    def _setup_pipeline(self) -> None:
        """Initialize all pipeline components. Called once at thread start."""
        is_exam = self.session_type == "exam"

        # Exam config overrides (from PhysicalClassroom.exam_config_json)
        distraction_timer = self.exam_config.get("distraction_timer_sec", None)
        pitch_threshold = self.exam_config.get("pitch_threshold", DEFAULT_PITCH_THRESHOLD)
        yaw_threshold = self.exam_config.get("yaw_threshold", DEFAULT_YAW_THRESHOLD)
        neighbor_yaw = self.exam_config.get(
            "neighbor_yaw_threshold", EXAM_NEIGHBOR_YAW_THRESHOLD
        )
        rapid_count = self.exam_config.get("rapid_change_count", EXAM_RAPID_CHANGE_COUNT)
        rapid_window = self.exam_config.get(
            "rapid_change_window_sec", EXAM_RAPID_CHANGE_WINDOW
        )

        self._detector = FaceDetectorEmbedder()
        self._detector.load()

        self._tracker = ByteTracker()
        self._tracker.load()

        self._pose_estimator = HeadPoseEstimator()
        self._pose_estimator.load()

        self._fsm = FocusStateMachine(
            is_exam=is_exam,
            pitch_threshold=pitch_threshold,
            yaw_threshold=yaw_threshold,
            distraction_timer=distraction_timer,
            neighbor_yaw_threshold=neighbor_yaw,
            rapid_change_count=rapid_count,
            rapid_change_window=rapid_window,
        )
        logger.info(
            f"[CVWorker] Pipeline ready. exam_mode={is_exam}, "
            f"timer={self._fsm.distraction_timer}s, "
            f"pitch={self._fsm.pitch_threshold}°, yaw={self._fsm.yaw_threshold}°"
        )

    def _teardown_pipeline(self) -> None:
        """Release all model resources. Called when the thread exits."""
        if self._detector:
            self._detector.unload()
        if self._tracker:
            self._tracker.unload()
        if self._pose_estimator:
            self._pose_estimator.unload()
        if self._fsm:
            self._fsm.reset()
        self.faiss_index.release()

    def _open_camera(self) -> Optional[cv2.VideoCapture]:
        """Open the video source. Returns None on failure."""
        import os
        source = self.camera_source
        
        # Allow environment override for easy camera index selection (e.g. laptop vs external webcam)
        env_override = os.getenv("WEBCAM_INDEX")
        if env_override is not None:
            source = env_override
            logger.info(f"[CVWorker] Overriding camera source with WEBCAM_INDEX environment variable: {source}")

        # Convert string integer to int for webcam index
        cap = None
        try:
            source = int(source)
            import platform
            if platform.system().lower() == "windows":
                cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
            else:
                cap = cv2.VideoCapture(source)
        except (ValueError, TypeError):
            cap = cv2.VideoCapture(source)  # Keep as string for RTSP/file paths

        if cap is None or not cap.isOpened():
            return None

        # Set resolution for 1080p webcam
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
        cap.set(cv2.CAP_PROP_FPS, CAPTURE_FPS)

        actual_w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        actual_h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        logger.info(f"[CVWorker] Camera opened: {actual_w}x{actual_h} @ {CAPTURE_FPS}fps")
        return cap
