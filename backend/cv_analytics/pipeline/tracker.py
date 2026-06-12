"""
Lightweight IoU Tracker
========================
A simple, robust pure-Python tracker that maps bounding boxes between frames.
We completely removed ByteTrack/Supervision because its internal IoU thresholds 
were too strict, causing "ghost tracks" when people turned their heads fast.

Workflow:
  Anchor frame: detector assigns student_id → init_tracks(faces)
  Frames 2-29:  tracker.update_from_detections(bboxes) returns bboxes with sticky student_ids
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class TrackedFace:
    """A face track with a persistent student identity."""
    track_id: int                        # Internal ID
    student_id: Optional[str]            # Mapped student_id, or None if UNKNOWN
    bbox: List[int]                      # [x1, y1, x2, y2]
    confidence: float = 1.0
    frames_missing: int = 0


def _compute_iou(boxA: List[int], boxB: List[int]) -> float:
    xA, yA = max(boxA[0], boxB[0]), max(boxA[1], boxB[1])
    xB, yB = min(boxA[2], boxB[2]), min(boxA[3], boxB[3])
    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    boxBArea = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    return interArea / float(boxAArea + boxBArea - interArea + 1e-5)


class ByteTracker:
    """
    Keeps the name `ByteTracker` for compatibility with `cv_worker.py`,
    but implements a much more robust Pure-Python IoU matcher.
    """

    def __init__(self, max_age: int = 30, min_hits: int = 1, iou_threshold: float = 0.05):
        self.max_age = max_age
        self.iou_threshold = iou_threshold  # 5% overlap is enough! Super loose.
        self._next_id = 0
        self._active_tracks: Dict[int, TrackedFace] = {}
        self._track_to_student: Dict[int, Optional[str]] = {}

    def load(self) -> None:
        logger.info("[Tracker] Loaded robust Pure-Python IoU Tracker.")

    def unload(self) -> None:
        self._active_tracks.clear()

    def init_tracks(
        self,
        bboxes: List[List[int]],
        confidences: List[float],
        student_ids: List[Optional[str]],
    ) -> List[TrackedFace]:
        """Called every 30 frames (anchor frame) with fresh recognized faces."""
        # Try to map new verified faces to existing tracks to keep tracking IDs consistent
        new_tracks = {}
        used_new_idxs = set()

        # Match new detections to existing tracks to prevent ID flickering
        for track_id, tf in self._active_tracks.items():
            best_iou = self.iou_threshold
            best_idx = -1
            for i, bbox in enumerate(bboxes):
                if i in used_new_idxs:
                    continue
                iou = _compute_iou(tf.bbox, bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_idx = i

            if best_idx != -1:
                used_new_idxs.add(best_idx)
                # Keep old track ID, update bbox and student_id
                sid = student_ids[best_idx]
                if sid is None:
                    # If recognition failed this frame, keep the old identity!
                    sid = tf.student_id

                new_tf = TrackedFace(
                    track_id=track_id,
                    student_id=sid,
                    bbox=bboxes[best_idx],
                    confidence=confidences[best_idx],
                    frames_missing=0
                )
                new_tracks[track_id] = new_tf
                self._track_to_student[track_id] = sid

        # Create brand new tracks for unmatched detections
        for i, bbox in enumerate(bboxes):
            if i not in used_new_idxs:
                tid = self._next_id
                self._next_id += 1
                sid = student_ids[i]
                tf = TrackedFace(
                    track_id=tid,
                    student_id=sid,
                    bbox=bbox,
                    confidence=confidences[i],
                    frames_missing=0
                )
                new_tracks[tid] = tf
                self._track_to_student[tid] = sid

        self._active_tracks = new_tracks
        return list(self._active_tracks.values())

    def update_from_detections(
        self,
        bboxes: List[List[int]],
        confidences: List[float],
    ) -> List[TrackedFace]:
        """Called on tracking frames. Matches raw detections to existing tracks."""
        
        used_new_idxs = set()
        matched_tracks = set()

        for track_id, tf in self._active_tracks.items():
            best_iou = self.iou_threshold
            best_idx = -1
            for i, bbox in enumerate(bboxes):
                if i in used_new_idxs:
                    continue
                iou = _compute_iou(tf.bbox, bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_idx = i

            if best_idx != -1:
                used_new_idxs.add(best_idx)
                matched_tracks.add(track_id)
                tf.bbox = bboxes[best_idx]
                tf.confidence = confidences[best_idx]
                tf.frames_missing = 0

        # Coast missing tracks
        for track_id, tf in list(self._active_tracks.items()):
            if track_id not in matched_tracks:
                tf.frames_missing += 1
                if tf.frames_missing >= self.max_age:
                    del self._active_tracks[track_id]

        # Add new tracks for detections that didn't match anyone
        for i, bbox in enumerate(bboxes):
            if i not in used_new_idxs:
                tid = self._next_id
                self._next_id += 1
                tf = TrackedFace(
                    track_id=tid,
                    student_id=None,  # Unknown until next anchor frame
                    bbox=bbox,
                    confidence=confidences[i],
                    frames_missing=0
                )
                self._active_tracks[tid] = tf

        return list(self._active_tracks.values())
