from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Text, Float, DateTime, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


parent_student = Table('parent_student', Base.metadata,
    Column('parent_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('student_id', Integer, ForeignKey('users.id'), primary_key=True)
)

teacher_student = Table('teacher_student', Base.metadata,
    Column('teacher_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('student_id', Integer, ForeignKey('users.id'), primary_key=True)
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="student")  # student, teacher, parent
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_deleted = Column(Boolean, default=False)  # Soft delete flag
    deleted_at = Column(DateTime(timezone=True), nullable=True)  # When was the user deleted
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=True)  # null = platform-only user
    persona_profile = Column(Text, nullable=True)  # JSON blob of global traits (learning_style, tone, etc)

    # Parent relationships
    children = relationship(
        "User", 
        secondary=parent_student,
        primaryjoin=id==parent_student.c.parent_id,
        secondaryjoin=id==parent_student.c.student_id,
        backref="parents"
    )

    # Teacher relationships
    students_taught = relationship(
        "User",
        secondary=teacher_student,
        primaryjoin=id==teacher_student.c.teacher_id,
        secondaryjoin=id==teacher_student.c.student_id,
        backref="teachers"
    )



class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    instructor = Column(String, nullable=False)
    duration = Column(Integer)  # in minutes
    thumbnail = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    term = Column(String, default="Term 1")
    
    lessons = relationship("Lesson", back_populates="course", cascade="all, delete-orphan")
    enrollments = relationship("Enrollment", back_populates="course", cascade="all, delete-orphan")


class Lesson(Base):
    __tablename__ = "lessons"

    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    video_url = Column(String)
    duration = Column(Integer)  # in minutes
    order = Column(Integer, default=0)
    completed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    content = Column(Text, nullable=True)  # Legacy/default content
    content_en = Column(Text, nullable=True)  # English content
    content_ar = Column(Text, nullable=True)  # Arabic content
    
    course = relationship("Course", back_populates="lessons")
    quiz = relationship("Quiz", back_populates="lesson", uselist=False, cascade="all, delete-orphan")


class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    lesson = relationship("Lesson", back_populates="quiz")
    questions = relationship("QuizQuestion", back_populates="quiz", cascade="all, delete-orphan")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    question = Column(Text, nullable=False)
    option_a = Column(String, nullable=False)
    option_b = Column(String, nullable=False)
    option_c = Column(String, nullable=False)
    option_d = Column(String, nullable=True)
    correct_answer = Column(Integer, nullable=False)  # 0, 1, 2, or 3
    order = Column(Integer, default=0)
    
    quiz = relationship("Quiz", back_populates="questions")


class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    current_lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=True)

    progress = Column(Float, default=0.0)  # 0-100
    enrolled_at = Column(DateTime(timezone=True), server_default=func.now())
    
    student = relationship("User")
    course = relationship("Course", back_populates="enrollments")
    current_lesson = relationship("Lesson", foreign_keys=[current_lesson_id])


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("quiz_questions.id"), nullable=False)
    answer = Column(Integer, nullable=False)
    is_correct = Column(Boolean, default=False)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    activity_type = Column(String, nullable=False)  # 'enrollment', 'lesson_completed', 'quiz_submitted', 'course_started'
    entity_type = Column(String, nullable=False)  # 'course', 'lesson', 'quiz'
    entity_id = Column(Integer, nullable=False)
    description = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    user = relationship("User")

class StudentSentiment(Base):
    __tablename__ = "student_sentiments"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    original_message = Column(Text)
    translated_message = Column(Text)
    sentiment_label = Column(String) # e.g. "frustration"
    confidence_score = Column(Float)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("User")

class TeacherNote(Base):
    __tablename__ = "teacher_notes"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    note_content = Column(Text, nullable=False) # e.g. "Struggles with syntax"
    category = Column(String, default="TOPIC_SPECIFIC") # 'CORE_PERSONA', 'WEAKNESS', 'STRENGTH', 'TOPIC_SPECIFIC'
    weight = Column(Float, default=1.0) # Importance of this note
    embedding = Column(Text, nullable=True) # JSON array of floats for semantic search
    topic_tags = Column(String, nullable=True) # e.g. "Math", "Fractions"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("User")


class LessonProgress(Base):
    __tablename__ = "lesson_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False)
    time_spent_seconds = Column(Integer, default=0)
    last_accessed = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    user = relationship("User")
    lesson = relationship("Lesson")


# =============================================================================
# SCHOOL MANAGEMENT MODELS
# =============================================================================

class School(Base):
    __tablename__ = "schools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    address = Column(Text, nullable=True)
    logo_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    grades = relationship("Grade", back_populates="school", cascade="all, delete-orphan")


class Grade(Base):
    __tablename__ = "grades"

    id = Column(Integer, primary_key=True, index=True)
    school_id = Column(Integer, ForeignKey("schools.id"), nullable=False)
    name = Column(String, nullable=False)           # e.g. "Grade 10", "Year 3"
    academic_year = Column(String, nullable=False)  # e.g. "2025-2026"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    school = relationship("School", back_populates="grades")
    classrooms = relationship("PhysicalClassroom", back_populates="grade", cascade="all, delete-orphan")


class PhysicalClassroom(Base):
    """
    Represents a real physical room in a school building.
    This is the core entity the CV system monitors.
    class_id in the CV pipeline = PhysicalClassroom.id
    """
    __tablename__ = "physical_classrooms"

    id = Column(Integer, primary_key=True, index=True)
    grade_id = Column(Integer, ForeignKey("grades.id"), nullable=False)
    name = Column(String, nullable=False)          # e.g. "10-A", "Science Lab 2"
    room_number = Column(String, nullable=True)    # e.g. "B204"
    capacity = Column(Integer, nullable=True)
    # Camera source: integer index ("0") for webcam, RTSP URL, or None
    camera_source = Column(String, nullable=True, default="0")
    # Switches CV pipeline to exam configuration
    is_exam_room = Column(Boolean, default=False)
    # JSON blob for overridable exam thresholds per room
    # Keys: distraction_timer_sec, neighbor_yaw_threshold, rapid_change_count, rapid_change_window_sec
    exam_config_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    grade = relationship("Grade", back_populates="classrooms")
    student_links = relationship("ClassroomStudent", back_populates="classroom", cascade="all, delete-orphan")
    teacher_links = relationship("ClassroomTeacher", back_populates="classroom", cascade="all, delete-orphan")
    schedule_slots = relationship("ClassSchedule", back_populates="classroom", cascade="all, delete-orphan")
    cv_sessions = relationship("CVSession", back_populates="classroom")


class ClassroomStudent(Base):
    """Roster: which students belong to which physical classroom."""
    __tablename__ = "classroom_students"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("physical_classrooms.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)  # False = transferred/removed

    classroom = relationship("PhysicalClassroom", back_populates="student_links")
    student = relationship("User")


class ClassroomTeacher(Base):
    """Which teachers are assigned to a classroom and in what role."""
    __tablename__ = "classroom_teachers"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("physical_classrooms.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String, default="subject")   # 'homeroom' | 'subject'
    subject = Column(String, nullable=True)    # e.g. "Math", "Science"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    classroom = relationship("PhysicalClassroom", back_populates="teacher_links")
    teacher = relationship("User")


class ClassSchedule(Base):
    """Weekly timetable entry: which teacher teaches what in which room at what time."""
    __tablename__ = "class_schedule"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("physical_classrooms.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    subject = Column(String, nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0=Monday ... 4=Friday
    period_start = Column(String, nullable=False)  # "08:00" (stored as string HH:MM)
    period_end = Column(String, nullable=False)    # "09:00"

    classroom = relationship("PhysicalClassroom", back_populates="schedule_slots")
    teacher = relationship("User")


# =============================================================================
# CV ANALYTICS MODELS
# =============================================================================

class StudentFaceProfile(Base):
    """
    Stores the ArcFace embedding for a student's face.
    One profile per student. Updated when a new photo is uploaded.
    Embedding is stored as a pickled numpy float32[512] array.
    """
    __tablename__ = "student_face_profiles"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    embedding = Column(Text, nullable=False)  # Base64-encoded numpy array
    photo_url = Column(String, nullable=True) # Path to the original uploaded photo
    enrolled_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    student = relationship("User", foreign_keys=[student_id])
    enrolled_by_user = relationship("User", foreign_keys=[enrolled_by])


class CVSession(Base):
    """
    One record per webcam monitoring session.
    session_type: 'class' for normal monitoring, 'exam' for proctoring mode.
    summary_json is populated when the session ends.
    """
    __tablename__ = "cv_sessions"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("physical_classrooms.id"), nullable=False)
    session_type = Column(String, default="class")  # 'class' | 'exam'
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    subject_name = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)
    started_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    summary_json = Column(Text, nullable=True)  # JSON analytics blob saved on stop

    classroom = relationship("PhysicalClassroom", back_populates="cv_sessions")
    started_by_user = relationship("User", foreign_keys=[started_by])
    teacher = relationship("User", foreign_keys=[teacher_id])
    focus_events = relationship("FocusEvent", back_populates="session", cascade="all, delete-orphan")


class FocusEvent(Base):
    """
    A logged distraction or recovery event within a CV session.
    event_type:
      'distracted'       - student entered distracted state
      'recovered'        - student returned to focused state
      'unknown_face'     - unrecognized face detected
      'neighbor_glance'  - exam: looking at neighbor (lateral yaw)
      'rapid_scan'       - exam: rapid left-right head movement (cheating signal)
    """
    __tablename__ = "focus_events"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("cv_sessions.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # Null = UNKNOWN face
    event_type = Column(String, nullable=False)
    pitch = Column(Float, nullable=True)
    yaw = Column(Float, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_sec = Column(Float, nullable=True)  # Filled when event closes

    session = relationship("CVSession", back_populates="focus_events")
    student = relationship("User", foreign_keys=[student_id])

class ActiveLearningSession(Base):
    __tablename__ = "active_learning_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False)
    # Store the conversation history as JSON
    history_json = Column(Text, default="[]") 
    is_completed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User")
    lesson = relationship("Lesson")
