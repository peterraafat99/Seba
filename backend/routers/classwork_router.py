import os
import shutil
import logging
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import SessionLocal
from models import User, Course, Classwork, ClassworkSubmission, Activity

logger = logging.getLogger(__name__)
router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_teacher_or_above(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("teacher", "admin", "school_admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher access required.",
        )
    return current_user


@router.post("/upload")
async def upload_classwork_file(
    file: UploadFile = File(...),
    current_user: User = Depends(require_teacher_or_above)
):
    """
    Upload a generic classwork resource file (PDF, Word, zip, notebook, etc.).
    Returns the file URL path.
    """
    UPLOAD_DIR = "uploads"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    # Generate unique filename
    import time
    import random
    
    clean_orig_name = "".join(c for c in file.filename if c.isalnum() or c in (".", "-", "_")).replace(" ", "_")
    unique_prefix = f"{int(time.time())}_{random.randint(1000, 9999)}"
    unique_filename = f"material_{unique_prefix}_{clean_orig_name}"
    
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        file_url = f"/uploads/{unique_filename}"
        return {"url": file_url, "filename": unique_filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {str(e)}")


# ==========================================
# PYDANTIC SCHEMAS
# ==========================================

class ClassworkCreate(BaseModel):
    title: str
    description: Optional[str] = None
    classwork_type: str  # 'video', 'pdf', 'homework', 'quiz', 'document'
    resource_url: Optional[str] = None
    max_grade: Optional[int] = None
    due_date: Optional[str] = None
    timer_minutes: Optional[int] = None
    quiz_questions_json: Optional[str] = None


class ClassworkResponse(BaseModel):
    id: int
    course_id: int
    title: str
    description: Optional[str] = None
    classwork_type: str
    resource_url: Optional[str] = None
    max_grade: Optional[int] = None
    due_date: Optional[str] = None
    timer_minutes: Optional[int] = None
    quiz_questions_json: Optional[str] = None
    created_at: datetime
    
    # Student specific status
    completed: bool = False
    submission_file_url: Optional[str] = None
    answers_json: Optional[str] = None
    submitted_at: Optional[datetime] = None
    grade: Optional[float] = None

    class Config:
        from_attributes = True


class StudentBrief(BaseModel):
    id: int
    name: str
    email: str
    class Config:
        from_attributes = True


class SubmissionWithStudentResponse(BaseModel):
    id: int
    classwork_id: int
    student: StudentBrief
    completed: bool
    submission_file_url: Optional[str] = None
    answers_json: Optional[str] = None
    submitted_at: datetime
    grade: Optional[float] = None

    class Config:
        from_attributes = True


class GradeSubmissionRequest(BaseModel):
    student_id: int
    grade: float



# ==========================================
# ENDPOINTS
# ==========================================

@router.get("/course/{course_id}", response_model=List[ClassworkResponse])
async def list_course_classwork(
    course_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve all classwork items for a course, merged with the current user's completion status."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(404, "Course not found.")

    classwork_items = db.query(Classwork).filter(Classwork.course_id == course_id).order_by(Classwork.created_at.desc()).all()
    
    results = []
    for item in classwork_items:
        # Check if the user has a submission for this item
        sub = db.query(ClassworkSubmission).filter(
            ClassworkSubmission.classwork_id == item.id,
            ClassworkSubmission.student_id == current_user.id
        ).first()
        
        # Build merged response
        res = ClassworkResponse(
            id=item.id,
            course_id=item.course_id,
            title=item.title,
            description=item.description,
            classwork_type=item.classwork_type,
            resource_url=item.resource_url,
            max_grade=item.max_grade,
            due_date=item.due_date,
            timer_minutes=item.timer_minutes,
            quiz_questions_json=item.quiz_questions_json,
            created_at=item.created_at,
            completed=sub.completed if sub else False,
            submission_file_url=sub.submission_file_url if sub else None,
            answers_json=sub.answers_json if sub else None,
            submitted_at=sub.submitted_at if sub else None,
            grade=sub.grade if sub else None
        )
        results.append(res)
        
    return results



@router.post("/course/{course_id}", response_model=ClassworkResponse, status_code=201)
async def create_course_classwork(
    course_id: int,
    data: ClassworkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Create a new classwork item for a course (Teachers/Admins only)."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(404, "Course not found.")

    new_item = Classwork(
        course_id=course_id,
        title=data.title,
        description=data.description,
        classwork_type=data.classwork_type,
        resource_url=data.resource_url,
        max_grade=data.max_grade,
        due_date=data.due_date,
        timer_minutes=data.timer_minutes,
        quiz_questions_json=data.quiz_questions_json
    )
    db.add(new_item)
    db.commit()
    db.refresh(new_item)
    
    # Log teacher activity
    activity = Activity(
        user_id=current_user.id,
        activity_type="classwork_created",
        entity_type="course",
        entity_id=course_id,
        description=f"Created {data.classwork_type} classwork: '{data.title}'"
    )
    db.add(activity)
    db.commit()
    
    return ClassworkResponse(
        id=new_item.id,
        course_id=new_item.course_id,
        title=new_item.title,
        description=new_item.description,
        classwork_type=new_item.classwork_type,
        resource_url=new_item.resource_url,
        max_grade=new_item.max_grade,
        due_date=new_item.due_date,
        timer_minutes=new_item.timer_minutes,
        quiz_questions_json=new_item.quiz_questions_json,
        created_at=new_item.created_at
    )



@router.post("/{classwork_id}/submit")
async def submit_classwork(
    classwork_id: int,
    file: Optional[UploadFile] = File(None),
    completed: bool = Form(True),
    answers_json: Optional[str] = Form(None),
    grade: Optional[float] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit solution or mark classwork as completed (Students/Users)."""
    item = db.query(Classwork).filter(Classwork.id == classwork_id).first()
    if not item:
        raise HTTPException(404, "Classwork item not found.")

    # Check if submission already exists
    sub = db.query(ClassworkSubmission).filter(
        ClassworkSubmission.classwork_id == classwork_id,
        ClassworkSubmission.student_id == current_user.id
    ).first()

    submission_file_url = None
    if file:
        # Save file to uploads folder
        UPLOAD_DIR = "uploads"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        # Create a unique file name
        safe_filename = f"sub_{current_user.id}_{classwork_id}_{file.filename.replace(' ', '_')}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        # Store relative URL path
        submission_file_url = f"/uploads/{safe_filename}"

    if sub:
        # Update existing submission
        sub.completed = completed
        if submission_file_url:
            sub.submission_file_url = submission_file_url
        if answers_json is not None:
            sub.answers_json = answers_json
        if grade is not None:
            sub.grade = grade
        sub.submitted_at = datetime.utcnow()
    else:
        # Create new submission
        sub = ClassworkSubmission(
            classwork_id=classwork_id,
            student_id=current_user.id,
            completed=completed,
            submission_file_url=submission_file_url,
            answers_json=answers_json,
            grade=grade,
            submitted_at=datetime.utcnow()
        )
        db.add(sub)

    db.commit()
    db.refresh(sub)

    # Log student activity
    activity = Activity(
        user_id=current_user.id,
        activity_type="classwork_submitted",
        entity_type="course",
        entity_id=item.course_id,
        description=f"Submitted classwork: '{item.title}'"
    )
    db.add(activity)
    db.commit()

    return {
        "status": "success",
        "completed": sub.completed,
        "submission_file_url": sub.submission_file_url,
        "answers_json": sub.answers_json,
        "grade": sub.grade,
        "submitted_at": sub.submitted_at
    }



@router.post("/{classwork_id}/unsubmit")
async def unsubmit_classwork(
    classwork_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Unsubmit classwork, reset completion state, and remove uploaded solution files."""
    sub = db.query(ClassworkSubmission).filter(
        ClassworkSubmission.classwork_id == classwork_id,
        ClassworkSubmission.student_id == current_user.id
    ).first()

    if not sub:
        raise HTTPException(404, "No submission found to undo.")

    # Remove the uploaded file if it exists
    if sub.submission_file_url:
        relative_path = sub.submission_file_url.lstrip("/")
        if os.path.exists(relative_path):
            try:
                os.remove(relative_path)
            except Exception as e:
                logger.error(f"Error deleting file {relative_path}: {e}")

    # Delete the submission database entry
    db.delete(sub)
    db.commit()

    return {"status": "success", "message": "Classwork submission successfully undone"}


@router.get("/{classwork_id}/submissions", response_model=List[SubmissionWithStudentResponse])
async def get_classwork_submissions(
    classwork_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Get all submissions for a classwork item (Teachers/Admins only)."""
    submissions = db.query(ClassworkSubmission).filter(
        ClassworkSubmission.classwork_id == classwork_id
    ).all()
    return submissions


@router.post("/{classwork_id}/grade")
async def grade_classwork_submission(
    classwork_id: int,
    data: GradeSubmissionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher_or_above),
):
    """Grade a student's classwork submission (Teachers/Admins only)."""
    sub = db.query(ClassworkSubmission).filter(
        ClassworkSubmission.classwork_id == classwork_id,
        ClassworkSubmission.student_id == data.student_id
    ).first()
    if not sub:
        raise HTTPException(404, "Submission not found for this student.")

    sub.grade = data.grade
    db.commit()

    # Log activity
    item = db.query(Classwork).filter(Classwork.id == classwork_id).first()
    activity = Activity(
        user_id=current_user.id,
        activity_type="classwork_graded",
        entity_type="course",
        entity_id=item.course_id if item else 0,
        description=f"Graded classwork '{item.title if item else ''}' for student ID {data.student_id}: {data.grade}"
    )
    db.add(activity)
    db.commit()

    return {"status": "success", "grade": sub.grade}


@router.get("/curriculum-pdfs")
async def list_curriculum_pdfs(
    current_user: User = Depends(require_teacher_or_above),
):
    """List all available curriculum PDFs in backend/curriculum_pdfs (Teachers/Admins only)."""
    PDF_ROOT = "curriculum_pdfs"
    if not os.path.exists(PDF_ROOT):
        return []
    
    results = []
    for root, dirs, files in os.walk(PDF_ROOT):
        for file in files:
            if file.endswith(".pdf"):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, PDF_ROOT)
                results.append({
                    "title": file.replace(".pdf", ""),
                    "url": f"/curriculum_pdfs/{rel_path.replace(os.sep, '/')}",
                    "rel_path": rel_path
                })
    return results


