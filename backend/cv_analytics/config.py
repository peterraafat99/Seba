"""
CV Analytics — Central Configuration
=====================================
All tunable parameters, thresholds, and hardware settings in one place.
Edit these values to adapt to your deployment environment.
"""
from dataclasses import dataclass, field
from typing import Literal


# ---------------------------------------------------------------------------
# Hardware
# ---------------------------------------------------------------------------
# RTX 3070 Ti: use ctx_id=0 for CUDA via onnxruntime-gpu.
# Set to -1 for CPU-only fallback.
INSIGHTFACE_CTX_ID: int = 0  # 0 = GPU (CUDA), -1 = CPU

# InsightFace model pack.
# 'buffalo_l'  — RetinaFace + ArcFace, highest accuracy (~99.8% LFW), ~350MB
# 'buffalo_sc' — Smaller, faster, for CPU / edge devices
INSIGHTFACE_MODEL_PACK: str = "buffalo_l"

# Detector backend toggle.
# 'insightface' — RetinaFace + ArcFace bundled (recommended)
# 'yolov11'     — YOLOv11-Face + separate ArcFace (speed priority)
DETECTOR_BACKEND: Literal["insightface", "yolov11"] = "insightface"

# YOLOv11-Face weights path (only used if DETECTOR_BACKEND='yolov11')
YOLO_FACE_WEIGHTS: str = "yolov11n-face.pt"


# ---------------------------------------------------------------------------
# Pipeline — Tracking-by-Detection Cycle
# ---------------------------------------------------------------------------
# Every Nth frame runs the heavy detection + embedding pipeline.
# Frames 1..N-1 use ByteTrack kinematics only.
ANCHOR_FRAME_INTERVAL: int = 30

# Camera source for webcam (integer index) or file/RTSP (string path).
# Overridden per-session via the API, this is just the default.
DEFAULT_CAMERA_SOURCE: int = 0

# Target resolution for capture (matches your 1080p webcam).
CAPTURE_WIDTH: int = 1920
CAPTURE_HEIGHT: int = 1080
CAPTURE_FPS: int = 30


# ---------------------------------------------------------------------------
# Face Recognition — FAISS / ArcFace
# ---------------------------------------------------------------------------
EMBEDDING_DIM: int = 512  # ArcFace output dimensionality

# Cosine similarity threshold for identity matching.
# InsightFace normed_embedding uses inner product ≡ cosine for unit vectors.
# Score > RECOGNITION_THRESHOLD → identified student
# Score ≤ RECOGNITION_THRESHOLD → labelled UNKNOWN
RECOGNITION_THRESHOLD: float = 0.45  # Equivalent to cosine distance < 0.55

# Apply histogram equalization on face crops before embedding
# (helps with uneven classroom lighting).
APPLY_HIST_EQ: bool = False


# ---------------------------------------------------------------------------
# Focus State Machine — Head Pose Thresholds
# ---------------------------------------------------------------------------
# Pitch (head up/down). Positive = looking up, negative = looking down.
# A large negative pitch (chin to chest) indicates looking at a phone/desk.
PITCH_DISTRACTION_THRESHOLD: float = 20.0   # degrees (absolute)

# Yaw (head left/right turn).
YAW_DISTRACTION_THRESHOLD: float = 30.0     # degrees (absolute)

# Seconds the head must be out of bounds *continuously* to trigger NOT FOCUS.
DISTRACTION_PERSISTENCE_SECONDS: float = 10.0


# ---------------------------------------------------------------------------
# WebSocket Broadcaster
# ---------------------------------------------------------------------------
# Interval in seconds for heartbeat payloads (even when no state changes).
WS_HEARTBEAT_INTERVAL: float = 1.0


# ---------------------------------------------------------------------------
# Face Enrollment
# ---------------------------------------------------------------------------
# Where face profile photos are stored on disk before embedding extraction.
FACE_UPLOAD_DIR: str = "uploads/faces"
