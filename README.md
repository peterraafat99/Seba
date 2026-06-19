# Seba: School Management, Online Learning & Real-time Classroom Analytics System

Seba is a modern, bilingual (Arabic/English) **School Management & Learning Platform** tailored to the Egyptian National Curriculum. It integrates online learning portals with an advanced **Computer Vision (CV) Real-time Proctoring and Focus Analytics engine** and an **NFC Attendance System**.

---

## 🏛️ System Architecture Overview

```
                          ┌────────────────────────────────┐
                          │         React Frontend         │
                          │   (TailwindCSS + TypeScript)   │
                          └──────────────┬─────────────────┘
                                         │
                             HTTP Rest   │   WebSockets
                             & JWT Auth  │   (Real-time CV Overlay)
                                         ▼
                          ┌────────────────────────────────┐
                          │       FastAPI Web Server       │
                          │   (models.py, main.py, RBAC)   │
                          └──────────────┬─────────────────┘
                                         │
                 ┌───────────────────────┼──────────────────────┐
                 ▼                       ▼                      ▼
  ┌─────────────────────────────┐ ┌─────────────┐ ┌───────────────────────────┐
  │   Computer Vision Engine    │ │ SQLite DB   │ │   AI Chatbot/RAG Engine   │
  │ (RetinaFace, ArcFace, FSM)  │ │ (SQLAlchemy)│ │  (Ollama/Qwen OR Gemini)  │
  └──────────────┬──────────────┘ └─────────────┘ └──────────────┬────────────┘
                 │                                               │
                 ▼                                               ▼
     [Camera RTSP/Webcam Feed]                      [Egypt Math Curriculum PDFs]
```

Seba consists of:
1. **FastAPI Web Server:** Handles business logic, RBAC, timetables, grading, homework submissions, and student notes.
2. **Computer Vision Suite:** Interacts via WebSockets to broadcast processed video frames containing bounding box overlays, head pose indicators, focus rates, and cheating alerts.
3. **AI Chatbot & RAG Engine:** Provides interactive lesson tutoring, voice queries, image OCR for math questions, and mood-adaptive quizzes.
4. **SQLite Database:** Stores student details, grades, attendance logs, and school configurations.

---

## 👥 Roles & Access Controls

- **👑 Super Admin:** Performs global system maintenance, manages multiple schools, and oversees database migrations.
- **🏫 School Manager:** Sets up grades, schedules classes, enrolls physical rooms, registers students/teachers, and seeds face profiles.
- **👩‍🏫 Teacher:** Manages live CV sessions, monitors student attention metrics, reviews cheating logs, and adds student notes.
- **🎓 Student:** Interacts with lessons, queries the Seba AI chatbot, takes personalized quizzes, and uploads homework.
- **👪 Parent:** Monitors the student's curriculum completion progress, grades, and classroom focus rates.

---

## 🗄️ Comprehensive Database Schema

Seba maps the following relational tables inside `learning_platform.db` using SQLAlchemy:

### 1. User Management Tables
* **`users`:** Holds user profiles, passwords, and school mappings.
  - `id` (INTEGER, PK)
  - `name` (TEXT, Not Null)
  - `email` (TEXT, Unique, Not Null)
  - `hashed_password` (TEXT, Not Null)
  - `role` (TEXT, Not Null) — `'admin' | 'school_manager' | 'teacher' | 'student' | 'parent'`
  - `school_id` (INTEGER, FK -> schools.id)
  - `is_deleted` (BOOLEAN, Default False)
* **`parent_student`:** Many-to-Many join table linking parents to children.
* **`teacher_student`:** Many-to-Many join table linking teachers to students.

### 2. School Structure Tables
* **`schools`:** School identifiers.
  - `id` (INTEGER, PK), `name` (TEXT), `address` (TEXT), `logo_url` (TEXT)
* **`grades`:** Academic levels.
  - `id` (INTEGER, PK), `school_id` (FK), `name` (TEXT), `academic_year` (TEXT)
* **`physical_classrooms`:** Physical school rooms monitored by cameras.
  - `id` (INTEGER, PK), `grade_id` (FK), `name` (TEXT), `room_number` (TEXT), `capacity` (INTEGER)
  - `camera_source` (TEXT) — Camera index or RTSP link.
  - `is_exam_room` (BOOLEAN) — Active exam strict mode.
  - `exam_config_json` (TEXT) — Thresholds for pitch, yaw, and scanning.
* **`classroom_students`:** Roster tracking students in a physical classroom.
* **`classroom_teachers`:** Links teachers, their subjects, and physical classrooms.
* **`class_schedule`:** Weekly timetable slots.
  - `id`, `classroom_id` (FK), `teacher_id` (FK), `subject` (TEXT), `day_of_week` (INTEGER), `period_start` (TEXT), `period_end` (TEXT)

### 3. Curriculum & Student Performance Tables
* **`courses`:** Course catalogs (e.g. Algebra).
  - `id`, `title`, `description`, `subject`, `grade_level`
* **`lessons`:** Structured units within a course.
  - `id`, `course_id` (FK), `title`, `content_en` (TEXT), `content_ar` (TEXT)
* **`enrollments`:** Records courses students are enrolled in and completion progress.
* **`lesson_progress`:** Tracks time spent (seconds) and completion status per student per lesson.
* **`quizzes`:** Platform, teacher, or AI-generated quizzes.
  - `id` (INTEGER, PK), `lesson_id` (FK), `quiz_type` (TEXT) — `'platform' | 'teacher' | 'generated'`, `student_id` (FK), `title`, `difficulty`
* **`quiz_questions`:** Multiple-choice quiz questions.
  - `id`, `quiz_id` (FK), `question` (TEXT), `option_a`, `option_b`, `option_c`, `option_d`, `correct_answer` (0-3)
* **`quiz_answers`:** Student selections for individual questions.
  - `id`, `student_id` (FK), `quiz_id` (FK), `question_id` (FK), `answer` (INTEGER), `is_correct` (BOOLEAN)
* **`quiz_submissions`:** Structured overall scores.
  - `id` (INTEGER, PK), `student_id` (FK), `quiz_id` (FK), `score` (REAL), `correct_answers` (INTEGER), `total_questions` (INTEGER), `submitted_at` (DATETIME)
* **`activities`:** General system log.
  - `id`, `user_id` (FK), `activity_type` (TEXT), `entity_type` (TEXT), `entity_id` (INTEGER), `description` (TEXT)

### 4. Computer Vision & Attendance Tables
* **`student_face_profiles`:** Stores 512-dimensional ArcFace vector encodings.
  - `student_id` (INTEGER, FK, Unique), `embedding` (TEXT) — Base64 pickled vector, `photo_url` (TEXT)
* **`cv_sessions`:** Logs active camera streams.
  - `id` (INTEGER, PK), `classroom_id` (FK), `session_type` (TEXT) — `'class' | 'exam'`, `started_at`, `ended_at`, `summary_json` (TEXT)
* **`focus_events`:** Distractions or proctoring alerts.
  - `id`, `session_id` (FK), `student_id` (FK, Nullable), `event_type` (TEXT), `pitch` (REAL), `yaw` (REAL), `started_at`, `ended_at`, `duration_sec` (REAL)
* **`classroom_messages`:** Timetable announcements or DMs between users.

---

## 🔌 API Endpoints Reference

### 🔐 Authentication (`/api/auth`)
- `POST /api/auth/register` — Registers a new user account.
- `POST /api/auth/login` — Returns a JWT token.
- `POST /api/auth/logout` — Invalidates the current session.
- `GET /api/auth/me` — Fetches current user profile.

### 🏫 School Management & Hierarchy (`/api/school`)
- `POST /api/schools` — Creates a school profile.
- `GET /api/schools` — Lists all registered schools.
- `POST /api/schools/{school_id}/grades` — Creates an academic grade level.
- `POST /api/schools/grades/{grade_id}/classrooms` — Creates a physical classroom.
- `POST /api/schools/classrooms/{classroom_id}/students` — Binds students to a classroom.
- `POST /api/schools/classrooms/{classroom_id}/teachers` — Binds teacher subject roles.
- `POST /api/schools/classrooms/{classroom_id}/schedule` — Configures the timetable.

### 📚 Online Curriculum (`/api/courses` & `/api/lessons`)
- `GET /api/courses` — Lists available courses.
- `GET /api/courses/{course_id}` — Gets course detail.
- `POST /api/courses/{course_id}/enroll` — Enrolls a student.
- `GET /api/lessons/{lesson_id}` — Fetches lesson contents (bilingual).
- `POST /api/lessons/{lesson_id}/track-time` — Records learning active time.

### 🤖 AI Tutoring, OCR, RAG & Quizzes
- `POST /api/chat` — Core tutoring text chatbot (Egyptian curriculum RAG context).
- `POST /api/active-learning/start` — Initializes interactive step-by-step math tutoring sessions.
- `POST /api/chat/image` — Submits student equations/handwriting photos for OCR parsing and explanation.
- `POST /api/chat/voice` — Handles spoken voice question query pipelines.
- `POST /api/quiz/submit` — Submits quiz answers, returns score, and writes a structured `QuizSubmission` record.
- `POST /api/quiz/generate` — Requests custom AI-generated quiz matching recent student emotion levels.

### 📹 Computer Vision & Monitoring Session Controls
- `POST /api/cv/session/start` — Initializes classroom stream tracking.
- `POST /api/cv/session/stop` — Halts camera processing and compiles summary JSON logs.
- `GET /api/cv/session/{session_id}/summary` — Queries physical attention statistics.
- `POST /api/cv/faces/enroll` — Enrolls or updates a student face recognition profile.
- `WS /api/cv/ws/{classroom_id}` — Live WebSocket broadcasting bounding box coords, head orientations, focus states, and student identities.

### 💳 Attendance System (`/api/attendance`)
- `POST /api/attendance/scan` — Logs NFC card scans from physical readers.
- `POST /api/attendance/enroll_card` — Pairs an NFC tag UID with a student ID.
- `GET /api/attendance/classroom/{classroom_id}/today` — Reports today's physical attendance list.

---

## 📹 The Computer Vision Processing Pipeline

The CV tracking worker operates sequentially:
1. **Frame Capture:** Grabs images from physical USB cameras or RTSP classroom IP cameras.
2. **Face Detection:** Configurable backends running RetinaFace (via default InsightFace) or YOLOv11 Face model models to find bounding boxes.
3. **Identity Verification:** On anchor frames, extracts the 512-dimensional ArcFace vector and query-matches it against the local student FAISS index.
4. **Supervision ByteTrack:** Maintains track IDs on subsequent intermediate frames, avoiding heavy model recognition workloads.
5. **Head Pose Estimation:** Map Pitch, Yaw, and Roll using a custom **2D Landmark Ratio Method**. It uses geometric ratios between 5 facial landmark keypoints:
   - `pitch = (nose_y - eye_y_midpoint) / face_height`
   - `yaw = (nose_x - left_eye_x) / (right_eye_x - left_eye_x)`
   This approach provides 100% stable, ambiguity-free head pose indicators without heavy neural nets.
6. **Focus State Machine (FSM):**
   - **Classroom Mode:** Continuous distraction (head turned away) for **>10 seconds** writes a distraction event.
   - **Exam Mode:** Continuous distraction for **>2 seconds** triggers warnings. Lateral yaw shifts are cataloged as `neighbor_glance`. Fast back-and-forth direction switches (Left-Right-Left) >3 times in 5 seconds log a `rapid_scan` cheating flag.

---

## 🧠 Memory Evictions for 16GB RAM Laptops

To avoid memory exhaustion crashes when launching local models on consumer-grade devices:
- **Device Isolation:** Enforces local BGE-M3 and emotional classifiers onto `cpu` devices to preserve GPU memory for Ollama.
- **Eviction Lifecycle (`unload_local_models`):** Inside `chatbot.py`, references to local encoders and pipeline configurations are deleted, followed by manual `gc.collect()` and `torch.cuda.empty_cache()` calls. This evicts **3+ GB of RAM** prior to sending prompts to Ollama.
- **Toggling (`CACHE_LOCAL_MODELS`):**
  - Set `CACHE_LOCAL_MODELS=true` for 32GB setups (no unload delays).
  - Set `CACHE_LOCAL_MODELS=false` for 16GB setups (safely unloads weights between prompts).

---

## 🔧 Installation & Setup

1. **Python dependencies:**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
2. **Ingest PDFs & Build index:**
   ```bash
   python ingest_pdfs.py
   python build_rag.py
   ```
3. **Database initialization:**
   ```bash
   python init_db.py
   ```
4. **Start Web Server:**
   ```bash
   python main.py
   ```
5. **Start React/Vite development server:**
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```
