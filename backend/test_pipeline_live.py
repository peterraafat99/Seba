"""
Lightweight diagnostic: uses detect_only (no ArcFace) to save memory.
Tests the new 2D landmark pose estimator.
"""
import cv2
import numpy as np
import time
import gc

# Force garbage collection first
gc.collect()

# Patch config to use CPU
import cv_analytics.config as cfg
cfg.INSIGHTFACE_CTX_ID = -1

from cv_analytics.pipeline.detector import FaceDetectorEmbedder
from cv_analytics.pipeline.pose_estimator import HeadPoseEstimator

print("=" * 60)
print("LOADING MODELS (detect-only, no ArcFace)...")
print("=" * 60)

detector = FaceDetectorEmbedder()
detector.load()
pose = HeadPoseEstimator()
pose.load()

print("\n[OK] Models loaded. Opening camera...")
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

if not cap.isOpened():
    print("[FAIL] Cannot open camera")
    exit(1)

w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"[OK] Camera: {w}x{h}")

print("\n" + "=" * 60)
print("CAPTURING 30 FRAMES -- look at camera, turn right, turn left")
print("=" * 60)

for i in range(30):
    ret, frame = cap.read()
    if not ret:
        print(f"  Frame {i}: READ FAILED")
        continue

    t0 = time.time()
    results = detector.detect_only(frame)  # detect_only = no ArcFace = less memory
    dt = (time.time() - t0) * 1000

    print(f"\n--- Frame {i} ({dt:.0f}ms) ---")
    print(f"  Detections: {len(results)}")

    for j, r in enumerate(results):
        print(f"  Face {j}: bbox={r.bbox}, score={r.det_score:.3f}, "
              f"has_kps={r.kps is not None}")

        if r.kps is not None:
            p = pose.estimate(frame, r.bbox, kps=r.kps)
            if p:
                print(f"    POSE: pitch={p.pitch:.1f}, yaw={p.yaw:.1f}, roll={p.roll:.1f}")
                is_distracted = abs(p.pitch) > 20 or abs(p.yaw) > 30
                print(f"    FOCUS: {'NOT_FOCUS' if is_distracted else 'FOCUSED'}")
            else:
                print(f"    POSE: FAILED")
        else:
            print(f"    POSE: SKIPPED (no landmarks)")

    time.sleep(0.1)

cap.release()
detector.unload()
print("\n[DONE] Diagnostic complete.")
