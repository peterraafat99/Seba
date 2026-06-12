"""
Face Detector & Embedder
=========================
Primary path  : InsightFace FaceAnalysis (RetinaFace + ArcFace bundled)
                → One call returns bbox + 5-pt landmarks + normed 512-d embedding
Alternative   : YOLOv11-Face (ultralytics) for pure detection speed
                → Requires separate embedding step

Switch via config.DETECTOR_BACKEND = 'insightface' | 'yolov11'

The class exposes a unified interface regardless of backend:
    results = detector.detect_and_embed(frame)
    # Returns list of FaceResult dataclasses
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

import cv2
import numpy as np

from cv_analytics.config import (
    INSIGHTFACE_CTX_ID,
    INSIGHTFACE_MODEL_PACK,
    DETECTOR_BACKEND,
    YOLO_FACE_WEIGHTS,
    APPLY_HIST_EQ,
)

logger = logging.getLogger(__name__)


@dataclass
class FaceResult:
    """Unified output from any detector backend."""
    bbox: List[int]                      # [x1, y1, x2, y2] (integers)
    embedding: Optional[np.ndarray]      # 512-d L2-normalized vector, or None
    det_score: float = 0.0               # Detection confidence
    kps: Optional[np.ndarray] = None     # 5-point facial landmarks (may be None)


class FaceDetectorEmbedder:
    """
    Wraps RetinaFace+ArcFace (InsightFace) or YOLOv11-Face depending on config.

    Usage
    -----
    detector = FaceDetectorEmbedder()
    detector.load()                      # Call once at session start
    results: List[FaceResult] = detector.detect_and_embed(frame)
    detector.unload()                    # Release GPU memory at session end
    """

    def __init__(self):
        self._backend = DETECTOR_BACKEND
        self._insight_app = None
        self._yolo_model = None
        self._loaded = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Load models into GPU memory. Call once per session."""
        if self._loaded:
            return

        if self._backend == "insightface":
            self._load_insightface()
        elif self._backend == "yolov11":
            self._load_yolov11()
        else:
            raise ValueError(f"Unknown DETECTOR_BACKEND: {self._backend}")

        self._loaded = True
        logger.info(f"[Detector] Loaded backend='{self._backend}' on ctx={INSIGHTFACE_CTX_ID}")

    def unload(self) -> None:
        """Release GPU/CPU memory. Call at session stop."""
        self._insight_app = None
        self._yolo_model = None
        self._loaded = False
        logger.info("[Detector] Models unloaded.")

    # ------------------------------------------------------------------
    # Public API — unified interface
    # ------------------------------------------------------------------

    def detect_and_embed(self, frame: np.ndarray) -> List[FaceResult]:
        """
        Run face detection + embedding on a single BGR frame.

        Parameters
        ----------
        frame : np.ndarray
            BGR image (H, W, 3) from OpenCV capture.

        Returns
        -------
        List[FaceResult]
            One entry per detected face, sorted by detection score descending.
        """
        if not self._loaded:
            raise RuntimeError("Detector not loaded. Call .load() first.")

        if APPLY_HIST_EQ:
            frame = self._apply_hist_eq(frame)

        if self._backend == "insightface":
            return self._run_insightface(frame)
        else:
            return self._run_yolov11(frame)

    def detect_only(self, frame: np.ndarray) -> List[FaceResult]:
        """
        Run ONLY face detection — no ArcFace embedding extraction.

        Returns bounding boxes and 5-point landmarks (kps) which are
        sufficient for head pose estimation via SolvePnP.

        This is dramatically cheaper than detect_and_embed() because it
        skips the 512-d ArcFace recognition model entirely.

        Used on tracker frames (2-29) when we only need landmarks for
        pose estimation but do not need identity matching.
        """
        if not self._loaded:
            raise RuntimeError("Detector not loaded. Call .load() first.")

        if APPLY_HIST_EQ:
            frame = self._apply_hist_eq(frame)

        if self._backend == "insightface":
            return self._run_insightface_detect_only(frame)
        else:
            # YOLOv11 path doesn't have a separate detect-only mode;
            # just return with embedding=None
            return self._run_yolov11_detect_only(frame)

    # ------------------------------------------------------------------
    # Backend: InsightFace (RetinaFace + ArcFace)
    # ------------------------------------------------------------------

    def _load_insightface(self) -> None:
        try:
            from insightface.app import FaceAnalysis
        except ImportError as e:
            raise ImportError(
                "insightface is not installed. Run: pip install insightface onnxruntime-gpu"
            ) from e

        self._insight_app = FaceAnalysis(
            name=INSIGHTFACE_MODEL_PACK,
            # allowed_modules limits to only det+rec for speed (no age/gender etc.)
            allowed_modules=["detection", "recognition"],
        )
        # ctx_id=0 → CUDA GPU (RTX 3070 Ti), -1 → CPU
        self._insight_app.prepare(ctx_id=INSIGHTFACE_CTX_ID, det_size=(640, 640))

    def _run_insightface(self, frame: np.ndarray) -> List[FaceResult]:
        faces = self._insight_app.get(frame)
        results: List[FaceResult] = []
        for face in faces:
            x1, y1, x2, y2 = face.bbox.astype(int).tolist()
            results.append(FaceResult(
                bbox=[x1, y1, x2, y2],
                embedding=face.normed_embedding,   # Already L2-normalized ✅
                det_score=float(face.det_score),
                kps=face.kps,
            ))
        # Sort by confidence descending
        results.sort(key=lambda r: r.det_score, reverse=True)
        return results

    def _run_insightface_detect_only(self, frame: np.ndarray) -> List[FaceResult]:
        """
        Run ONLY the RetinaFace detector (det_10g.onnx) without ArcFace.

        InsightFace's app.get() internally runs both detection and recognition.
        To skip recognition, we call the detection model directly and build
        FaceResult objects with embedding=None.
        """
        det_model = getattr(self._insight_app, 'det_model', None)
        if det_model is None and hasattr(self._insight_app, 'models'):
            if isinstance(self._insight_app.models, dict):
                det_model = self._insight_app.models.get('detection')
            elif isinstance(self._insight_app.models, list):
                for model in self._insight_app.models:
                    if hasattr(model, 'detect'):
                        det_model = model
                        break

        if det_model is None:
            # Fallback: use full pipeline if we can't isolate the detector
            logger.warning("[Detector] Could not isolate detection model; falling back to full pipeline.")
            full_results = self._run_insightface(frame)
            for r in full_results:
                r.embedding = None  # Strip embeddings to save memory
            return full_results

        # Run detection exactly as app.get() does to ensure bounding boxes perfectly match
        # anchor frames. This prevents ByteTrack from losing IDs and creating "undefined" tracks.
        bboxes, kpss = det_model.detect(frame, max_num=0, metric='default')

        results: List[FaceResult] = []
        if bboxes is None or bboxes.shape[0] == 0:
            return results

        for i in range(bboxes.shape[0]):
            bbox = bboxes[i, 0:4]
            score = bboxes[i, 4]
            # Lower threshold for tracking frames: frontal faces are >0.8, but profile faces
            # can drop to ~0.4. If we drop them, the tracker loses the ID.
            if score < 0.35: 
                continue
            x1, y1, x2, y2 = bbox
            kps = kpss[i] if kpss is not None else None
            results.append(FaceResult(
                bbox=[int(x1), int(y1), int(x2), int(y2)],
                embedding=None,  # No ArcFace — zero recognition overhead
                det_score=float(score),
                kps=kps,
            ))
        results.sort(key=lambda r: r.det_score, reverse=True)
        return results

    # ------------------------------------------------------------------
    # Backend: YOLOv11-Face (detection only — embedding via InsightFace rec)
    # ------------------------------------------------------------------

    def _load_yolov11(self) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as e:
            raise ImportError(
                "ultralytics is not installed. Run: pip install ultralytics"
            ) from e

        self._yolo_model = YOLO(YOLO_FACE_WEIGHTS)

        # Also load InsightFace recognizer only (no detector) for embeddings
        try:
            from insightface.app import FaceAnalysis
            self._insight_app = FaceAnalysis(
                name=INSIGHTFACE_MODEL_PACK,
                allowed_modules=["recognition"],  # recognition only — no detector
            )
            self._insight_app.prepare(ctx_id=INSIGHTFACE_CTX_ID)
        except ImportError:
            logger.warning("[Detector] insightface not available; YOLOv11 mode will return no embeddings.")

    def _run_yolov11(self, frame: np.ndarray) -> List[FaceResult]:
        results_yolo = self._yolo_model(frame, verbose=False)
        results: List[FaceResult] = []
        for r in results_yolo:
            for box in r.boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().int().tolist()
                conf = float(box.conf[0].cpu())
                embedding = self._embed_crop(frame, x1, y1, x2, y2)
                results.append(FaceResult(
                    bbox=[x1, y1, x2, y2],
                    embedding=embedding,
                    det_score=conf,
                    kps=None,  # YOLOv11-Face does not output landmarks
                ))
        results.sort(key=lambda r: r.det_score, reverse=True)
        return results

    def _run_yolov11_detect_only(self, frame: np.ndarray) -> List[FaceResult]:
        """YOLOv11 detection without embedding extraction."""
        results_yolo = self._yolo_model(frame, verbose=False)
        results: List[FaceResult] = []
        for r in results_yolo:
            for box in r.boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().int().tolist()
                conf = float(box.conf[0].cpu())
                results.append(FaceResult(
                    bbox=[x1, y1, x2, y2],
                    embedding=None,  # No embedding — detect only
                    det_score=conf,
                    kps=None,
                ))
        results.sort(key=lambda r: r.det_score, reverse=True)
        return results

    def _embed_crop(
        self, frame: np.ndarray, x1: int, y1: int, x2: int, y2: int
    ) -> Optional[np.ndarray]:
        """Crop the face region and extract ArcFace embedding (YOLOv11 path)."""
        if self._insight_app is None:
            return None
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None
        # InsightFace recognizer expects aligned face; use crop directly as approximation
        try:
            faces = self._insight_app.get(crop)
            if faces:
                return faces[0].normed_embedding
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _apply_hist_eq(frame: np.ndarray) -> np.ndarray:
        """
        Apply CLAHE histogram equalization on the Y (luminance) channel
        to normalize uneven classroom lighting without affecting hue/saturation.
        """
        yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        yuv[:, :, 0] = clahe.apply(yuv[:, :, 0])
        return cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR)
