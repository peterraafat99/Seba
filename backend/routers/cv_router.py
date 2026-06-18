"""
CV Router
==========
REST endpoints for CV session management and face enrollment.
WebSocket endpoint for real-time streaming.

Prefix: /api/cv
WebSocket: /ws/cv/{classroom_id}
"""

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.orm import Session

from auth import get_current_user
from cv_analytics.cv_worker import CVWorker
from cv_analytics.faiss_index import ClassFAISSIndex
from cv_analytics.session_manager import ActiveSession, session_manager
from cv_analytics.ws_broadcaster import ws_broadcaster
from cv_analytics.config import FACE_UPLOAD_DIR
from database import SessionLocal
from models import (
    ClassroomStudent,
    CVSession,
    FocusEvent,
    PhysicalClassroom,
    StudentFaceProfile,
    User,
)
from schemas import (
    CVSessionResponse,
    CVSessionStartRequest,
    CVSessionSummaryResponse,
    FaceEnrollResponse,
    FaceProfileStatus,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_teacher_or_above(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("teacher", "admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Teacher access required.")
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin access required.")
    return current_user


# ============================================================
# SESSION MANAGEMENT
# ============================================================

@router.post("/session/start", response_model=CVSessionResponse, status_code=201)
async def start_cv_session(
    data: CVSessionStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """
    Start a CV monitoring session for a physical classroom.

    1. Validates classroom exists and has a camera configured
    2. Checks no session is already running for that classroom
    3. Builds the FAISS index from enrolled student face profiles
    4. Persists a CVSession record to DB
    5. Starts the CVWorker background thread
    """
    # Validate classroom
    classroom = db.query(PhysicalClassroom).filter(
        PhysicalClassroom.id == data.classroom_id
    ).first()
    if not classroom:
        raise HTTPException(404, "Classroom not found.")
    if not classroom.camera_source:
        raise HTTPException(400, "This classroom has no camera configured.")

    # Check not already running
    if session_manager.is_active(data.classroom_id):
        active = session_manager.get(data.classroom_id)
        return CVSessionResponse(
            session_id=active.session_id,
            classroom_id=data.classroom_id,
            session_type=active.session_type,
            status="already_running",
            message="A session is already active for this classroom.",
        )

    # Determine session type (override if classroom is designated exam room)
    session_type = data.session_type
    if classroom.is_exam_room:
        session_type = "exam"

    # Parse exam config overrides from DB
    exam_config = {}
    if classroom.exam_config_json:
        try:
            exam_config = json.loads(classroom.exam_config_json)
        except json.JSONDecodeError:
            logger.warning(f"[CVRouter] Invalid exam_config_json for classroom {data.classroom_id}")

    # Build FAISS index — scoped to this classroom's student roster
    faiss_index = ClassFAISSIndex(classroom_id=data.classroom_id, db=db)
    indexed_count = faiss_index.build()
    logger.info(
        f"[CVRouter] FAISS index built: {indexed_count} student embeddings "
        f"for classroom {data.classroom_id}."
    )

    # Persist CV session record
    cv_session = CVSession(
        classroom_id=data.classroom_id,
        session_type=session_type,
        started_by=current_user.id,
        teacher_id=data.teacher_id if data.teacher_id else (current_user.id if current_user.role == 'teacher' else None),
        course_id=data.course_id,
        lesson_id=data.lesson_id,
    )
    db.add(cv_session)
    db.commit()
    db.refresh(cv_session)

    # DB event callback (non-blocking — called from worker thread)
    def persist_focus_event(
        session_id: int,
        student_id: Optional[str],
        event_type: str,
        pitch: float,
        yaw: float,
        timestamp: float,
    ):
        """Write a FocusEvent to DB. Called from the CV worker thread."""
        try:
            event_db = SessionLocal()
            try:
                sid_int = int(student_id) if student_id and student_id != "UNKNOWN" else None
                event = FocusEvent(
                    session_id=session_id,
                    student_id=sid_int,
                    event_type=event_type,
                    pitch=pitch,
                    yaw=yaw,
                    started_at=datetime.fromtimestamp(timestamp, tz=timezone.utc),
                )
                event_db.add(event)
                event_db.commit()
            finally:
                event_db.close()
        except Exception as e:
            logger.error(f"[CVRouter] DB persist error: {e}")

    # Start CV worker thread
    worker = CVWorker(
        session_id=cv_session.id,
        classroom_id=data.classroom_id,
        session_type=session_type,
        camera_source=classroom.camera_source,
        faiss_index=faiss_index,
        exam_config=exam_config,
        db_event_callback=persist_focus_event,
    )
    worker.start()

    # Register in session manager
    active_session = ActiveSession(
        session_id=cv_session.id,
        classroom_id=data.classroom_id,
        session_type=session_type,
        worker=worker,
        started_by=current_user.id,
    )
    session_manager.register(data.classroom_id, active_session)

    return CVSessionResponse(
        session_id=cv_session.id,
        classroom_id=data.classroom_id,
        session_type=session_type,
        status="started",
        message=f"CV session started. {indexed_count} student faces indexed.",
    )


@router.post("/session/stop", status_code=200)
async def stop_cv_session(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """
    Stop the active CV session for a classroom.
    Saves an analytics summary to the CVSession record.
    """
    active = session_manager.get(classroom_id)
    if not active:
        raise HTTPException(404, f"No active CV session for classroom {classroom_id}.")

    # Signal worker to stop
    worker = active.worker
    if hasattr(worker, "stop"):
        worker.stop()

    # Unregister
    session_manager.unregister(classroom_id)

    # Compute summary from DB focus events
    cv_session = db.query(CVSession).filter(CVSession.id == active.session_id).first()
    if cv_session:
        now = datetime.now(timezone.utc)
        cv_session.ended_at = now

        # Build summary JSON
        events = (
            db.query(FocusEvent)
            .filter(FocusEvent.session_id == active.session_id)
            .all()
        )
        distracted_events = [e for e in events if e.event_type == "distracted"]
        exam_events = [e for e in events if e.event_type in ("neighbor_glance", "rapid_scan")]

        summary = {
            "total_events": len(events),
            "distracted_events": len(distracted_events),
            "exam_flag_events": len(exam_events),
            "unique_students_flagged": len(
                {e.student_id for e in distracted_events if e.student_id}
            ),
            "duration_seconds": (
                (now - cv_session.started_at.replace(tzinfo=timezone.utc)).total_seconds()
                if cv_session.started_at
                else 0
            ),
        }
        cv_session.summary_json = json.dumps(summary)
        db.commit()

    # Stop WebSocket broadcaster
    ws_broadcaster.remove_manager(classroom_id)

    return {
        "status": "stopped",
        "session_id": active.session_id,
        "classroom_id": classroom_id,
    }


@router.get("/session/{session_id}/summary", response_model=CVSessionSummaryResponse)
async def get_session_summary(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Retrieve saved analytics summary for a completed session."""
    cv_session = db.query(CVSession).filter(CVSession.id == session_id).first()
    if not cv_session:
        raise HTTPException(404, "Session not found.")

    duration = None
    if cv_session.started_at and cv_session.ended_at:
        duration = round(
            (cv_session.ended_at - cv_session.started_at).total_seconds() / 60, 2
        )

    summary = None
    if cv_session.summary_json:
        try:
            summary = json.loads(cv_session.summary_json)
        except json.JSONDecodeError:
            pass

    return CVSessionSummaryResponse(
        session_id=cv_session.id,
        classroom_id=cv_session.classroom_id,
        session_type=cv_session.session_type,
        started_at=cv_session.started_at.isoformat() if cv_session.started_at else "",
        ended_at=cv_session.ended_at.isoformat() if cv_session.ended_at else None,
        duration_minutes=duration,
        summary=summary,
    )


@router.get("/session/classroom/{classroom_id}/history")
async def get_session_history(
    classroom_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Return the last N completed sessions for a classroom."""
    sessions = (
        db.query(CVSession)
        .filter(CVSession.classroom_id == classroom_id)
        .order_by(CVSession.started_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "session_id": s.id,
            "session_type": s.session_type,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "summary": json.loads(s.summary_json) if s.summary_json else None,
        }
        for s in sessions
    ]


# ============================================================
# FACE ENROLLMENT
# ============================================================

@router.post("/faces/enroll", response_model=FaceEnrollResponse)
async def enroll_face(
    student_id: int = Form(...),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """
    Upload a student photo, extract the ArcFace embedding, and save to DB.
    Replaces existing profile if one exists (update mode).

    Requires insightface to be installed and models downloaded.
    """
    student = db.query(User).filter(
        User.id == student_id, User.role == "student", User.is_deleted == False
    ).first()
    if not student:
        raise HTTPException(404, "Student not found.")

    # Save uploaded photo
    os.makedirs(FACE_UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(photo.filename or "face.jpg")[1] or ".jpg"
    photo_path = os.path.join(FACE_UPLOAD_DIR, f"student_{student_id}{ext}")
    with open(photo_path, "wb") as f:
        shutil.copyfileobj(photo.file, f)

    # Extract embedding via InsightFace
    try:
        import cv2
        import numpy as np
        from insightface.app import FaceAnalysis
        from cv_analytics.config import INSIGHTFACE_CTX_ID, INSIGHTFACE_MODEL_PACK

        app = FaceAnalysis(
            name=INSIGHTFACE_MODEL_PACK,
            allowed_modules=["detection", "recognition"],
        )
        app.prepare(ctx_id=INSIGHTFACE_CTX_ID, det_size=(640, 640))

        img = cv2.imread(photo_path)
        if img is None:
            raise ValueError("Could not read uploaded image.")

        faces = app.get(img)
        if not faces:
            return FaceEnrollResponse(
                student_id=student_id,
                student_name=student.name,
                status="failed",
                message="No face detected in the uploaded photo. Please use a clear frontal photo.",
            )
        if len(faces) > 1:
            return FaceEnrollResponse(
                student_id=student_id,
                student_name=student.name,
                status="failed",
                message=f"{len(faces)} faces detected. Please upload a photo with only the student.",
            )

        embedding = faces[0].normed_embedding  # 512-d, L2-normalized
        encoded = ClassFAISSIndex.encode_embedding(embedding)

    except ImportError:
        return FaceEnrollResponse(
            student_id=student_id,
            student_name=student.name,
            status="failed",
            message="insightface not installed. Run: pip install insightface onnxruntime-gpu",
        )
    except Exception as e:
        logger.error(f"[CVRouter] Face enrollment error for student {student_id}: {e}")
        return FaceEnrollResponse(
            student_id=student_id,
            student_name=student.name,
            status="failed",
            message=f"Embedding extraction failed: {str(e)}",
        )

    # Save or update profile in DB
    existing = db.query(StudentFaceProfile).filter(
        StudentFaceProfile.student_id == student_id
    ).first()

    is_update = existing is not None
    if existing:
        existing.embedding = encoded
        existing.photo_url = photo_path
        existing.enrolled_by = current_user.id
    else:
        db.add(StudentFaceProfile(
            student_id=student_id,
            embedding=encoded,
            photo_url=photo_path,
            enrolled_by=current_user.id,
        ))

    db.commit()
    action = "updated" if is_update else "enrolled"
    logger.info(f"[CVRouter] Face profile {action} for student {student_id}.")

    return FaceEnrollResponse(
        student_id=student_id,
        student_name=student.name,
        status=action,
        message=f"Face profile {action} successfully.",
    )


@router.post("/faces/seed", status_code=200)
async def seed_face_profiles(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Bulk seed pre-computed embeddings for testing.
    Expected payload: {"students": [{"student_id": 1, "embedding": "<base64>"}]}
    """
    students_data = payload.get("students", [])
    seeded = 0
    for item in students_data:
        sid = item.get("student_id")
        enc = item.get("embedding")
        if not sid or not enc:
            continue
        existing = db.query(StudentFaceProfile).filter(
            StudentFaceProfile.student_id == sid
        ).first()
        if existing:
            existing.embedding = enc
            existing.enrolled_by = current_user.id
        else:
            db.add(StudentFaceProfile(
                student_id=sid,
                embedding=enc,
                enrolled_by=current_user.id,
            ))
        seeded += 1

    db.commit()
    return {"status": "success", "seeded": seeded}


@router.get("/faces/{student_id}", response_model=FaceProfileStatus)
async def get_face_profile_status(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    profile = db.query(StudentFaceProfile).filter(
        StudentFaceProfile.student_id == student_id
    ).first()
    return FaceProfileStatus(
        student_id=student_id,
        has_profile=profile is not None,
        photo_url=profile.photo_url if profile else None,
        enrolled_at=profile.created_at.isoformat() if profile and profile.created_at else None,
    )


@router.delete("/faces/{student_id}", status_code=200)
async def delete_face_profile(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    profile = db.query(StudentFaceProfile).filter(
        StudentFaceProfile.student_id == student_id
    ).first()
    if not profile:
        raise HTTPException(404, "Face profile not found.")
    db.delete(profile)
    db.commit()
    return {"status": "deleted", "student_id": student_id}


# ============================================================
# WEBSOCKET
# ============================================================

@router.websocket("/ws/{classroom_id}")
async def websocket_cv_stream(classroom_id: int, websocket: WebSocket):
    """
    Real-time CV analytics stream for a classroom.
    Connect: ws://localhost:8000/ws/cv/{classroom_id}

    Emits JSON payloads every frame update or on 1-second heartbeat.
    """
    manager = ws_broadcaster.get_manager(classroom_id)
    await manager.connect(websocket)
    try:
        await manager.listen(websocket)
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
