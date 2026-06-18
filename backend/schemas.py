from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict
from datetime import datetime


# User schemas
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str = "default123"  # Default password for now
    role: str = "student"
    school_id: Optional[int] = None


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    school_id: Optional[int] = None
    
    class Config:
        from_attributes = True
        populate_by_name = True


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


# Course schemas
class LessonItem(BaseModel):
    id: int
    title: str
    duration: int
    completed: bool
    order: int
    
    class Config:
        from_attributes = True


class CourseCreate(BaseModel):
    title: str
    description: Optional[str] = None
    instructor: str
    duration: int
    thumbnail: Optional[str] = None


class CourseResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    instructor: str
    duration: int
    enrolled: int = 0
    thumbnail: Optional[str] = None
    isEnrolled: Optional[bool] = False
    progress: Optional[float] = 0.0
    lessons: List[LessonItem] = []
    
    class Config:
        from_attributes = True


# Lesson schemas
class QuizQuestionItem(BaseModel):
    id: int
    question: str
    options: List[str]
    correctAnswer: int
    
    class Config:
        from_attributes = True


class QuizData(BaseModel):
    questions: List[QuizQuestionItem]


class LessonCreate(BaseModel):
    course_id: int
    title: str
    description: Optional[str] = None
    video_url: Optional[str] = None
    duration: int
    order: int = 0


class LessonResponse(BaseModel):
    id: int
    title: str
    videoUrl: Optional[str] = None
    description: Optional[str] = None
    courseId: int
    courseTitle: str
    nextLessonId: Optional[int] = None
    previousLessonId: Optional[int] = None
    quiz: Optional[QuizData] = None
    content: Optional[str] = None  # Legacy/default content
    content_en: Optional[str] = None  # English content
    content_ar: Optional[str] = None  # Arabic content
    
    class Config:
        from_attributes = True


# Dashboard schema
class CourseItem(BaseModel):
    id: int
    title: str
    instructor: str
    progress: float
    thumbnail: Optional[str] = None


class ActivityItem(BaseModel):
    description: str
    timestamp: str


class DashboardResponse(BaseModel):
    courses: List[CourseItem]
    progress: int
    upcomingLessons: List[Dict]
    recentActivity: List[ActivityItem]
    students: Optional[List[Dict]] = None


# Quiz schemas
class QuizSubmit(BaseModel):
    answers: Dict[str, int]


class QuizResponse(BaseModel):
    score: int
    correct: int
    total: int


# Chat schemas
class ChatMessage(BaseModel):
    lessonId: int
    message: str
    model_backend: Optional[str] = None


class ChatResponse(BaseModel):
    message: str


class ActiveLearningStartRequest(BaseModel):
    lessonId: int
    model_backend: Optional[str] = None

class ActiveLearningMessageRequest(BaseModel):
    lessonId: int
    message: str
    model_backend: Optional[str] = None


# Student/Insights schemas
class StudentResponse(BaseModel):
    id: int
    name: str
    email: str
    progress: int
    attendance: int
    averageGrade: float
    coursesEnrolled: int


class PerformanceItem(BaseModel):
    date: str
    score: int


class AttendanceItem(BaseModel):
    date: str
    present: bool



class LessonBreakdown(BaseModel):
    title: str
    timeSpent: int

class GradeItem(BaseModel):
    course: str
    grade: int
    timeSpent: int = 0
    lessons: List[LessonBreakdown] = []


class StudentDetailResponse(BaseModel):
    id: int
    name: str
    performance: List[PerformanceItem]
    attendance: List[AttendanceItem]
    grades: List[GradeItem]
    notes: List[Dict]
    engagementScore: Optional[int] = 50
    totalActivities: Optional[int] = 0
    totalTimeSpent: Optional[int] = 0  # In minutes
    sentimentData: Optional[Dict] = None
    teacherNotes: Optional[List[Dict]] = []
    studentSentiments: Optional[List[Dict]] = []


# =============================================================================
# SCHOOL MANAGEMENT SCHEMAS
# =============================================================================

class SchoolCreate(BaseModel):
    name: str
    address: Optional[str] = None
    logo_url: Optional[str] = None

class SchoolResponse(BaseModel):
    id: int
    name: str
    address: Optional[str] = None
    logo_url: Optional[str] = None
    class Config:
        from_attributes = True

class GradeCreate(BaseModel):
    name: str
    academic_year: str

class GradeResponse(BaseModel):
    id: int
    school_id: int
    name: str
    academic_year: str
    class Config:
        from_attributes = True

class ClassroomCreate(BaseModel):
    name: str
    room_number: Optional[str] = None
    capacity: Optional[int] = None
    camera_source: Optional[str] = "0"
    is_exam_room: bool = False

class ClassroomResponse(BaseModel):
    id: int
    grade_id: int
    name: str
    room_number: Optional[str] = None
    capacity: Optional[int] = None
    camera_source: Optional[str] = None
    is_exam_room: bool
    class Config:
        from_attributes = True

class StudentRosterItem(BaseModel):
    student_id: int
    name: str
    email: str
    is_active: bool
    has_face_profile: bool = False

class ClassroomDetailResponse(BaseModel):
    id: int
    name: str
    room_number: Optional[str] = None
    is_exam_room: bool
    students: List[StudentRosterItem] = []
    teachers: List[Dict] = []
    class Config:
        from_attributes = True

class AddStudentsRequest(BaseModel):
    student_ids: List[int]

class AssignTeacherRequest(BaseModel):
    teacher_id: int
    role: str = "subject"   # 'homeroom' | 'subject'
    subject: Optional[str] = None

class ScheduleSlotCreate(BaseModel):
    teacher_id: int
    subject: str
    day_of_week: int  # 0-4
    period_start: str # "HH:MM"
    period_end: str   # "HH:MM"

class ScheduleSlotResponse(BaseModel):
    id: int
    teacher_id: int
    subject: str
    day_of_week: int
    period_start: str
    period_end: str
    class Config:
        from_attributes = True


# =============================================================================
# CV SESSION SCHEMAS
# =============================================================================

class CVSessionStartRequest(BaseModel):
    classroom_id: int
    session_type: str = "class"  # 'class' | 'exam'
    teacher_id: Optional[int] = None
    course_id: Optional[int] = None
    lesson_id: Optional[int] = None
    nfc_only: bool = False


class CVSessionResponse(BaseModel):
    session_id: int
    classroom_id: int
    session_type: str
    status: str
    message: str

class CVSessionSummaryResponse(BaseModel):
    session_id: int
    classroom_id: int
    session_type: str
    started_at: str
    ended_at: Optional[str] = None
    duration_minutes: Optional[float] = None
    summary: Optional[Dict] = None


# =============================================================================
# FACE ENROLLMENT SCHEMAS
# =============================================================================

class FaceEnrollResponse(BaseModel):
    student_id: int
    student_name: str
    status: str   # 'enrolled' | 'updated' | 'failed'
    message: str

class FaceProfileStatus(BaseModel):
    student_id: int
    has_profile: bool
    photo_url: Optional[str] = None
    enrolled_at: Optional[str] = None


# =============================================================================
# ANALYTICS SCHEMAS
# =============================================================================

class StudentAnalyticsResponse(BaseModel):
    student_id: int
    name: str
    # Platform world
    platform: Dict = {}  # courses, quiz scores, time spent, chatbot sentiments
    # Physical world
    physical: Dict = {}  # focus sessions, avg focus rate, distraction events
    # Merged insight
    engagement_score: float = 0.0
    flags: List[str] = []  # e.g. ['low_focus_in_physics', 'high_distraction_morning']

class ClassroomAnalyticsResponse(BaseModel):
    classroom_id: int
    classroom_name: str
    total_sessions: int
    avg_focus_rate: float
    total_students: int
    sessions: List[Dict] = []


# =============================================================================
# MESSAGING SCHEMAS
# =============================================================================

class ClassroomMessageCreate(BaseModel):
    message: str
    student_id: Optional[int] = None

class ClassroomMessageResponse(BaseModel):
    id: int
    classroom_id: int
    sender_id: int
    sender_name: str
    student_id: Optional[int] = None
    message: str
    created_at: datetime
    class Config:
        from_attributes = True


# =============================================================================
# COUNSELOR REPORT SCHEMAS
# =============================================================================

class CounselorReportSaveRequest(BaseModel):
    report: str

class CounselorReportResponse(BaseModel):
    student_id: int
    counselor_report: Optional[str] = None
    counselor_report_summary: Optional[str] = None
    class Config:
        from_attributes = True

