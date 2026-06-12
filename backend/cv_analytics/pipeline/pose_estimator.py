"""
Head Pose Estimator — 2D Landmark Ratio Method
===============================================
Estimates head orientation directly from 2D facial landmark positions.
No solvePnP needed — avoids the 180° ambiguity problem entirely.

Uses the geometric relationships between the 5 RetinaFace landmarks:
  - YAW:   ratio of left-eye-to-nose / right-eye-to-nose distances
  - PITCH: vertical position of nose relative to eye-mouth baseline
  - ROLL:  angle of the inter-ocular line

This is more robust than PnP for 5 near-coplanar points, and uses
zero additional computation beyond basic vector math.

Pitch > 0  : head tilted UP
Pitch < 0  : head tilted DOWN
Yaw > 0    : head turned RIGHT  (person's right)
Yaw < 0    : head turned LEFT   (person's left)
Roll       : head tilted sideways
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

@dataclass
class PoseAngles:
    pitch: float  # degrees: positive = up, negative = down
    yaw: float    # degrees: positive = right, negative = left
    roll: float   # degrees


class HeadPoseEstimator:
    """
    Estimates head pose using 2D landmark ratios from RetinaFace 5-point kps.
    """

    def __init__(self):
        self._loaded = False

    def load(self) -> None:
        self._loaded = True
        logger.info("[PoseEstimator] Loaded (2D landmark ratio method).")

    def unload(self) -> None:
        self._loaded = False
        logger.info("[PoseEstimator] Unloaded.")

    def estimate(self, frame, bbox: list, kps=None) -> Optional[PoseAngles]:
        """
        Estimate head pose from 5 facial landmarks.

        Parameters
        ----------
        frame : np.ndarray  (unused, kept for interface compatibility)
        bbox  : [x1, y1, x2, y2]  (unused)
        kps   : np.ndarray, shape (5, 2)
            InsightFace 5-point landmarks:
              [0] Person's left eye   (RIGHT side of image)
              [1] Person's right eye  (LEFT side of image)
              [2] Nose tip
              [3] Person's left mouth corner
              [4] Person's right mouth corner
        """
        if kps is None or len(kps) != 5:
            return None

        left_eye = kps[0].astype(np.float64)    # person's left  → image right
        right_eye = kps[1].astype(np.float64)   # person's right → image left
        nose = kps[2].astype(np.float64)
        left_mouth = kps[3].astype(np.float64)
        right_mouth = kps[4].astype(np.float64)

        # ---- Inter-ocular distance (normalization baseline) ----
        eye_dist = np.linalg.norm(left_eye - right_eye)
        if eye_dist < 3.0:  # Too small to be a real face
            return None

        # ================================================================
        # YAW  —  Left/Right head turn
        # ================================================================
        # When looking straight: both eyes are equidistant from the nose.
        # When turning RIGHT: the right eye (image-left) moves toward/behind
        #   the nose, so d_right shrinks and d_left grows.
        # Ratio ranges from ~-1 (full left) to ~+1 (full right).
        d_left = np.linalg.norm(left_eye - nose)
        d_right = np.linalg.norm(right_eye - nose)

        yaw_ratio = (d_left - d_right) / (d_left + d_right + 1e-6)
        # Empirical mapping: ratio of ~0.35 corresponds to ~45° turn
        yaw = yaw_ratio * 130.0  # scale to approximate degrees

        # ================================================================
        # PITCH  —  Up/Down head tilt
        # ================================================================
        # Use the vertical position of the nose relative to the face's
        # vertical extent (eye midpoint to mouth midpoint).
        # When looking DOWN: nose moves UP in image → closer to eyes.
        # When looking UP: nose moves DOWN → closer to mouth.
        eye_mid = (left_eye + right_eye) / 2.0
        mouth_mid = (left_mouth + right_mouth) / 2.0

        # Face vertical span
        face_height = np.linalg.norm(eye_mid - mouth_mid)
        if face_height < 3.0:
            return None

        # Where is the nose along the eye→mouth axis? (0 = at eyes, 1 = at mouth)
        nose_position = np.dot(nose - eye_mid, mouth_mid - eye_mid) / (face_height ** 2)

        # Neutral nose_position is typically ~0.35-0.45 (nose is above mouth midpoint)
        # Deviation from neutral indicates pitch.
        neutral_pos = 0.38
        pitch_deviation = nose_position - neutral_pos

        # Scale: a deviation of 0.15 ≈ 20° pitch
        pitch = -pitch_deviation * 130.0  # negative deviation = looking down

        # ================================================================
        # ROLL  —  Head tilt sideways
        # ================================================================
        dy = right_eye[1] - left_eye[1]
        dx = right_eye[0] - left_eye[0]
        roll = np.degrees(np.arctan2(dy, dx))
        # Normalize: when eyes are level, this is ~180° (right eye is LEFT of left eye)
        # We want roll=0 when head is upright
        if roll > 90:
            roll -= 180
        elif roll < -90:
            roll += 180

        return PoseAngles(
            pitch=round(float(pitch), 2),
            yaw=round(float(yaw), 2),
            roll=round(float(roll), 2),
        )
