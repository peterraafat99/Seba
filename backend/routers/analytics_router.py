"""
Analytics Router
=================
Aggregated dashboard queries merging platform + physical world data.

Prefix: /api/analytics
"""

import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from database import SessionLocal
from models import (
    Activity,
    ClassroomStudent,
    CVSession,
    FocusEvent,
    LessonProgress,
    PhysicalClassroom,
    School,
    StudentFaceProfile,
    StudentSentiment,
    User,
    Enrollment,
    Grade,
)
from schemas import ClassroomAnalyticsResponse, StudentAnalyticsResponse

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
        raise HTTPException(403, "Teacher access required.")
    return current_user


# ============================================================
# STUDENT — Full merged profile
# ============================================================

@router.get("/student/{student_id}", response_model=StudentAnalyticsResponse)
async def get_student_analytics(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """
    Return a fully merged analytics profile for a student combining:
    - Platform world: course enrollments, quiz scores, time spent, chatbot sentiments
    - Physical world: CV session focus events, avg focus rate, flags
    """
    student = db.query(User).filter(
        User.id == student_id, User.is_deleted == False
    ).first()
    if not student:
        raise HTTPException(404, "Student not found.")

    # ---- Platform World ----
    enrollments = db.query(Enrollment).filter(Enrollment.student_id == student_id).all()
    total_time_sec = (
        db.query(func.sum(LessonProgress.time_spent_seconds))
        .filter(LessonProgress.user_id == student_id)
        .scalar() or 0
    )
    quiz_activities = (
        db.query(Activity)
        .filter(
            Activity.user_id == student_id,
            Activity.activity_type == "quiz_submitted",
        )
        .order_by(Activity.created_at.desc())
        .limit(10)
        .all()
    )
    quiz_scores = []
    for act in quiz_activities:
        try:
            score = int(act.description.split("Score: ")[1].split("%")[0])
            quiz_scores.append(score)
        except (IndexError, ValueError):
            pass

    sentiments = (
        db.query(StudentSentiment)
        .filter(StudentSentiment.student_id == student_id)
        .order_by(StudentSentiment.created_at.desc())
        .limit(5)
        .all()
    )

    platform_data = {
        "courses_enrolled": len(enrollments),
        "total_time_spent_minutes": round(total_time_sec / 60, 1),
        "avg_quiz_score": round(sum(quiz_scores) / len(quiz_scores), 1) if quiz_scores else None,
        "recent_quiz_scores": quiz_scores,
        "recent_sentiments": [
            {"label": s.sentiment_label, "score": s.confidence_score}
            for s in sentiments
        ],
    }

    # ---- Physical World ----
    # Get all CV sessions where this student appeared (via FocusEvents)
    focus_events = (
        db.query(FocusEvent)
        .filter(FocusEvent.student_id == student_id)
        .all()
    )

    distracted_events = [e for e in focus_events if e.event_type == "distracted"]
    recovered_events = [e for e in focus_events if e.event_type == "recovered"]
    exam_flags = [e for e in focus_events if e.event_type in ("neighbor_glance", "rapid_scan")]

    # Calculate avg focus rate from sessions
    sessions_with_student = (
        db.query(CVSession)
        .join(FocusEvent, FocusEvent.session_id == CVSession.id)
        .filter(FocusEvent.student_id == student_id)
        .distinct()
        .all()
    )

    physical_data = {
        "total_cv_sessions": len(sessions_with_student),
        "total_distraction_events": len(distracted_events),
        "total_exam_flags": len(exam_flags),
        "exam_flag_breakdown": {
            "neighbor_glance": sum(1 for e in exam_flags if e.event_type == "neighbor_glance"),
            "rapid_scan": sum(1 for e in exam_flags if e.event_type == "rapid_scan"),
        },
        "has_face_profile": db.query(StudentFaceProfile).filter(
            StudentFaceProfile.student_id == student_id
        ).first() is not None,
    }

    # ---- Engagement Score (composite) ----
    # Simple weighted formula — can be refined with ML later
    quiz_factor = min(100, (sum(quiz_scores) / len(quiz_scores)) if quiz_scores else 50)
    focus_penalty = min(50, len(distracted_events) * 2)
    engagement_score = round(max(0.0, quiz_factor - focus_penalty), 1)

    # ---- Flags ----
    flags = []
    if len(distracted_events) > 5:
        flags.append("high_distraction_frequency")
    if len(exam_flags) > 0:
        flags.append("exam_integrity_concerns")
    if quiz_scores and sum(quiz_scores) / len(quiz_scores) < 60:
        flags.append("low_quiz_performance")
    if total_time_sec < 1800 and len(enrollments) > 0:
        flags.append("low_platform_engagement")

    return StudentAnalyticsResponse(
        student_id=student_id,
        name=student.name,
        platform=platform_data,
        physical=physical_data,
        engagement_score=engagement_score,
        flags=flags,
    )


# ============================================================
# CLASSROOM — Aggregated focus analytics
# ============================================================

@router.get("/classroom/{classroom_id}", response_model=ClassroomAnalyticsResponse)
async def get_classroom_analytics(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Classroom-level analytics: session history + per-session focus stats."""
    classroom = db.query(PhysicalClassroom).filter(
        PhysicalClassroom.id == classroom_id
    ).first()
    if not classroom:
        raise HTTPException(404, "Classroom not found.")

    sessions = (
        db.query(CVSession)
        .filter(CVSession.classroom_id == classroom_id, CVSession.ended_at.isnot(None))
        .order_by(CVSession.started_at.desc())
        .limit(20)
        .all()
    )

    # Total enrolled students
    total_students = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.is_active == True,
        )
        .count()
    )

    session_summaries = []
    focus_rates = []
    for s in sessions:
        summary = {}
        if s.summary_json:
            try:
                summary = json.loads(s.summary_json)
            except Exception:
                pass

        # Compute per-session focus rate from FocusEvents
        session_events = (
            db.query(FocusEvent).filter(FocusEvent.session_id == s.id).all()
        )
        flagged_students = {e.student_id for e in session_events if e.event_type == "distracted"}
        focus_rate = (
            round((1 - len(flagged_students) / total_students) * 100, 1)
            if total_students > 0
            else 100.0
        )
        focus_rates.append(focus_rate)

        duration_min = None
        if s.started_at and s.ended_at:
            duration_min = round((s.ended_at - s.started_at).total_seconds() / 60, 1)

        session_summaries.append({
            "session_id": s.id,
            "session_type": s.session_type,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "duration_minutes": duration_min,
            "focus_rate": focus_rate,
            "distracted_students": len(flagged_students),
            "summary": summary,
        })

    avg_focus = round(sum(focus_rates) / len(focus_rates), 1) if focus_rates else 0.0

    return ClassroomAnalyticsResponse(
        classroom_id=classroom_id,
        classroom_name=classroom.name,
        total_sessions=len(sessions),
        avg_focus_rate=avg_focus,
        total_students=total_students,
        sessions=session_summaries,
    )


# ============================================================
# SCHOOL — High-level overview
# ============================================================

@router.get("/school/{school_id}")
async def get_school_analytics(
    school_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """School-level dashboard: all classrooms with focus rates and student counts."""
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(404, "School not found.")

    grades = db.query(Grade).filter(Grade.school_id == school_id).all()
    grade_ids = [g.id for g in grades]
    classrooms = (
        db.query(PhysicalClassroom)
        .filter(PhysicalClassroom.grade_id.in_(grade_ids))
        .all()
    )

    classroom_stats = []
    for c in classrooms:
        student_count = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == c.id,
                ClassroomStudent.is_active == True,
            )
            .count()
        )
        last_session = (
            db.query(CVSession)
            .filter(CVSession.classroom_id == c.id)
            .order_by(CVSession.started_at.desc())
            .first()
        )
        classroom_stats.append({
            "classroom_id": c.id,
            "name": c.name,
            "grade": next((g.name for g in grades if g.id == c.grade_id), ""),
            "student_count": student_count,
            "is_exam_room": c.is_exam_room,
            "has_camera": bool(c.camera_source),
            "last_session_at": (
                last_session.started_at.isoformat()
                if last_session and last_session.started_at
                else None
            ),
        })

    return {
        "school_id": school_id,
        "school_name": school.name,
        "total_classrooms": len(classrooms),
        "total_grades": len(grades),
        "classrooms": classroom_stats,
    }
