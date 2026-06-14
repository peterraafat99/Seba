# Seba AI Tutor Database Schema Report

This report outlines the complete database structure of the Seba AI Tutor platform, categorized by system modules. The backend relies on SQLAlchemy (ORM) and SQLite for persistence.

## 1. Core Users & Relationships

> [!NOTE]
> The platform supports multi-role users (students, teachers, parents) with built-in relational mapping.

### `User` (`users`)
The primary identity model for the platform.
* `id` (PK)
* `name`, `email` (Unique), `hashed_password`
* `role`: String ('student', 'teacher', 'parent')
* `is_deleted`, `deleted_at`: Soft-delete mechanism.
* `school_id` (FK): Links to `schools` (Null for platform-only users).
* `persona_profile`: JSON blob storing LLM insights (learning style, tone preferences, weaknesses).

### Pivot Tables
* `parent_student`: Maps `parent_id` -> `student_id`.
* `teacher_student`: Maps `teacher_id` -> `student_id` (for platform-wide tutoring).

---

## 2. Content & E-Learning

> [!TIP]
> Lessons support multi-lingual content (English/Arabic) natively in the schema.

### `Course` (`courses`)
* `id` (PK)
* `title`, `description`, `instructor`, `term`
* `duration`, `thumbnail`

### `Lesson` (`lessons`)
* `id` (PK)
* `course_id` (FK) -> `courses`
* `title`, `description`, `video_url`, `duration`, `order`
* `content` (Legacy), `content_en` (English text), `content_ar` (Arabic text)

### Quizzes
* **`Quiz` (`quizzes`)**: `id`, `lesson_id` (FK - One-to-One).
* **`QuizQuestion` (`quiz_questions`)**: `id`, `quiz_id` (FK), `question`, `option_a`...`option_d`, `correct_answer`, `order`.

---

## 3. Student Progress & Memory

### `Enrollment` (`enrollments`)
* `id` (PK), `student_id` (FK), `course_id` (FK), `current_lesson_id` (FK)
* `progress`: Float (0-100)

### `LessonProgress` (`lesson_progress`)
* Tracks precise time spent on a lesson: `time_spent_seconds`.

### `QuizAnswer` (`quiz_answers`)
* Logs historical attempts: `id`, `student_id`, `quiz_id`, `question_id`, `answer`, `is_correct`.

### LLM Hybrid Memory
* **`TeacherNote` (`teacher_notes`)**: The core of the vector-embedded memory.
  * `student_id` (FK)
  * `note_content`, `category` (CORE_PERSONA, WEAKNESS, STRENGTH, TOPIC_SPECIFIC)
  * `weight`: Importance multiplier.
  * `embedding`: JSON array of floats for semantic search.
* **`StudentSentiment` (`student_sentiments`)**:
  * Logs translated messages, sentiment labels, and confidence scores.

### `Activity` (`activities`)
* Generic audit log: `activity_type`, `entity_type`, `entity_id`.

---

## 4. Active Learning Mode

> [!IMPORTANT]
> A newly added feature that stores persistent, multi-turn LLM tutoring states.

### `ActiveLearningSession` (`active_learning_sessions`)
* `id` (PK)
* `user_id` (FK), `lesson_id` (FK)
* `history_json`: Stores the entire chat history blob (`[{"role": "...", "content": "..."}]`).
* `is_completed`: Boolean flag indicating if the AI finished teaching the lesson.

---

## 5. School Management (Physical Infrastructure)

### `School` (`schools`)
* `id` (PK), `name`, `address`, `logo_url`

### `Grade` (`grades`)
* `id` (PK), `school_id` (FK)
* `name` (e.g., "Grade 10"), `academic_year`

### `PhysicalClassroom` (`physical_classrooms`)
* `id` (PK), `grade_id` (FK)
* `name`, `room_number`, `capacity`
* `camera_source`: ID/URL for the CCTV/Webcam feed.
* `is_exam_room`: Flag to switch Computer Vision rules.
* `exam_config_json`: Custom thresholds for rapid scanning or distraction timers.

### Classroom Roster
* **`ClassroomStudent`**: Links `student_id` to `classroom_id`.
* **`ClassroomTeacher`**: Links `teacher_id` to `classroom_id` with a `role` (homeroom/subject).
* **`ClassSchedule`**: `classroom_id`, `teacher_id`, `subject`, `day_of_week`, `period_start`, `period_end`.

---

## 6. Computer Vision & Analytics

> [!WARNING]
> This module manages intensive real-time data from OpenCV processing.

### `StudentFaceProfile` (`student_face_profiles`)
* `student_id` (FK - Unique)
* `embedding`: Base64-encoded pickled Numpy array representing facial features (ArcFace/DeepFace).
* `photo_url`

### `CVSession` (`cv_sessions`)
* Represents an active camera monitoring window.
* `id` (PK), `classroom_id` (FK), `teacher_id` (FK)
* `session_type`: 'class' vs 'exam'.
* `summary_json`: Final analytic breakdown saved when the session ends.

### `FocusEvent` (`focus_events`)
* Highly granular logs of individual student behaviors during a CVSession.
* `id` (PK), `session_id` (FK), `student_id` (FK - Nullable for Unknown Faces).
* `event_type`: 'distracted', 'recovered', 'unknown_face', 'neighbor_glance', 'rapid_scan'.
* `pitch`, `yaw`: Head pose estimations.
* `duration_sec`: Calculated length of the distraction.
