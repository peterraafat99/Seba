"""
CV Analytics Package
====================
Real-time classroom analytics using:
  - RetinaFace + ArcFace (InsightFace buffalo_l) for face detection & recognition
  - ByteTrack (via supervision) for kinematic tracking
  - MediaPipe Face Mesh for head pose estimation
  - FAISS IndexFlatIP for sub-millisecond embedding lookup
  - Temporal Focus State Machine for distraction detection
"""

from .session_manager import SessionManager
from .cv_worker import CVWorker
from .ws_broadcaster import WSBroadcaster

__all__ = ["SessionManager", "CVWorker", "WSBroadcaster"]
