from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func # [FIX] Import func
import uvicorn
import random
import os
import shutil
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from database import SessionLocal, engine, Base
from models import User, Course, Lesson, Enrollment, Quiz, QuizQuestion, QuizAnswer, Activity, TeacherNote, StudentSentiment, LessonProgress, Classwork, ClassworkSubmission
from schemas import (
    UserCreate, UserResponse, Token, CourseCreate, CourseResponse,
    LessonCreate, LessonResponse, DashboardResponse, QuizResponse,
    ChatMessage, ChatResponse, StudentResponse, StudentDetailResponse,
    ActiveLearningStartRequest, ActiveLearningMessageRequest
)
from auth import get_current_user, create_access_token, verify_password, get_password_hash
from admin import admin_router
from chatbot import get_ai_response, start_active_learning, process_active_learning 
from quiz_engine import generate_personalized_quiz
# ---- New School Platform Routers ----
from routers.school_router import router as school_router
from routers.cv_router import router as cv_router
from routers.analytics_router import router as analytics_router
from routers.attendance import router as attendance_router
from routers.classwork_router import router as classwork_router
from cv_analytics.session_manager import session_manager

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="School Analytics Platform API", version="2.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://localhost:3000", "http://localhost:8000",
        "http://127.0.0.1:5173", "http://127.0.0.1:3000", "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Graceful shutdown: stop all active CV sessions when server exits
@app.on_event("shutdown")
async def on_shutdown():
    session_manager.stop_all()

# Create uploads directory if it doesn't exist
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files for serving uploaded images
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/curriculum_pdfs", StaticFiles(directory="curriculum_pdfs"), name="curriculum_pdfs")

# Include admin router (legacy)
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])

# ---- School Platform Routers ----
app.include_router(school_router, prefix="/api/school", tags=["school"])
app.include_router(cv_router, prefix="/api/cv", tags=["cv-analytics"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["analytics"])
app.include_router(attendance_router, prefix="/api", tags=["Attendance (NFC)"])
app.include_router(classwork_router, prefix="/api/classwork", tags=["classwork"])

# WebSocket endpoint for CV streaming is registered directly on the cv_router
# Connect via: ws://localhost:8000/api/cv/ws/{classroom_id}

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==========================================
# DIAGNOSTIC: Test Gemini API Key
# ==========================================

@app.get("/api/test-gemini")
async def test_gemini_api():
    """
    Quick diagnostic endpoint — tests the Gemini API key and model ID.
    Visit: http://localhost:8000/api/test-gemini
    """
    import os
    api_key = os.getenv("GEMINI_API_KEY", "")
    model_name = os.getenv("CLOUD_MODEL", "gemma-4-31b-it")

    if not api_key:
        return {"status": "error", "message": "GEMINI_API_KEY is not set in .env"}

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)
        response = await model.generate_content_async("Say 'API OK' and nothing else.")
        return {
            "status": "success",
            "model": model_name,
            "key_prefix": api_key[:8] + "...",
            "response": response.text.strip()
        }
    except Exception as e:
        return {
            "status": "error",
            "model": model_name,
            "key_prefix": api_key[:8] + "...",
            "error": str(e)
        }


# ==========================================
# 1. PYDANTIC MODELS
# ==========================================

class LoginRequest(BaseModel):
    email: str
    password: str

class SessionStartRequest(BaseModel):
    lesson_id: int = Field(alias="lessonId")

class SessionEndRequest(BaseModel):
    lesson_id: int = Field(alias="lessonId")
    duration: int

class QuizSubmitRequest(BaseModel):
    lesson_id: int = Field(alias="lessonId")
    answers: Dict[str, int]
    calculated_score: Optional[int] = Field(default=None, alias="calculatedScore")  # Frontend sends actual score

class QuizRequest(BaseModel):
    lessonId: int

# [FIX 1] Added this model for the Generate Quiz Button
class GenerateQuizRequest(BaseModel):
    lessonId: int
    model_backend: Optional[str] = None

class LessonLogRequest(BaseModel):
    lessonId: int
    completed: bool = False
    model_config = {"extra": "allow"}

class LessonFeedbackRequest(BaseModel):
    lessonId: int
    feedback: str = ""
    helpful: bool = True

class ChatFeedbackRequest(BaseModel):
    messageId: str
    helpful: bool

class CommentRequest(BaseModel):
    studentId: int
    comment: str

class GoalRequest(BaseModel):
    goal: str

class PreferenceRequest(BaseModel):
    preference: str
    value: Dict

# ==========================================
# 2. AUTH ENDPOINTS
# ==========================================

@app.post("/api/auth/register", response_model=Token)
async def register(user_data: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user_data.email).first()
    if db_user:
        access_token = create_access_token(data={"sub": db_user.email, "role": db_user.role})
        return {"access_token": access_token, "token_type": "bearer", "user": UserResponse.model_validate(db_user)}
    
    password = user_data.password if user_data.password and user_data.password != "default123" else "default123"
    hashed_password = get_password_hash(password)
    db_user = User(
        name=user_data.name,
        email=user_data.email,
        hashed_password=hashed_password,
        role=user_data.role,
        school_id=user_data.school_id
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    access_token = create_access_token(data={"sub": db_user.email, "role": db_user.role})
    return {"access_token": access_token, "token_type": "bearer", "user": UserResponse.model_validate(db_user)}

@app.post("/api/auth/login", response_model=Token)
async def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == login_data.email).first()
    
    if not user:
        hashed_password = get_password_hash(login_data.password if login_data.password else "default123")
        user = User(
            name=login_data.email.split("@")[0],
            email=login_data.email,
            hashed_password=hashed_password,
            role="student"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    access_token = create_access_token(data={"sub": user.email, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer", "user": UserResponse.model_validate(user)}

@app.post("/api/auth/logout")
async def logout(current_user: User = Depends(get_current_user)):
    return {"message": "Successfully logged out"}

@app.post("/api/auth/token", response_model=Token)
async def login_swagger(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user_email = form_data.username
    user_password = form_data.password
    user = db.query(User).filter(User.email == user_email).first()
    
    if not user:
        hashed_password = get_password_hash(user_password if user_password else "default123")
        user = User(name=user_email.split("@")[0], email=user_email, hashed_password=hashed_password, role="student")
        db.add(user)
        db.commit()
        db.refresh(user)

    access_token = create_access_token(data={"sub": user.email, "role": user.role})
    return {"access_token": access_token, "token_type": "bearer", "user": UserResponse.model_validate(user)}

@app.post("/api/auth/register", response_model=Token)
async def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_password = get_password_hash(user.password)
    new_user = User(
        name=user.name,
        email=user.email,
        hashed_password=hashed_password,
        role=user.role,
        school_id=user.school_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token = create_access_token(data={"sub": new_user.email, "role": new_user.role})
    return {"access_token": access_token, "token_type": "bearer", "user": UserResponse.model_validate(new_user)}

@app.post("/api/admin/link-parent")
async def link_parent(data: Dict[str, Any], db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    parent = db.query(User).filter(User.id == data["parent_id"], User.role == "parent").first()
    if not parent: raise HTTPException(404, "Parent not found")
    
    student_ids = data.get("student_ids", [])
    students = db.query(User).filter(User.id.in_(student_ids), User.role == "student").all()
    
    current_children_ids = {c.id for c in parent.children}
    for s in students:
        if s.id not in current_children_ids:
            parent.children.append(s)
    db.commit()
    return {"status": "success", "linked": len(students)}

@app.post("/api/admin/link-teacher")
async def link_teacher(data: Dict[str, Any], db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    teacher = db.query(User).filter(User.id == data["teacher_id"], User.role == "teacher").first()
    if not teacher: raise HTTPException(404, "Teacher not found")
    
    student_ids = data.get("student_ids", [])
    students = db.query(User).filter(User.id.in_(student_ids), User.role == "student").all()
    
    current_students_ids = {s.id for s in teacher.students_taught}
    for s in students:
        if s.id not in current_students_ids:
            teacher.students_taught.append(s)
    db.commit()
    return {"status": "success", "linked": len(students)}

@app.get("/api/admin/users")
async def get_users_by_role(role: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)
    res = q.all()
    # Manual serialization if needed, or rely on internal Pydantic
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in res]

# ==========================================
# 3. SESSION ENDPOINTS
# ==========================================

@app.post("/api/session/start")
async def start_session(request: SessionStartRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True, "session_id": f"session_{request.lesson_id}_{current_user.id}"}

@app.post("/api/session/end")
async def end_session(request: SessionEndRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True}

# ==========================================
# 4. DASHBOARD & COURSES
# ==========================================

@app.get("/api/dashboard", response_model=DashboardResponse)
async def get_dashboard(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 1. Parent/Teacher View
    if current_user.role in ["parent", "teacher", "admin"]:
        if current_user.role == "parent":
            students_list = current_user.children
        elif current_user.role == "teacher":
            students_list = current_user.students_taught
        else:
            students_list = db.query(User).filter(User.role == "student").all()
        # Filter out soft-deleted students
        students_list = [s for s in students_list if not s.is_deleted]
        
        students_summary = []
        overall_progress = 0
        
        for student in students_list:
            # Time Spent (Total)
            total_seconds = db.query(func.sum(LessonProgress.time_spent_seconds)).filter(LessonProgress.user_id == student.id).scalar() or 0
            total_time_min = int(total_seconds / 60)
            
            # Enrollments
            enrolls = db.query(Enrollment).filter(Enrollment.student_id == student.id).all()
            courses_count = len(enrolls)
            
            # Avg Grade (Mock/Calc)
            # Simplified for summary
            avg_grade = 0
            if courses_count > 0:
                # In real app, calculate true avg from quizzes
                avg_grade = random.randint(60, 100) 
            
            students_summary.append({
                "id": student.id,
                "name": student.name,
                "email": student.email,
                "totalTimeSpent": total_time_min,
                "averageGrade": avg_grade,
                "coursesCount": courses_count
            })
            overall_progress += avg_grade

        if len(students_list) > 0:
            overall_progress = int(overall_progress / len(students_list))

        return {
            "courses": [],
            "progress": overall_progress,
            "upcomingLessons": [],
            "recentActivity": [],
            "students": students_summary
        }

    # 2. Student View (Default)
    enrollments = db.query(Enrollment).filter(Enrollment.student_id == current_user.id).all()
    courses = [enrollment.course for enrollment in enrollments if enrollment.course is not None]
    
    total_progress = 0
    if courses:
        for course in courses:
            completed_lessons = db.query(Activity).filter(
                Activity.user_id == current_user.id,
                Activity.activity_type == "lesson_completed",
                Activity.entity_type == "lesson"
            ).join(Lesson, Lesson.id == Activity.entity_id).filter(Lesson.course_id == course.id).count()
            total_lessons = db.query(Lesson).filter(Lesson.course_id == course.id).count()
            if total_lessons > 0:
                total_progress += (completed_lessons / total_lessons) * 100
        total_progress = total_progress / len(courses)

    
    upcoming_lessons = []
    for course in courses:
        next_lesson = db.query(Lesson).filter(Lesson.course_id == course.id, Lesson.completed == False).order_by(Lesson.order).first()
        if next_lesson:
            upcoming_lessons.append({
                "id": next_lesson.id,
                "title": next_lesson.title,
                "course": course.title,
                "date": "2025-01-15"
            })
    
    recent_activity = []
    try:
        activities = db.query(Activity).filter(Activity.user_id == current_user.id).order_by(Activity.created_at.desc()).limit(10).all()
        for activity in activities:
            timestamp = activity.created_at.strftime("%B %d, %Y")
            recent_activity.append({"description": activity.description, "timestamp": timestamp})
    except:
        pass
    
    if not recent_activity:
        enrollments_recent = db.query(Enrollment).filter(Enrollment.student_id == current_user.id).order_by(Enrollment.enrolled_at.desc()).limit(5).all()
        for enrollment in enrollments_recent:
            course = db.query(Course).filter(Course.id == enrollment.course_id).first()
            if course:
                recent_activity.append({"description": f"Enrolled in course: {course.title}", "timestamp": "Just now"})
    
    course_responses = []
    for course in courses:
        enrollments_count = db.query(Enrollment).filter(Enrollment.course_id == course.id).count()
        completed_lessons = db.query(Activity).filter(
            Activity.user_id == current_user.id,
            Activity.activity_type == "lesson_completed",
            Activity.entity_type == "lesson"
        ).join(Lesson, Lesson.id == Activity.entity_id).filter(Lesson.course_id == course.id).count()
        total_lessons = db.query(Lesson).filter(Lesson.course_id == course.id).count()
        progress = (completed_lessons / total_lessons * 100) if total_lessons > 0 else 0
        course_responses.append({
            "id": course.id,
            "title": course.title,
            "instructor": course.instructor,
            "progress": progress,
            "thumbnail": course.thumbnail
        })
    
    return {
        "courses": course_responses,
        "progress": int(total_progress),
        "upcomingLessons": upcoming_lessons,
        "recentActivity": recent_activity
    }

@app.get("/api/courses")
async def get_all_courses(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    courses = db.query(Course).all()
    result = []
    for course in courses:
        enrollments = db.query(Enrollment).filter(Enrollment.course_id == course.id).all()
        lessons = db.query(Lesson).filter(Lesson.course_id == course.id).order_by(Lesson.order).all()
        completed_lessons = db.query(Activity).filter(
            Activity.user_id == current_user.id,
            Activity.activity_type == "lesson_completed",
            Activity.entity_type == "lesson"
        ).join(Lesson, Lesson.id == Activity.entity_id).filter(Lesson.course_id == course.id).count()
        progress = int((completed_lessons / len(lessons) * 100)) if lessons else 0
        result.append({
            "id": course.id,
            "title": course.title,
            "description": course.description,
            "instructor": course.instructor,
            "duration": course.duration,
            "enrolled": len(enrollments),
            "thumbnail": course.thumbnail,
            "progress": progress
        })
    return result


@app.get("/api/courses/{course_id}", response_model=CourseResponse)
async def get_course(course_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    enrollments = db.query(Enrollment).filter(Enrollment.course_id == course_id).all()
    lessons = db.query(Lesson).filter(Lesson.course_id == course_id).order_by(Lesson.order).all()
    completed_lesson_ids = {
        act.entity_id for act in db.query(Activity).filter(
            Activity.user_id == current_user.id,
            Activity.activity_type == "lesson_completed",
            Activity.entity_type == "lesson"
        ).all()
    }
    user_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == current_user.id,
        Enrollment.course_id == course_id
    ).first()
    progress = user_enrollment.progress if user_enrollment else 0.0
    if user_enrollment and lessons:
        completed_count = sum(1 for lesson in lessons if lesson.id in completed_lesson_ids)
        progress = (completed_count / len(lessons)) * 100

    return {
        "id": course.id,
        "title": course.title,
        "description": course.description,
        "instructor": course.instructor,
        "duration": course.duration,
        "enrolled": len(enrollments),
        "thumbnail": course.thumbnail,
        "isEnrolled": user_enrollment is not None,
        "progress": round(progress, 1),
        "lessons": [
            {"id": l.id, "title": l.title, "duration": l.duration, "completed": l.id in completed_lesson_ids if user_enrollment else False, "order": l.order}
            for l in lessons
        ]
    }


@app.post("/api/courses/{course_id}/enroll")
async def enroll_in_course(course_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    existing = db.query(Enrollment).filter(Enrollment.course_id == course_id, Enrollment.student_id == current_user.id).first()
    if existing:
        return {"message": "Already enrolled", "enrolled": True}
    
    enrollment = Enrollment(student_id=current_user.id, course_id=course_id, progress=0.0)
    db.add(enrollment)
    activity = Activity(user_id=current_user.id, activity_type="enrollment", entity_type="course", entity_id=course_id, description=f"Enrolled in course: {course.title}")
    db.add(activity)
    db.commit()
    return {"message": "Successfully enrolled", "enrolled": True}

# ==========================================
# 5. LESSONS & CHAT (FIXED)
# ==========================================

@app.get("/api/lessons/{lesson_id}", response_model=LessonResponse)
async def get_lesson(lesson_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    course = lesson.course
    next_lesson = db.query(Lesson).filter(Lesson.course_id == course.id, Lesson.order > lesson.order).order_by(Lesson.order).first()
    prev_lesson = db.query(Lesson).filter(Lesson.course_id == course.id, Lesson.order < lesson.order).order_by(Lesson.order.desc()).first()
    
    quiz_data = None
    quiz = db.query(Quiz).filter(Quiz.lesson_id == lesson.id).first()
    if quiz:
        questions = db.query(QuizQuestion).filter(QuizQuestion.quiz_id == quiz.id).order_by(QuizQuestion.order).all()
        quiz_data = {
            "questions": [
                {"id": q.id, "question": q.question, "options": [q.option_a, q.option_b, q.option_c, q.option_d] if q.option_d else [q.option_a, q.option_b, q.option_c], "correctAnswer": q.correct_answer}
                for q in questions
            ]
        }
    
    return {
        "id": lesson.id,
        "title": lesson.title,
        "videoUrl": lesson.video_url,
        "description": lesson.description,
        "courseId": course.id,
        "courseTitle": course.title,
        "nextLessonId": next_lesson.id if next_lesson else None,
        "previousLessonId": prev_lesson.id if prev_lesson else None,
        "quiz": quiz_data,
        "content": lesson.content,
        "content_en": lesson.content_en,
        "content_ar": lesson.content_ar
    }

@app.post("/api/lessons/{lesson_id}/track-time")
async def track_lesson_time(
    lesson_id: int, 
    update: Dict[str, int], 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    seconds = update.get("seconds", 0)
    if seconds <= 0:
        return {"status": "ignored"}
        
    # Check/Create Enrollment to ensure course shows in dashboard
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if lesson:
        enrollment = db.query(Enrollment).filter(
            Enrollment.student_id == current_user.id,
            Enrollment.course_id == lesson.course_id
        ).first()
        if not enrollment:
            enrollment = Enrollment(
                student_id=current_user.id,
                course_id=lesson.course_id,
                current_lesson_id=lesson_id,
                progress=0.0
            )
            db.add(enrollment)
        
    progress = db.query(LessonProgress).filter(
        LessonProgress.user_id == current_user.id,
        LessonProgress.lesson_id == lesson_id
    ).first()
    
    if not progress:
        progress = LessonProgress(
            user_id=current_user.id,
            lesson_id=lesson_id,
            time_spent_seconds=0
        )
        db.add(progress)
    
    progress.time_spent_seconds += seconds
    db.commit()
    return {"status": "success", "total_seconds": progress.time_spent_seconds}


@app.post("/api/chat")
async def chat(message: ChatMessage, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        # DEBUG: Print exactly what the frontend sent
        print(f"\n{'='*50}")
        print(f"[CHAT] Received model_backend = '{message.model_backend}'")
        print(f"[CHAT] Message = '{message.message[:60]}'")
        print(f"{'='*50}\n")

        trigger_keywords = ["quiz me", "generate quiz", "make a quiz", "test me"]
        if any(kw in message.message.lower() for kw in trigger_keywords):
            quiz_data = await generate_personalized_quiz(
                current_user.id, db, message.lessonId,
                model_backend=message.model_backend  # FIX: pass backend
            )
            if quiz_data.get("error"):
                return {"message": quiz_data["message"], "type": "text"}
            return {
                "type": "quiz_widget", 
                "data": quiz_data, 
                "message": "I've generated a personalized quiz for you based on your recent progress."
            }
        
        ai_message = await get_ai_response(
            user_message=message.message,
            lesson_id=message.lessonId,
            user_id=current_user.id,
            db=db,
            model_backend=message.model_backend
        )
        
        if isinstance(ai_message, dict):
             return ai_message
              
        return ChatResponse(message=ai_message)
    except Exception as e:
        print(f"Chat Error: {e}")
        raise HTTPException(status_code=503, detail="AI Service unavailable")



@app.post("/api/active-learning/start")
async def api_start_active_learning(req: ActiveLearningStartRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        response = await start_active_learning(req.lessonId, current_user.id, db, model_backend=req.model_backend)
        if "error" in response:
            raise HTTPException(status_code=404, detail=response["error"])
        return response
    except Exception as e:
        print(f"Active Learning Start Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to start active learning")

@app.post("/api/active-learning/message")
async def api_process_active_learning(req: ActiveLearningMessageRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        response = await process_active_learning(req.message, req.lessonId, current_user.id, db, model_backend=req.model_backend)
        return response
    except Exception as e:
        print(f"Active Learning Message Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to process active learning message")


# ==========================================
# MULTIMODAL CHAT ENDPOINTS
# ==========================================

@app.post("/api/chat/image")
async def chat_with_image(
    message: str = Form(default="What is this?"),
    lesson_id: int = Form(...),
    image: UploadFile = File(...),
    model_backend: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Accept a text message + image upload (handwritten math, textbook photo, etc.)
    The image is base64-encoded and passed to the vision LLM alongside the text prompt.
    Supports: jpg, jpeg, png, gif, webp
    """
    # Validate file type
    allowed_types = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}
    if image.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {image.content_type}. Use jpg, png, gif, or webp."
        )

    try:
        import base64
        image_bytes = await image.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        print(f"[Image] Received {image.filename} ({len(image_bytes) // 1024} KB) from user {current_user.id}")

        ai_message = await get_ai_response(
            user_message=message,
            lesson_id=lesson_id,
            user_id=current_user.id,
            db=db,
            image_b64=image_b64,
            model_backend=model_backend
        )

        if isinstance(ai_message, dict):
            return ai_message

        return ChatResponse(message=ai_message)

    except Exception as e:
        print(f"[Image] Chat error: {e}")
        raise HTTPException(status_code=503, detail="AI vision service unavailable")


@app.post("/api/chat/voice")
async def chat_with_voice(
    lesson_id: int = Form(...),
    audio: UploadFile = File(...),
    respond_with_voice: bool = Form(default=False),
    model_backend: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Accept an audio file, transcribe it via Groq Whisper, then get an AI response.
    Optionally synthesize the response back to speech.

    Flow: audio -> Groq Whisper STT -> text -> get_ai_response -> (optional TTS) -> response
    Supports: webm, mp3, wav, m4a, ogg, flac
    """
    from voice_handler import transcribe_audio, synthesize_speech
    import base64

    try:
        audio_bytes = await audio.read()
        print(f"[Voice] Received {audio.filename} ({len(audio_bytes) // 1024} KB) from user {current_user.id}")

        # Step 1: Transcribe audio via Groq Whisper API
        transcription = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")

        if not transcription["success"]:
            raise HTTPException(
                status_code=503,
                detail=f"Transcription failed: {transcription['error']}"
            )

        text = transcription["text"]
        language = transcription["language"]

        if not text.strip():
            raise HTTPException(status_code=400, detail="Could not detect any speech in audio.")

        print(f"[Voice] Transcribed ({language}): {text[:100]}")

        # Step 2: Get AI response (same pipeline as text chat)
        ai_message = await get_ai_response(
            user_message=text,
            lesson_id=lesson_id,
            user_id=current_user.id,
            db=db,
            model_backend=model_backend
        )

        if isinstance(ai_message, dict):
            # Quiz widget or special response — just return with transcription appended
            ai_message["transcribed_text"] = text
            return ai_message

        response_payload = {
            "message": ai_message,
            "transcribed_text": text,
            "detected_language": language,
            "type": "voice_response"
        }

        # Step 3: Optional TTS — synthesize AI reply to audio
        if respond_with_voice:
            audio_bytes_out = await synthesize_speech(ai_message, language=language)
            if audio_bytes_out:
                response_payload["audio_base64"] = base64.b64encode(audio_bytes_out).decode("utf-8")
                response_payload["audio_format"] = "wav"

        return response_payload

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Voice] Chat error: {e}")
        raise HTTPException(status_code=503, detail="Voice service unavailable")


@app.post("/api/chat/multimodal")
async def chat_multimodal(
    message: str = Form(default=""),
    lesson_id: int = Form(...),
    image: UploadFile = File(default=None),
    audio: UploadFile = File(default=None),
    respond_with_voice: bool = Form(default=False),
    model_backend: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    The fully combined endpoint — supports any combination of:
      - Text only
      - Text + Image (handwritten math)
      - Voice only (auto-transcribed)
      - Voice + Image (most powerful mode)

    At least one of: message, image, or audio must be provided.
    """
    from voice_handler import transcribe_audio, synthesize_speech
    import base64

    final_text = message.strip()
    image_b64 = None
    detected_language = "en"

    # Step 1: Transcribe audio if provided
    if audio and audio.filename:
        audio_bytes = await audio.read()
        transcription = await transcribe_audio(audio_bytes, filename=audio.filename)
        if transcription["success"] and transcription["text"].strip():
            # Prepend voice transcription to any typed text
            final_text = (transcription["text"] + " " + final_text).strip()
            detected_language = transcription["language"]

    # Step 2: Encode image if provided
    if image and image.filename:
        image_bytes = await image.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    if not final_text and not image_b64:
        raise HTTPException(status_code=400, detail="Please provide a message, image, or audio.")

    # Step 3: Get AI response
    ai_message = await get_ai_response(
        user_message=final_text or "Please analyze the attached image.",
        lesson_id=lesson_id,
        user_id=current_user.id,
        db=db,
        image_b64=image_b64,
        model_backend=model_backend
    )

    if isinstance(ai_message, dict):
        return ai_message

    response_payload = {
        "message": ai_message,
        "type": "multimodal_response",
        "detected_language": detected_language
    }

    # Step 4: Optional TTS
    if respond_with_voice:
        audio_out = await synthesize_speech(ai_message, language=detected_language)
        if audio_out:
            response_payload["audio_base64"] = base64.b64encode(audio_out).decode("utf-8")
            response_payload["audio_format"] = "wav"

    return response_payload


# ==========================================
# 6. QUIZ (FIXED)
# ==========================================

@app.post("/api/quiz/submit", response_model=QuizResponse)
async def submit_quiz(request: QuizSubmitRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lesson_id = request.lesson_id
    answers = request.answers
    
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    
    quiz = db.query(Quiz).filter(Quiz.lesson_id == lesson_id).first()
    
    # If no standard quiz exists, this is an AI-generated quiz
    # Use the score calculated by the frontend
    if not quiz:
         total = len(answers)
         
         # FIXED: Use the actual score calculated by frontend
         if request.calculated_score is not None:
             score = request.calculated_score
             correct = int((score / 100) * total)
         else:
             # Fallback if frontend doesn't send score (shouldn't happen)
             correct = total
             score = 100
         
         # Create activity record for AI-generated quiz
         activity = Activity(
             user_id=current_user.id, 
             activity_type="quiz_submitted", 
             entity_type="quiz", 
             entity_id=0,  # AI quiz doesn't have a persistent ID
             description=f"Submitted AI quiz: {lesson.title} (Score: {score}%)"
         )
         db.add(activity)
         db.commit()
         
         return {"score": score, "correct": correct, "total": total}

    questions = db.query(QuizQuestion).filter(QuizQuestion.quiz_id == quiz.id).all()
    correct = 0
    total = len(questions)
    
    for question in questions:
        user_answer = answers.get(str(question.id))
        if user_answer == question.correct_answer:
            correct += 1
            
    score = int((correct / total) * 100) if total > 0 else 0
    
    # Create activity record for standard quiz
    activity = Activity(user_id=current_user.id, activity_type="quiz_submitted", entity_type="quiz", entity_id=quiz.id, description=f"Submitted quiz: {lesson.title} (Score: {score}%)")
    db.add(activity)
    db.commit()
    
    return {"score": score, "correct": correct, "total": total}

@app.post("/api/quiz/request")
async def request_quiz(request: QuizRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == request.lessonId).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return {"success": True}

@app.post("/api/quiz/generate")
async def generate_ai_quiz(
    request: GenerateQuizRequest, # [FIX 3] Accept the JSON Body!
    current_user: User = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    """
    Triggers the AI to create a personalized quiz for a SPECIFIC lesson.
    """
    # [FIX 4] Pass the lesson ID from the request body
    quiz_data = await generate_personalized_quiz(current_user.id, db, request.lessonId, model_backend=request.model_backend)
    
    if quiz_data.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=quiz_data["message"]
        )
    
    return quiz_data

# ==========================================
# 7. LOGS, FEEDBACK & INSIGHTS
# ==========================================
@app.post("/api/log/lesson")
async def log_lesson(request: LessonLogRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == request.lessonId).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    # Check if student has already logged completion for this lesson
    already_completed = db.query(Activity).filter(
        Activity.user_id == current_user.id,
        Activity.activity_type == "lesson_completed",
        Activity.entity_type == "lesson",
        Activity.entity_id == lesson.id
    ).first() is not None
    
    if request.completed and not already_completed:
        activity = Activity(
            user_id=current_user.id,
            activity_type="lesson_completed",
            entity_type="lesson",
            entity_id=lesson.id,
            description=f"Completed lesson: {lesson.title}"
        )
        db.add(activity)
        db.flush()
        
        # Dynamically recalculate and save Enrollment progress in the transaction
        enrollment = db.query(Enrollment).filter(
            Enrollment.student_id == current_user.id,
            Enrollment.course_id == lesson.course_id
        ).first()
        if enrollment:
            total_course_lessons = db.query(Lesson).filter(Lesson.course_id == lesson.course_id).count() or 1
            completed_count = db.query(Activity).filter(
                Activity.user_id == current_user.id,
                Activity.activity_type == "lesson_completed",
                Activity.entity_type == "lesson"
            ).join(Lesson, Lesson.id == Activity.entity_id).filter(Lesson.course_id == lesson.course_id).count()
            
            enrollment.progress = min(100.0, round((completed_count / total_course_lessons) * 100, 2))
            db.add(enrollment)
            
    elif not request.completed and already_completed:
        # If toggling off, remove completion activity
        db.query(Activity).filter(
            Activity.user_id == current_user.id,
            Activity.activity_type == "lesson_completed",
            Activity.entity_type == "lesson",
            Activity.entity_id == lesson.id
        ).delete()
        
        enrollment = db.query(Enrollment).filter(
            Enrollment.student_id == current_user.id,
            Enrollment.course_id == lesson.course_id
        ).first()
        if enrollment:
            total_course_lessons = db.query(Lesson).filter(Lesson.course_id == lesson.course_id).count() or 1
            completed_count = db.query(Activity).filter(
                Activity.user_id == current_user.id,
                Activity.activity_type == "lesson_completed",
                Activity.entity_type == "lesson"
            ).join(Lesson, Lesson.id == Activity.entity_id).filter(Lesson.course_id == lesson.course_id).count()
            
            enrollment.progress = min(100.0, round((completed_count / total_course_lessons) * 100, 2))
            db.add(enrollment)
            
    db.commit()
    return {"success": True}


@app.post("/api/feedback/lesson")
async def feedback_lesson(request: LessonFeedbackRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True}

@app.post("/api/feedback/chat")
async def feedback_chat(request: ChatFeedbackRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True}

@app.get("/api/insights/students", response_model=list[StudentResponse])
async def get_students(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Filter out soft-deleted users
    students = db.query(User).filter(User.role == "student", User.is_deleted == False).all()
    result = []
    
    # Pre-fetch generic totals
    total_lessons_count = db.query(Lesson).count() or 1
    
    for student in students:
        # 1. Courses Enrolled
        enrollments = db.query(Enrollment).filter(Enrollment.student_id == student.id).all()
        course_count = len(enrollments)
        
        # 2. Progress Calculation (Based on Activities)
        # Count unique lessons completed by this student
        completed_lessons = db.query(Activity).filter(
            Activity.user_id == student.id,
            Activity.activity_type == "lesson_completed"
        ).count()
        
        # Calculate percentage (Cap at 100%)
        # If enrolled in specific courses, we should count lessons in those courses. 
        # But for list view, a rough estimate vs total catalog is often acceptable, or vs enrolled courses.
        # Let's do: if course_count > 0, assume roughly 20 lessons per course.
        # Or better: Count completed vs (course_count * 20).
        estimated_total_lessons = course_count * 15 if course_count > 0 else 1
        progress = min(100, round((completed_lessons / estimated_total_lessons) * 100)) if course_count > 0 else 0
        
        # 3. Attendance & Grades (Mocked with consistency using ID seed)
        # This ensures the same student always has the same "random" stats until real data is there
        random.seed(student.id)
        attendance = random.randint(70, 100)
        avg_grade = random.randint(65, 98) + (random.random() * 2) # e.g. 85.5
        
        result.append({
            "id": student.id,
            "name": student.name,
            "email": student.email,
            "progress": progress,
            "attendance": attendance,
            "averageGrade": round(avg_grade, 1),
            "coursesEnrolled": course_count
        })
        
    return result

@app.get("/api/insights/student/{student_id}", response_model=StudentDetailResponse)
async def get_student_detail(student_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from datetime import datetime, timedelta
    from sqlalchemy import func
    
    # Filter out soft-deleted users
    student = db.query(User).filter(User.id == student_id, User.role == "student", User.is_deleted == False).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Get student enrollments and calculate grades
    enrollments = db.query(Enrollment).filter(Enrollment.student_id == student_id).all()
    grades_data = []
    for enrollment in enrollments:
        course = db.query(Course).filter(Course.id == enrollment.course_id).first()
        if course:
            course_lessons = db.query(Lesson).filter(Lesson.course_id == course.id).all()
            
            # --- Grade Logic (Fallback) ---
            random.seed(str(student_id) + str(course.id))
            base_score = 85 if (student_id % 2 == 0) else 60
            variation = random.randint(-10, 10)
            avg_grade = max(0, min(100, base_score + variation))
            
            # --- Time Logic (Per Lesson) ---
            course_total_time = 0
            lessons_breakdown = []
            
            for lesson in course_lessons:
                lp = db.query(LessonProgress).filter(
                    LessonProgress.user_id == student_id,
                    LessonProgress.lesson_id == lesson.id
                ).first()
                
                t_min = int(lp.time_spent_seconds / 60) if lp else 0
                course_total_time += t_min
                
                # Include all lessons or just active? Let's include active + first few
                if t_min > 0:
                    lessons_breakdown.append({"title": lesson.title, "timeSpent": t_min})
            
            grades_data.append({
                "course": course.title, 
                "grade": avg_grade,
                "timeSpent": course_total_time,
                "lessons": lessons_breakdown
            })
    
    # Get performance data over time from activities
    performance_data = []
    activities = db.query(Activity).filter(
        Activity.user_id == student_id,
        Activity.activity_type.in_(["quiz_submitted", "lesson_completed"])
    ).order_by(Activity.created_at).limit(20).all()
    
    for activity in activities:
        if "Score:" in activity.description:
            # Extract score from description like "Submitted quiz: Lesson 1 (Score: 85%)"
            try:
                score = int(activity.description.split("Score: ")[1].split("%")[0])
                performance_data.append({
                    "date": activity.created_at.strftime("%Y-%m-%d"),
                    "score": score
                })
            except:
                pass
    
    # If no real performance data, generate mock data for demo
    if not performance_data:
        base_date = datetime.now() - timedelta(days=30)
        for i in range(10):
            performance_data.append({
                "date": (base_date + timedelta(days=i*3)).strftime("%Y-%m-%d"),
                "score": 70 + (hash(str(student_id) + str(i)) % 25)
            })
    
    # Get attendance pattern (active days)
    attendance_data = []
    all_activities = db.query(Activity).filter(Activity.user_id == student_id).all()
    active_dates = set()
    for activity in all_activities:
        active_dates.add(activity.created_at.strftime("%Y-%m-%d"))
    
    # Generate last 30 days attendance
    base_date = datetime.now() - timedelta(days=30)
    for i in range(30):
        check_date = (base_date + timedelta(days=i)).strftime("%Y-%m-%d")
        attendance_data.append({
            "date": check_date,
            "present": check_date in active_dates
        })
    
    # Calculate sentiment from activity descriptions
    positive_keywords = ["completed", "mastered", "achieved", "passed", "success", "enrolled"]
    negative_keywords = ["failed", "incomplete", "struggling"]
    neutral_keywords = ["started", "viewed", "accessed", "opened"]
    
    positive_count = 0
    negative_count = 0
    neutral_count = 0
    total_activities = len(all_activities)
    
    # Activity type breakdown
    quiz_activities = 0
    lesson_activities = 0
    enrollment_activities = 0
    
    # Detailed activity analysis
    positive_activities = []
    negative_activities = []
    
    for activity in all_activities:
        desc_lower = activity.description.lower()
        
        # Sentiment classification
        is_positive = any(keyword in desc_lower for keyword in positive_keywords)
        is_negative = any(keyword in desc_lower for keyword in negative_keywords)
        is_neutral = any(keyword in desc_lower for keyword in neutral_keywords) and not is_positive and not is_negative
        
        if is_positive:
            positive_count += 1
            positive_activities.append({
                "description": activity.description,
                "date": activity.created_at.strftime("%Y-%m-%d")
            })
        elif is_negative:
            negative_count += 1
            negative_activities.append({
                "description": activity.description,
                "date": activity.created_at.strftime("%Y-%m-%d")
            })
        elif is_neutral:
            neutral_count += 1
        
        # Activity type classification
        if activity.activity_type == "quiz_submitted":
            quiz_activities += 1
        elif activity.activity_type == "lesson_completed":
            lesson_activities += 1
        elif activity.activity_type == "enrollment":
            enrollment_activities += 1
    
    # Calculate total time spent (from LessonProgress)
    total_seconds = db.query(func.sum(LessonProgress.time_spent_seconds)).filter(
        LessonProgress.user_id == student_id
    ).scalar() or 0
    total_minutes = int(total_seconds / 60)

    # Calculate engagement score (Weighted + Time Bonus)
    if total_activities > 0:
        # Base Score = ((Positive * 2) + (Neutral * 1)) / (Total * 2) * 100
        weighted_score = ((positive_count * 2) + (neutral_count * 1)) / (total_activities * 2) * 100
        
        # Time Bonus: +1% for every 10 minutes spent (Max +20%) to reward effort
        time_bonus = min(20, total_minutes // 10)
        
        engagement_score = min(100, int(weighted_score + time_bonus))
        
        positive_percentage = round((positive_count / total_activities) * 100, 1)
        negative_percentage = round((negative_count / total_activities) * 100, 1)
        neutral_percentage = round((neutral_count / total_activities) * 100, 1)
    else:
        engagement_score = 50
        positive_percentage = 0
        negative_percentage = 0
        neutral_percentage = 0
    
    # Determine engagement level
    if engagement_score >= 75:
        engagement_level = "Highly Engaged"
        engagement_description = "This student shows excellent engagement with consistent positive learning activities."
    elif engagement_score >= 60:
        engagement_level = "Engaged"
        engagement_description = "This student maintains good engagement with regular learning activities."
    elif engagement_score >= 40:
        engagement_level = "Moderately Engaged"
        engagement_description = "This student shows moderate engagement. Consider additional support to boost motivation."
    else:
        engagement_level = "Needs Attention"
        engagement_description = "This student may need additional support and encouragement to stay engaged."
    
    # Generate detailed insights
    notes_data = []
    
    # Overall summary
    notes_data.append({
        "id": "1",
        "content": f"Total activities: {total_activities} | Engagement Level: {engagement_level}",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    
    # Sentiment breakdown
    notes_data.append({
        "id": "2",
        "content": f"Positive activities: {positive_count} ({positive_percentage}%) | Negative: {negative_count} ({negative_percentage}%) | Neutral: {neutral_count} ({neutral_percentage}%)",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    
    # Activity type breakdown
    notes_data.append({
        "id": "3",
        "content": f"Activity breakdown: {quiz_activities} quizzes, {lesson_activities} lessons completed, {enrollment_activities} enrollments",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    
    # Personalized insight
    notes_data.append({
        "id": "4",
        "content": engagement_description,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    
    # Recent achievements (last 3 positive activities)
    if positive_activities:
        recent_positive = positive_activities[-3:]
        achievements_text = " | ".join([f"{a['description'][:50]}..." if len(a['description']) > 50 else a['description'] for a in recent_positive])
        notes_data.append({
            "id": "5",
            "content": f"Recent achievements: {achievements_text}",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
    
    # Get Teacher Notes
    teacher_notes = db.query(TeacherNote).filter(TeacherNote.student_id == student_id).order_by(TeacherNote.created_at.desc()).all()
    teacher_notes_data = []
    for note in teacher_notes:
        teacher_notes_data.append({
            "id": str(note.id),
            "content": note.note_content,
            "weight": note.weight,
            "timestamp": note.created_at.strftime("%Y-%m-%d %H:%M:%S") if note.created_at else ""
        })
    
    # Get Student Sentiments (Analyze last 50 for meaningful chart stats)
    student_sentiments = db.query(StudentSentiment).filter(StudentSentiment.student_id == student_id).order_by(StudentSentiment.created_at.desc()).limit(50).all()
    sentiments_data = []
    for sentiment in student_sentiments:
        sentiments_data.append({
            "id": str(sentiment.id),
            "message": sentiment.original_message or sentiment.translated_message,
            "sentiment_label": sentiment.sentiment_label,
            "confidence": round(sentiment.confidence_score, 2) if sentiment.confidence_score else 0,
            "timestamp": sentiment.created_at.strftime("%Y-%m-%d %H:%M:%S") if sentiment.created_at else ""
        })
    
    # Sentiment data for detailed breakdown
    sentiment_data = {
        "positive": positive_count,
        "negative": negative_count,
        "neutral": neutral_count,
        "positivePercentage": positive_percentage,
        "negativePercentage": negative_percentage,
        "neutralPercentage": neutral_percentage,
        "engagementLevel": engagement_level,
        "quiz_activities": quiz_activities,
        "lesson_activities": lesson_activities,
        "enrollment_activities": enrollment_activities
    }
    
    return {
        "id": student.id,
        "name": student.name,
        "performance": performance_data,
        "attendance": attendance_data,
        "grades": grades_data,
        "notes": notes_data,
        "engagementScore": engagement_score,
        "totalActivities": total_activities,
        "sentimentData": sentiment_data,
        "teacherNotes": teacher_notes_data,
        "studentSentiments": sentiments_data,
        "totalTimeSpent": total_minutes
    }

@app.get("/api/notes/student/{student_id}")
async def get_student_notes(student_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return []

@app.post("/api/insights/comment")
async def add_comment(request: CommentRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True, "comment": request.comment}

@app.post("/api/profile/goal")
async def set_goal(request: GoalRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True}

@app.post("/api/profile/preference")
async def set_preference(request: PreferenceRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True}

@app.post("/api/notifications/settings")
async def update_notification_settings(settings: dict, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"success": True}

# File upload endpoint for course images
@app.post("/api/upload/course-image")
async def upload_course_image(
    file: UploadFile = File(...),
    course_id: Optional[int] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload a course image and return the URL. Uses course_id to ensure unique filename per course."""
    # Validate file type
    allowed_types = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type. Only images are allowed.")
    
    # If course_id is provided, delete old image if it exists
    old_thumbnail = None
    if course_id:
        course = db.query(Course).filter(Course.id == course_id).first()
        if course and course.thumbnail:
            old_thumbnail = course.thumbnail
            # Extract filename from thumbnail path
            if old_thumbnail.startswith('/uploads/'):
                old_file_path = os.path.join(UPLOAD_DIR, old_thumbnail.replace('/uploads/', ''))
                # Delete old file if it exists
                if os.path.exists(old_file_path):
                    try:
                        os.remove(old_file_path)
                    except Exception:
                        pass  # Ignore errors when deleting old file
    
    # Generate unique filename using course_id if provided, otherwise use random
    file_ext = os.path.splitext(file.filename)[1] or '.jpg'
    if course_id:
        # Use course_id as the unique identifier
        unique_filename = f"course_{course_id}{file_ext}"
    else:
        # For new courses, use timestamp + random
        import time
        unique_filename = f"course_new_{int(time.time())}_{random.randint(1000, 9999)}{file_ext}"
    
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    
    # Save file
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Return the URL path
        image_url = f"/uploads/{unique_filename}"
        return {"url": image_url, "filename": unique_filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)