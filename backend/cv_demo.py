"""
=======================================================================
  SEBA LIVE CV DEMO  —  Standalone Test Script
=======================================================================
  Shows a live camera window with:
    - Green/Red bounding box   (FOCUSED = Green, NOT FOCUS = Red)
    - Student ID label         (from face enrollment)
    - Pitch / Yaw angles       (live pose reading)
    - Focus state badge        (FOCUSED / NOT FOCUS)
    - Yaw bar meter            (visual left ← → right indicator)

  CONTROLS:
    Q  or  ESC  → quit
    R           → reset all tracks (re-enroll next anchor)
    F           → show / hide debug face landmarks

  REQUIREMENTS:
    pip install insightface onnxruntime opencv-python numpy

  RUN:
    python cv_demo.py
    python cv_demo.py --camera 1       (use external webcam)
    python cv_demo.py --enroll Alice photo_alice.jpg Bob photo_bob.jpg
=======================================================================
"""

import argparse
import base64
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Config — tweak here
# ---------------------------------------------------------------------------
ANCHOR_EVERY_N_FRAMES = 30        # Run ArcFace recognition every N frames
YAW_THRESHOLD          = 25.0     # °  | lateral turn → warn
PITCH_THRESHOLD        = 25.0     # °  | looking down/up → warn
INSTANT_YAW            = 35.0     # °  | instant NOT_FOCUS no timer
DISTRACTION_TIMER      = 3.0      # seconds before NOT_FOCUS kicks in
FAISS_THRESHOLD        = 0.55     # cosine distance (lower = stricter match)
DET_CONFIDENCE         = 0.35     # minimum face detection confidence


# ===========================================================================
#  PIPELINE — Self-contained (no imports from the web backend)
# ===========================================================================

# ---------------------------------------------------------------------------
# 1. Detector / Embedder (InsightFace)
# ---------------------------------------------------------------------------

class Detector:
    def __init__(self):
        self.app = None

    def load(self):
        from insightface.app import FaceAnalysis
        self.app = FaceAnalysis(name="buffalo_l", allowed_modules=["detection", "recognition"])
        self.app.prepare(ctx_id=-1, det_size=(640, 640))   # -1 = CPU
        print("[Detector] Loaded  (RetinaFace + ArcFace  •  CPU)")

    def detect_and_embed(self, frame):
        """Full detection + ArcFace embedding — used on anchor frames."""
        faces = self.app.get(frame)
        results = []
        for f in faces:
            if f.det_score < DET_CONFIDENCE:
                continue
            x1, y1, x2, y2 = f.bbox.astype(int)
            emb = f.normed_embedding.astype(np.float32) if f.normed_embedding is not None else None
            kps = f.kps.astype(np.float32) if f.kps is not None else None
            results.append(dict(bbox=[x1,y1,x2,y2], score=float(f.det_score), emb=emb, kps=kps))
        results.sort(key=lambda r: r["score"], reverse=True)
        return results

    def detect_only(self, frame):
        """Detection only (no embedding) — used on tracker frames."""
        det_model = None
        if isinstance(self.app.models, dict):
            det_model = self.app.models.get("detection")
        elif isinstance(self.app.models, list):
            for m in self.app.models:
                if hasattr(m, "detect"):
                    det_model = m
                    break

        if det_model is None:
            return self.detect_and_embed(frame)  # fallback

        bboxes, kpss = det_model.detect(frame, max_num=0, metric="default")
        results = []
        if bboxes is None or bboxes.shape[0] == 0:
            return results
        for i in range(bboxes.shape[0]):
            score = float(bboxes[i, 4])
            if score < DET_CONFIDENCE:
                continue
            x1, y1, x2, y2 = bboxes[i, :4].astype(int)
            kps = kpss[i].astype(np.float32) if kpss is not None else None
            results.append(dict(bbox=[x1,y1,x2,y2], score=score, emb=None, kps=kps))
        results.sort(key=lambda r: r["score"], reverse=True)
        return results


# ---------------------------------------------------------------------------
# 2. FAISS Identity Index
# ---------------------------------------------------------------------------

class FaceIndex:
    """Stores enrolled face embeddings and does nearest-neighbour lookup."""
    def __init__(self):
        self.names: List[str] = []
        self.embeddings: List[np.ndarray] = []

    def enroll(self, name: str, embedding: np.ndarray):
        self.names.append(name)
        self.embeddings.append(embedding.astype(np.float32))
        print(f"[Index] Enrolled: {name}")

    def query(self, embedding: np.ndarray) -> Optional[str]:
        if not self.embeddings or embedding is None:
            return None
        emb = embedding.astype(np.float32)
        best_dist = float("inf")
        best_name = None
        for n, e in zip(self.names, self.embeddings):
            dist = 1.0 - float(np.dot(emb, e))   # cosine distance (both normed)
            if dist < best_dist:
                best_dist = dist
                best_name = n
        if best_dist < FAISS_THRESHOLD:
            return best_name
        return None   # UNKNOWN


# ---------------------------------------------------------------------------
# 3. Pose Estimator — 2D landmark ratio method (no solvePnP ambiguity)
# ---------------------------------------------------------------------------

@dataclass
class Pose:
    pitch: float = 0.0
    yaw: float   = 0.0
    roll: float  = 0.0


def estimate_pose(kps: np.ndarray) -> Optional[Pose]:
    """
    2D geometric method.
    kps order (InsightFace):
      [0] person's left eye   (image right)
      [1] person's right eye  (image left)
      [2] nose tip
      [3] person's left mouth corner
      [4] person's right mouth corner
    """
    if kps is None or len(kps) != 5:
        return None

    le, re, nose, lm, rm = [kps[i].astype(np.float64) for i in range(5)]

    eye_dist = np.linalg.norm(le - re)
    if eye_dist < 3:
        return None

    # YAW: ratio of left-eye-to-nose vs right-eye-to-nose distance
    dl = np.linalg.norm(le - nose)
    dr = np.linalg.norm(re - nose)
    yaw_ratio = (dl - dr) / (dl + dr + 1e-6)
    yaw = float(yaw_ratio * 130.0)

    # PITCH: vertical position of nose between eye midpoint and mouth midpoint
    eye_mid   = (le + re) / 2
    mouth_mid = (lm + rm) / 2
    face_h = np.linalg.norm(eye_mid - mouth_mid)
    if face_h < 3:
        return None
    nose_pos = np.dot(nose - eye_mid, mouth_mid - eye_mid) / (face_h ** 2)
    pitch = float(-(nose_pos - 0.38) * 130.0)

    # ROLL: inter-ocular line angle
    dy = re[1] - le[1]
    dx = re[0] - le[0]
    roll = float(np.degrees(np.arctan2(dy, dx)))
    if roll > 90:   roll -= 180
    elif roll < -90: roll += 180

    return Pose(pitch=round(pitch, 1), yaw=round(yaw, 1), roll=round(roll, 1))


# ---------------------------------------------------------------------------
# 4. Pure-Python IoU Tracker
# ---------------------------------------------------------------------------

def _iou(a, b):
    xA, yA = max(a[0], b[0]), max(a[1], b[1])
    xB, yB = min(a[2], b[2]), min(a[3], b[3])
    inter  = max(0, xB-xA) * max(0, yB-yA)
    aA     = (a[2]-a[0]) * (a[3]-a[1])
    aB     = (b[2]-b[0]) * (b[3]-b[1])
    return inter / float(aA + aB - inter + 1e-5)

IOU_MATCH = 0.05   # super-loose: 5% overlap keeps the ID

@dataclass
class Track:
    tid:   int
    name:  Optional[str]
    bbox:  List[int]
    score: float = 1.0
    age:   int   = 0       # frames since last matched detection

class Tracker:
    def __init__(self, max_age=30):
        self._tracks: Dict[int, Track] = {}
        self._next   = 0
        self._max_age = max_age

    def init(self, detections, names):
        """Anchor frame: match detections to existing tracks or create new ones."""
        new_tracks = {}
        used = set()

        for tid, tr in self._tracks.items():
            best_iou, best_i = 0.0, -1
            for i, d in enumerate(detections):
                if i in used:
                    continue
                v = _iou(tr.bbox, d["bbox"])
                if v > best_iou:
                    best_iou, best_i = v, i
            if best_i != -1 and best_iou >= IOU_MATCH:
                used.add(best_i)
                name = names[best_i] or tr.name   # keep old identity if new unknown
                tr.bbox  = detections[best_i]["bbox"]
                tr.score = detections[best_i]["score"]
                tr.name  = name
                tr.age   = 0
                new_tracks[tid] = tr

        for i, d in enumerate(detections):
            if i not in used:
                tid = self._next; self._next += 1
                new_tracks[tid] = Track(tid=tid, name=names[i], bbox=d["bbox"], score=d["score"])

        self._tracks = new_tracks
        return list(self._tracks.values())

    def update(self, detections):
        """Tracker frame: match detections to existing tracks."""
        matched = set()
        used    = set()

        for tid, tr in self._tracks.items():
            best_iou, best_i = 0.0, -1
            for i, d in enumerate(detections):
                if i in used:
                    continue
                v = _iou(tr.bbox, d["bbox"])
                if v > best_iou:
                    best_iou, best_i = v, i
            if best_i != -1 and best_iou >= IOU_MATCH:
                used.add(best_i)
                matched.add(tid)
                tr.bbox  = detections[best_i]["bbox"]
                tr.score = detections[best_i]["score"]
                tr.age   = 0

        # Age missing tracks
        for tid in list(self._tracks.keys()):
            if tid not in matched:
                self._tracks[tid].age += 1
                if self._tracks[tid].age >= self._max_age:
                    del self._tracks[tid]

        # New faces that didn't match anyone
        for i, d in enumerate(detections):
            if i not in used:
                tid = self._next; self._next += 1
                self._tracks[tid] = Track(tid=tid, name=None, bbox=d["bbox"], score=d["score"])

        return list(self._tracks.values())

    def reset(self):
        self._tracks.clear()


# ---------------------------------------------------------------------------
# 5. Focus State Machine
# ---------------------------------------------------------------------------

FOCUSED   = "FOCUSED"
NOT_FOCUS = "NOT FOCUS"

@dataclass
class StudentFSM:
    name:  str
    status: str = FOCUSED
    distraction_start: Optional[float] = None
    event_logged: bool = False

class FSM:
    def __init__(self):
        self._states: Dict[str, StudentFSM] = {}

    def update(self, name: str, pose: Optional[Pose]) -> str:
        if name not in self._states:
            self._states[name] = StudentFSM(name=name)
        s   = self._states[name]
        now = time.time()

        if pose is None:
            return s.status

        yaw   = pose.yaw
        pitch = pose.pitch

        # Instant NOT_FOCUS for strong lateral turns
        if abs(yaw) > INSTANT_YAW:
            s.status = NOT_FOCUS
            s.distraction_start = now
            s.event_logged = True
            return s.status

        distracted = (abs(yaw) > YAW_THRESHOLD) or (abs(pitch) > PITCH_THRESHOLD)

        if distracted:
            if s.distraction_start is None:
                s.distraction_start = now
                s.event_logged = False
            elif not s.event_logged and (now - s.distraction_start) >= DISTRACTION_TIMER:
                s.status = NOT_FOCUS
                s.event_logged = True
        else:
            s.distraction_start = None
            s.event_logged      = False
            s.status            = FOCUSED

        return s.status

    def get(self, name: str) -> str:
        return self._states.get(name, StudentFSM(name=name)).status

    def reset(self):
        self._states.clear()


# ===========================================================================
#  DRAWING HELPERS
# ===========================================================================

FOCUSED_COLOR   = (50, 220, 50)    # green
DISTRACT_COLOR  = (30,  30, 220)   # red (BGR)
UNKNOWN_COLOR   = (180, 180,  50)  # yellow

FONT      = cv2.FONT_HERSHEY_DUPLEX
FONT_BOLD = cv2.FONT_HERSHEY_TRIPLEX


def draw_rounded_rect(img, x1, y1, x2, y2, color, thickness=2, radius=12):
    """Draw a rounded-corner bounding box."""
    pts = [
        (x1+radius, y1), (x2-radius, y1),
        (x2, y1+radius), (x2, y2-radius),
        (x2-radius, y2), (x1+radius, y2),
        (x1, y2-radius), (x1, y1+radius),
    ]
    cv2.line(img, pts[0], pts[1], color, thickness)
    cv2.line(img, pts[2], pts[3], color, thickness)
    cv2.line(img, pts[4], pts[5], color, thickness)
    cv2.line(img, pts[6], pts[7], color, thickness)
    cv2.ellipse(img, (x1+radius, y1+radius), (radius,radius), 180, 0, 90, color, thickness)
    cv2.ellipse(img, (x2-radius, y1+radius), (radius,radius), 270, 0, 90, color, thickness)
    cv2.ellipse(img, (x2-radius, y2-radius), (radius,radius),   0, 0, 90, color, thickness)
    cv2.ellipse(img, (x1+radius, y2-radius), (radius,radius),  90, 0, 90, color, thickness)


def draw_face(img, track: Track, pose: Optional[Pose], status: str, show_kps: bool, kps=None):
    x1, y1, x2, y2 = track.bbox
    color  = FOCUSED_COLOR if status == FOCUSED else (UNKNOWN_COLOR if track.name is None else DISTRACT_COLOR)
    name   = track.name if track.name else "UNKNOWN"

    # Rounded bbox
    draw_rounded_rect(img, x1, y1, x2, y2, color, thickness=2)

    # ---- Top label bar ----
    label_h = 28
    cv2.rectangle(img, (x1, y1 - label_h), (x2, y1), color, -1)
    cv2.putText(img, f"#{track.tid}  {name}", (x1+6, y1-8),
                FONT, 0.55, (0,0,0), 1, cv2.LINE_AA)

    # ---- Status badge (bottom of box) ----
    badge_color = FOCUSED_COLOR if status == FOCUSED else DISTRACT_COLOR
    badge_text  = "  FOCUSED  " if status == FOCUSED else " NOT FOCUS "
    bw, bh = cv2.getTextSize(badge_text, FONT, 0.55, 1)[0]
    bx = x1 + (x2-x1-bw)//2
    cv2.rectangle(img, (bx-4, y2+2), (bx+bw+4, y2+bh+10), badge_color, -1)
    cv2.putText(img, badge_text, (bx, y2+bh+4),
                FONT, 0.55, (0,0,0), 1, cv2.LINE_AA)

    # ---- Pose angles ----
    if pose:
        pitch_str = f"P:{pose.pitch:+.1f}"
        yaw_str   = f"Y:{pose.yaw:+.1f}"
        cv2.putText(img, f"{pitch_str}  {yaw_str}", (x1+4, y2+bh+32),
                    FONT, 0.48, (220,220,220), 1, cv2.LINE_AA)

        # Yaw meter bar inside the bounding box (bottom area)
        bar_x1  = x1 + 8
        bar_x2  = x2 - 8
        bar_y   = y2 - 14
        bar_w   = bar_x2 - bar_x1
        mid     = bar_x1 + bar_w // 2
        cv2.rectangle(img, (bar_x1, bar_y-4), (bar_x2, bar_y+4), (60,60,60), -1)
        cv2.line(img, (mid, bar_y-6), (mid, bar_y+6), (120,120,120), 1)
        yaw_norm = max(-1.0, min(1.0, pose.yaw / 60.0))
        indicator_x = int(mid + yaw_norm * (bar_w // 2))
        ind_color = DISTRACT_COLOR if abs(pose.yaw) > YAW_THRESHOLD else FOCUSED_COLOR
        cv2.circle(img, (indicator_x, bar_y), 6, ind_color, -1)

    # ---- Landmark dots ----
    if show_kps and kps is not None:
        for pt in kps:
            cv2.circle(img, (int(pt[0]), int(pt[1])), 3, (0,180,255), -1)


def draw_hud(img, n_focused, n_distracted, n_total, fps, anchor_countdown):
    """Top-left HUD overlay."""
    h, w = img.shape[:2]
    overlay = img.copy()
    cv2.rectangle(overlay, (8, 8), (280, 135), (20,20,20), -1)
    cv2.addWeighted(overlay, 0.65, img, 0.35, 0, img)

    cv2.putText(img, "SEBA  CV  DEMO", (16, 32), FONT_BOLD, 0.65, (100,200,255), 1, cv2.LINE_AA)

    cv2.putText(img, f"Detected : {n_total}",     (16,  58), FONT, 0.52, (220,220,220), 1, cv2.LINE_AA)
    cv2.putText(img, f"Focused  : {n_focused}",   (16,  78), FONT, 0.52, FOCUSED_COLOR,  1, cv2.LINE_AA)
    cv2.putText(img, f"Distract : {n_distracted}",(16,  98), FONT, 0.52, DISTRACT_COLOR, 1, cv2.LINE_AA)
    cv2.putText(img, f"FPS: {fps:.1f}   Anchor in: {anchor_countdown}f",
                (16, 120), FONT, 0.44, (140,140,140), 1, cv2.LINE_AA)

    cv2.putText(img, "Q/ESC=quit   R=reset   F=landmarks",
                (8, h-12), FONT, 0.40, (100,100,100), 1, cv2.LINE_AA)


# ===========================================================================
#  ENROLLMENT FROM PHOTOS
# ===========================================================================

def enroll_from_photos(detector: Detector, index: FaceIndex, pairs: List[str]):
    """pairs = ["Alice", "alice.jpg", "Bob", "bob.jpg", ...]"""
    if len(pairs) % 2 != 0:
        print("[Enroll] ERROR: must provide NAME PHOTO pairs. Skipping.")
        return
    for i in range(0, len(pairs), 2):
        name, path = pairs[i], pairs[i+1]
        img = cv2.imread(path)
        if img is None:
            print(f"[Enroll] Cannot read {path}")
            continue
        faces = detector.detect_and_embed(img)
        if not faces:
            print(f"[Enroll] No face found in {path}")
            continue
        emb = faces[0]["emb"]
        if emb is None:
            print(f"[Enroll] No embedding for {path}")
            continue
        index.enroll(name, emb)


# ===========================================================================
#  INTERACTIVE ENROLLMENT (first time, no photos)
# ===========================================================================

def interactive_enroll(detector: Detector, index: FaceIndex, cam_idx: int):
    """
    Prompts for a name in the terminal, then captures the face when SPACE is pressed.
    Repeats until the user presses Enter without typing a name.
    """
    cap = cv2.VideoCapture(cam_idx)
    if not cap.isOpened():
        print("[Enroll] Cannot open camera")
        return

    print("\n=======================================================")
    print("                 STUDENT ENROLLMENT")
    print("=======================================================")

    while True:
        name = input("\nEnter student name (or press Enter to finish and start tracking): ").strip()
        if not name:
            break

        print(f"--> Switch to the camera window. Position {name}'s face and press SPACE.")
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            display = frame.copy()
            cv2.putText(display, f"Enrolling: {name}", (20,40), FONT_BOLD, 1.0, (0,255,0), 2)
            cv2.putText(display, "Press SPACE to capture face", (20,80), FONT, 0.7, (200,200,200), 1)
            cv2.imshow("Enrollment", display)

            key = cv2.waitKey(1) & 0xFF
            if key == 32:  # SPACE
                faces = detector.detect_and_embed(frame)
                if not faces or faces[0]["emb"] is None:
                    print("    [!] No face detected! Please try again.")
                    continue
                index.enroll(name, faces[0]["emb"])
                print(f"    [+] Success! '{name}' enrolled.")
                break
            elif key == 27:  # ESC
                print("    [-] Cancelled enrollment for this person.")
                break

    cap.release()
    cv2.destroyWindow("Enrollment")



# ===========================================================================
#  MAIN LOOP
# ===========================================================================

def run(camera_idx: int, enroll_pairs: List[str]):
    # --- init ---
    detector = Detector()
    detector.load()

    index   = FaceIndex()
    tracker = Tracker()
    fsm     = FSM()

    # Enroll from photos if provided
    if enroll_pairs:
        enroll_from_photos(detector, index, enroll_pairs)
    else:
        # Interactive webcam enrollment
        interactive_enroll(detector, index, camera_idx)

    cap = cv2.VideoCapture(camera_idx)
    if not cap.isOpened():
        print(f"[Main] Cannot open camera {camera_idx}")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT,  720)
    cap.set(cv2.CAP_PROP_FPS, 30)

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"\n[Main] Camera {camera_idx} @ {w}x{h}")
    print("[Main] Starting live detection...\n")

    frame_count  = 0
    show_kps     = False
    fps_t0       = time.time()
    fps          = 0.0
    last_detects = []   # raw detections from last frame (for kps lookup)

    cv2.namedWindow("SEBA CV Demo", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("SEBA CV Demo", w, h)

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[Main] Camera read failed.")
            break

        t0 = time.time()
        is_anchor = (frame_count % ANCHOR_EVERY_N_FRAMES == 0)

        # ---------- Detection ----------
        if is_anchor:
            detections = detector.detect_and_embed(frame)
            names      = [index.query(d["emb"]) for d in detections]
            tracks     = tracker.init(detections, names)
        else:
            detections = detector.detect_only(frame)
            tracks     = tracker.update(detections)

        last_detects = detections

        # ---------- Pose + FSM per track ----------
        n_focused = n_distracted = 0
        annotated_tracks = []

        for tr in tracks:
            # Find best-matching detection for landmarks
            best_kps = None
            best_iou = 0.0
            for d in last_detects:
                v = _iou(tr.bbox, d["bbox"])
                if v > best_iou and v > 0.05:
                    best_iou = v
                    best_kps = d["kps"]

            pose   = estimate_pose(best_kps)
            name   = tr.name if tr.name else f"Unknown-{tr.tid}"
            status = fsm.update(name, pose)

            if status == FOCUSED:
                n_focused    += 1
            else:
                n_distracted += 1

            annotated_tracks.append((tr, pose, status, best_kps))

        # ---------- Draw ----------
        for tr, pose, status, kps in annotated_tracks:
            draw_face(frame, tr, pose, status, show_kps, kps)

        # FPS calculation
        fps = 0.9 * fps + 0.1 * (1.0 / max(time.time() - t0, 1e-4))
        anchor_countdown = ANCHOR_EVERY_N_FRAMES - (frame_count % ANCHOR_EVERY_N_FRAMES)

        draw_hud(frame, n_focused, n_distracted, len(tracks), fps, anchor_countdown)

        cv2.imshow("SEBA CV Demo", frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), 27):   # Q or ESC
            break
        elif key == ord('r'):       # R = reset
            tracker.reset()
            fsm.reset()
            print("[Main] Tracks reset.")
        elif key == ord('f'):       # F = toggle landmarks
            show_kps = not show_kps
            print(f"[Main] Landmarks {'ON' if show_kps else 'OFF'}")

        frame_count += 1

    cap.release()
    cv2.destroyAllWindows()
    print("[Main] Done.")


# ===========================================================================
#  ENTRY POINT
# ===========================================================================

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="SEBA CV Live Demo")
    ap.add_argument("--camera", type=int, default=0,
                    help="Camera index (default 0 = built-in webcam)")
    ap.add_argument("--enroll", nargs="+", metavar=("NAME", "PHOTO"),
                    help="Pre-enroll students: --enroll Alice alice.jpg Bob bob.jpg")
    args = ap.parse_args()

    run(camera_idx=args.camera, enroll_pairs=args.enroll or [])
