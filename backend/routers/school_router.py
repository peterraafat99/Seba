"""
School Router
=============
CRUD endpoints for Schools, Grades, and Physical Classrooms.
Also manages classroom rosters (students & teachers) and timetables.

Prefix: /api/school
"""

import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user, get_password_hash
from database import SessionLocal
from models import (
    ClassroomStudent,
    ClassroomTeacher,
    ClassSchedule,
    Grade,
    PhysicalClassroom,
    School,
    StudentFaceProfile,
    User,
    ClassroomMessage,
)
from schemas import (
    AddStudentsRequest,
    AssignTeacherRequest,
    ClassroomCreate,
    ClassroomDetailResponse,
    ClassroomResponse,
    GradeCreate,
    GradeResponse,
    ScheduleSlotCreate,
    ScheduleSlotResponse,
    SchoolCreate,
    SchoolResponse,
    StudentRosterItem,
    UserCreate,
    UserResponse,
    ClassroomMessageCreate,
    ClassroomMessageResponse,
    CounselorReportSaveRequest,
    CounselorReportResponse,
)
from llm_client import get_llm_client


logger = logging.getLogger(__name__)
router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Enforce admin, school_admin, or super_admin role."""
    if current_user.role not in ("admin", "school_admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return current_user


def require_teacher_or_above(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("teacher", "admin", "school_admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher access required.",
        )
    return current_user


# ============================================================
# SCHOOL ENDPOINTS
# ============================================================

@router.post("/", response_model=SchoolResponse, status_code=201)
async def create_school(
    data: SchoolCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new school. Super-admin only in multi-school production."""
    school = School(name=data.name, address=data.address, logo_url=data.logo_url)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@router.get("/", response_model=List[SchoolResponse])
async def list_schools(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """List all schools or user-restricted schools."""
    if current_user.role == "super_admin":
        return db.query(School).all()
    
    if current_user.school_id is not None:
        return db.query(School).filter(School.id == current_user.school_id).all()
        
    return []


# ============================================================
# USER MANAGEMENT (SCOPED)
# ============================================================

@router.post("/users", response_model=UserResponse, status_code=201)
async def create_school_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a student, teacher, or school_admin within RBAC bounds."""
    # Check email duplicate
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Role check
    if data.role == "super_admin" and current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super_admins can create other super_admins.",
        )

    # School assignment boundaries
    if current_user.role != "super_admin":
        # Force the user to be created in the current user's school
        if data.school_id is not None and data.school_id != current_user.school_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only create users for your own school.",
            )
        data.school_id = current_user.school_id

    hashed_pw = get_password_hash(data.password if data.password else "default123")
    new_user = User(
        name=data.name,
        email=data.email,
        hashed_password=hashed_pw,
        role=data.role,
        school_id=data.school_id,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.get("/users", response_model=List[UserResponse])
async def list_school_users(
    role: Optional[str] = None,
    school_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """List users in the school, filterable by role."""
    query = db.query(User).filter(User.is_deleted == False)

    if current_user.role != "super_admin":
        # Enforce scoping
        query = query.filter(User.school_id == current_user.school_id)
    elif school_id is not None:
        query = query.filter(User.school_id == school_id)

    if role:
        query = query.filter(User.role == role)

    return query.all()


@router.get("/{school_id}", response_model=SchoolResponse)
async def get_school(
    school_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(404, "School not found.")
    return school


# ============================================================
# GRADE ENDPOINTS
# ============================================================

@router.get("/{school_id}/grades", response_model=List[GradeResponse])
async def list_grades(
    school_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    return db.query(Grade).filter(Grade.school_id == school_id).all()


@router.post("/{school_id}/grades", response_model=GradeResponse, status_code=201)
async def create_grade(
    school_id: int,
    data: GradeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(404, "School not found.")
    grade = Grade(school_id=school_id, name=data.name, academic_year=data.academic_year)
    db.add(grade)
    db.commit()
    db.refresh(grade)
    return grade


# ============================================================
# PHYSICAL CLASSROOM ENDPOINTS
# ============================================================

@router.get("/{school_id}/classrooms", response_model=List[ClassroomResponse])
async def list_classrooms(
    school_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """List all classrooms in a school (across all grades) with role scopes."""
    # Enforce school access limits unless super_admin
    if current_user.role != "super_admin" and current_user.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to this school's classrooms is denied.",
        )
        
    # If teacher, only return classrooms assigned to them in this school
    if current_user.role == "teacher":
        teacher_links = db.query(ClassroomTeacher).filter(
            ClassroomTeacher.teacher_id == current_user.id
        ).all()
        assigned_classroom_ids = [link.classroom_id for link in teacher_links]
        return (
            db.query(PhysicalClassroom)
            .filter(PhysicalClassroom.id.in_(assigned_classroom_ids))
            .all()
        )
        
    grades = db.query(Grade).filter(Grade.school_id == school_id).all()
    grade_ids = [g.id for g in grades]
    return (
        db.query(PhysicalClassroom)
        .filter(PhysicalClassroom.grade_id.in_(grade_ids))
        .all()
    )


@router.post("/grades/{grade_id}/classrooms", response_model=ClassroomResponse, status_code=201)
async def create_classroom(
    grade_id: int,
    data: ClassroomCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new physical classroom inside a grade."""
    grade = db.query(Grade).filter(Grade.id == grade_id).first()
    if not grade:
        raise HTTPException(404, "Grade not found.")
    classroom = PhysicalClassroom(
        grade_id=grade_id,
        name=data.name,
        room_number=data.room_number,
        capacity=data.capacity,
        camera_source=data.camera_source or "0",
        is_exam_room=data.is_exam_room,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    return classroom


@router.patch("/classrooms/{classroom_id}/config", status_code=200)
async def update_classroom_config(
    classroom_id: int,
    config: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """
    Update a classroom's tracking thresholds and exam configuration.

    Expected payload (all keys optional):
    {
        "pitch_threshold": 20.0,
        "yaw_threshold": 30.0,
        "distraction_timer_sec": 10.0,
        "is_exam_room": false,
        "neighbor_yaw_threshold": 25.0,
        "rapid_change_count": 3,
        "rapid_change_window_sec": 5.0
    }
    """
    classroom = db.query(PhysicalClassroom).filter(
        PhysicalClassroom.id == classroom_id
    ).first()
    if not classroom:
        raise HTTPException(404, "Classroom not found.")

    # Update is_exam_room if provided
    if "is_exam_room" in config:
        classroom.is_exam_room = bool(config.pop("is_exam_room"))

    # Update camera_source if provided
    if "camera_source" in config:
        classroom.camera_source = str(config.pop("camera_source"))

    # Store the remaining thresholds in exam_config_json
    # Merge with existing config so partial updates work
    existing_config = {}
    if classroom.exam_config_json:
        try:
            existing_config = json.loads(classroom.exam_config_json)
        except json.JSONDecodeError:
            pass

    existing_config.update(config)
    classroom.exam_config_json = json.dumps(existing_config)

    db.commit()
    db.refresh(classroom)

    return {
        "status": "updated",
        "classroom_id": classroom_id,
        "config": existing_config,
        "is_exam_room": classroom.is_exam_room,
    }


@router.get("/classrooms/{classroom_id}", response_model=ClassroomDetailResponse)
async def get_classroom(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Get classroom detail including full student roster and teacher list with role scopes."""
    classroom = db.query(PhysicalClassroom).filter(
        PhysicalClassroom.id == classroom_id
    ).first()
    if not classroom:
        raise HTTPException(404, "Classroom not found.")

    # Scope checks:
    # 1. Teachers can only view assigned classrooms
    if current_user.role == "teacher":
        is_assigned = db.query(ClassroomTeacher).filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == current_user.id
        ).first()
        if not is_assigned:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this classroom.",
            )
            
    # 2. School admins can only view classrooms belonging to their school
    elif current_user.role != "super_admin":
        # Find the school this classroom belongs to via grade
        grade = db.query(Grade).filter(Grade.id == classroom.grade_id).first()
        if not grade or grade.school_id != current_user.school_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this classroom.",
            )

    # Build student roster
    student_links = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    # Collect student IDs that have a face profile
    student_ids = [link.student_id for link in student_links]
    face_profiles = (
        db.query(StudentFaceProfile)
        .filter(StudentFaceProfile.student_id.in_(student_ids))
        .all()
    )
    enrolled_face_ids = {fp.student_id for fp in face_profiles}

    roster: List[StudentRosterItem] = []
    for link in student_links:
        user = db.query(User).filter(User.id == link.student_id).first()
        if user and not user.is_deleted:
            roster.append(
                StudentRosterItem(
                    student_id=user.id,
                    name=user.name,
                    email=user.email,
                    is_active=link.is_active,
                    has_face_profile=user.id in enrolled_face_ids,
                )
            )

    # Build teacher list
    teacher_links = (
        db.query(ClassroomTeacher)
        .filter(ClassroomTeacher.classroom_id == classroom_id)
        .all()
    )
    teachers = []
    for tlink in teacher_links:
        teacher = db.query(User).filter(User.id == tlink.teacher_id).first()
        if teacher:
            teachers.append(
                {
                    "teacher_id": teacher.id,
                    "name": teacher.name,
                    "role": tlink.role,
                    "subject": tlink.subject,
                }
            )

    return ClassroomDetailResponse(
        id=classroom.id,
        name=classroom.name,
        room_number=classroom.room_number,
        is_exam_room=classroom.is_exam_room,
        students=roster,
        teachers=teachers,
    )


@router.patch("/classrooms/{classroom_id}", response_model=ClassroomResponse)
async def update_classroom(
    classroom_id: int,
    data: ClassroomCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update classroom name, camera source, exam mode, etc."""
    classroom = db.query(PhysicalClassroom).filter(
        PhysicalClassroom.id == classroom_id
    ).first()
    if not classroom:
        raise HTTPException(404, "Classroom not found.")

    classroom.name = data.name
    if data.room_number is not None:
        classroom.room_number = data.room_number
    if data.capacity is not None:
        classroom.capacity = data.capacity
    if data.camera_source is not None:
        classroom.camera_source = data.camera_source
    classroom.is_exam_room = data.is_exam_room
    db.commit()
    db.refresh(classroom)
    return classroom


# ============================================================
# ROSTER MANAGEMENT
# ============================================================

@router.post("/classrooms/{classroom_id}/students", status_code=200)
async def add_students(
    classroom_id: int,
    data: AddStudentsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Add students to a classroom roster."""
    classroom = db.query(PhysicalClassroom).filter(
        PhysicalClassroom.id == classroom_id
    ).first()
    if not classroom:
        raise HTTPException(404, "Classroom not found.")

    existing = {
        row.student_id
        for row in db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    }

    added = []
    for sid in data.student_ids:
        if sid not in existing:
            db.add(ClassroomStudent(classroom_id=classroom_id, student_id=sid))
            added.append(sid)

    db.commit()
    return {"status": "success", "added": len(added), "already_in_class": len(data.student_ids) - len(added)}


@router.delete("/classrooms/{classroom_id}/students/{student_id}", status_code=200)
async def remove_student(
    classroom_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Soft-remove a student from a classroom (marks is_active=False)."""
    link = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(404, "Student not in this classroom.")
    link.is_active = False
    db.commit()
    return {"status": "success"}


@router.post("/classrooms/{classroom_id}/teachers", status_code=200)
async def assign_teacher(
    classroom_id: int,
    data: AssignTeacherRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Assign a teacher to a classroom."""
    classroom = db.query(PhysicalClassroom).filter(
        PhysicalClassroom.id == classroom_id
    ).first()
    if not classroom:
        raise HTTPException(404, "Classroom not found.")

    existing = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == data.teacher_id,
            ClassroomTeacher.subject == data.subject,
        )
        .first()
    )
    if existing:
        return {"status": "already_assigned"}

    db.add(
        ClassroomTeacher(
            classroom_id=classroom_id,
            teacher_id=data.teacher_id,
            role=data.role,
            subject=data.subject,
        )
    )
    db.commit()
    return {"status": "success"}


# ============================================================
# SCHEDULE
# ============================================================

@router.get("/classrooms/{classroom_id}/schedule", response_model=List[ScheduleSlotResponse])
async def get_schedule(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    return (
        db.query(ClassSchedule)
        .filter(ClassSchedule.classroom_id == classroom_id)
        .order_by(ClassSchedule.day_of_week, ClassSchedule.period_start)
        .all()
    )


@router.post("/classrooms/{classroom_id}/schedule", response_model=ScheduleSlotResponse, status_code=201)
async def add_schedule_slot(
    classroom_id: int,
    data: ScheduleSlotCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    slot = ClassSchedule(
        classroom_id=classroom_id,
        teacher_id=data.teacher_id,
        subject=data.subject,
        day_of_week=data.day_of_week,
        period_start=data.period_start,
        period_end=data.period_end,
    )
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return slot


# User management moved up before /{school_id} to avoid FastAPI path routing collisions


@router.post("/classrooms/{classroom_id}/messages", response_model=ClassroomMessageResponse, status_code=201)
async def send_classroom_message(
    classroom_id: int,
    data: ClassroomMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send an announcement broadcast or direct message in a classroom."""
    # Validate classroom
    classroom = db.query(PhysicalClassroom).filter(PhysicalClassroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found.")

    # Create message
    msg = ClassroomMessage(
        classroom_id=classroom_id,
        sender_id=current_user.id,
        student_id=data.student_id,
        message=data.message,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    return ClassroomMessageResponse(
        id=msg.id,
        classroom_id=msg.classroom_id,
        sender_id=msg.sender_id,
        sender_name=current_user.name,
        student_id=msg.student_id,
        message=msg.message,
        created_at=msg.created_at
    )


@router.get("/classrooms/{classroom_id}/messages", response_model=List[ClassroomMessageResponse])
async def list_classroom_messages(
    classroom_id: int,
    student_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List classroom announcements or direct messages."""
    classroom = db.query(PhysicalClassroom).filter(PhysicalClassroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found.")

    query = db.query(ClassroomMessage).filter(ClassroomMessage.classroom_id == classroom_id)

    if current_user.role == "student":
        # Students see announcements (null student_id) OR messages directed to/from them
        query = query.filter(
            (ClassroomMessage.student_id.is_(None)) | 
            (ClassroomMessage.student_id == current_user.id)
        )
    else:
        # Teachers/Admins see announcements or DMs for a specific student if requested
        if student_id is not None:
            query = query.filter(ClassroomMessage.student_id == student_id)
        else:
            query = query.filter(ClassroomMessage.student_id.is_(None))

    messages = query.order_by(ClassroomMessage.created_at.asc()).all()

    results = []
    for msg in messages:
        sender = db.query(User).filter(User.id == msg.sender_id).first()
        results.append(
            ClassroomMessageResponse(
                id=msg.id,
                classroom_id=msg.classroom_id,
                sender_id=msg.sender_id,
                sender_name=sender.name if sender else "Unknown",
                student_id=msg.student_id,
                message=msg.message,
                created_at=msg.created_at
            )
        )
    return results


@router.get("/students/{student_id}/counselor-report", response_model=CounselorReportResponse)
async def get_student_counselor_report(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Retrieve a student's counselor psychologist report and AI summary."""
    student = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    return CounselorReportResponse(
        student_id=student.id,
        counselor_report=student.counselor_report,
        counselor_report_summary=student.counselor_report_summary
    )


@router.post("/students/{student_id}/counselor-report", response_model=CounselorReportResponse)
async def save_student_counselor_report(
    student_id: int,
    data: CounselorReportSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Save counselor report and use LLM to summarize key points."""
    student = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found.")

    student.counselor_report = data.report

    # Summarize via LLM client
    if data.report.strip():
        try:
            llm = get_llm_client()
            summary_prompt = f"""
            Summarize the following school psychologist / psychiatrist report for a student.
            Extract only the key insights relevant to their learning capacity, mental health status, and any special accommodations or tutoring adaptations required.
            Keep the summary concise, professional, and clear (max 3-4 bullet points).

            RAW COUNSELOR REPORT:
            {data.report}
            """
            summary_text = await llm.generate(prompt=summary_prompt)
            student.counselor_report_summary = summary_text.strip()
        except Exception as e:
            logger.error(f"Failed to generate counselor report summary: {e}")
            student.counselor_report_summary = "Failed to generate AI summary. Please check LLM service."
    else:
        student.counselor_report_summary = None

    db.commit()
    db.refresh(student)

    return CounselorReportResponse(
        student_id=student.id,
        counselor_report=student.counselor_report,
        counselor_report_summary=student.counselor_report_summary
    )


