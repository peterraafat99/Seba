# Seba: School Management, Online Learning & Real-time Classroom Analytics System
## Complete System Guide & Developer Architecture Specification

Seba is a modern, bilingual (Arabic/English) **School Management System & Online Learning Platform** tailored to the Egyptian National Curriculum. It integrates virtual learning modules with an advanced **Computer Vision (CV) Real-time Focus & Proctoring Suite**, a hardware **NFC Attendance Subsystem**, and a **Cognitive AI Chatbot & RAG Engine**.

---

## 🏛️ Comprehensive System Architecture

```
                               ┌────────────────────────────────┐
                               │         React Frontend         │
                               │   (TypeScript + TailwindCSS)   │
                               └──────────────┬─────────────────┘
                                              │
                      REST API / JSON         │   WebSockets
                      (JWT Authentication)    │   (Real-time Canvas Overlays)
                                              ▼
                               ┌────────────────────────────────┐
                               │       FastAPI Web Server       │
                               │   (main.py / Database RBAC)    │
                               └──────┬───────┬──────────┬──────┘
                                      │       │          │
                 ┌────────────────────┘       │          └────────────────────┐
                 ▼                            ▼                               ▼
  ┌─────────────────────────────┐  ┌────────────────────┐  ┌─────────────────────────────┐
  │   Computer Vision Engine    │  │ SQLite Database    │  │   AI Chatbot/RAG Engine     │
  │ (RetinaFace, ArcFace, FSM)  │  │ (learning_plat.db) │  │  (Ollama/Qwen OR Gemini)    │
  └──────────────┬──────────────┘  └────────────────────┘  └──────────────┬──────────────┘
                 │                                                        │
                 ▼                                                        ▼
     [Camera RTSP/Webcam Feed]                               [Egypt Curriculum PDFs]
```

---

## 👥 Roles & Access Controls (RBAC)

Seba implements role-based access controls to partition dashboards and capabilities:
1. **👑 Super Admin:** Platform-wide auditor. Manages schools, platform billing, subscriptions, and global database schema migrations.
2. **🏫 School Manager:** Local school administrator. Creates academic years, grades (e.g. "Grade 10"), physical classrooms, registers students and teachers, schedules the weekly timetables, and seeds face recognition databases.
3. **👩‍🏫 Teacher:** Classroom auditor. Controls physical monitoring cameras, starts/stops CV sessions, monitors real-time student focus, receives cheating flags, evaluates psychologist reports, and writes student progress notes.
4. **🎓 Student:** Online learner. Views lessons, talks to the Seba AI tutor, asks voice questions, uploads handwritten problem photos, and takes adaptive quizzes.
5. **👪 Parent:** Family auditor. Tracks their child's curriculum progress, grades, average physical classroom attendance, and focus rates.

---

## 💳 Hardware & NFC Attendance Subsystem

The attendance subsystem bridges physical RFID/NFC hardware with student profiles in the database:

### 1. Hardware Interface (`nfc_bridge.py` & `nfc_listener.py`)
- **Connection:** An Arduino or dedicated RFID/NFC reader module (e.g. RC522 or PN532) connects to the host machine via a USB serial interface.
- **Protocol:** Serial connection established over COM ports (or `/dev/ttyUSB` on Linux) configured at **9600 baud rate**.
- **Listener Daemon:** `nfc_listener.py` runs as a persistent background process. It polls the COM port for raw card UIDs, sanitizes the inputs, and sends structured requests to the attendance endpoint.

### 2. Enrollment & Scanning Flow
1. **Card Registration (`/api/attendance/enroll_card`):**
   - The student places a new card on the scanner.
   - The scanner reads the card's Unique Identifier (UID) (e.g. `4A:F2:88:C1`).
   - The admin maps the card UID to the student's ID inside the database.
2. **Daily Scanning (`/api/attendance/scan`):**
   - When a student taps their card in a physical classroom, the listener captures the UID.
   - The backend checks `classroom_students` to verify that the student is registered.
   - A new attendance record is logged, updating the classroom's active attendance roster.

---

## 📹 The Computer Vision Processing Pipeline

The real-time computer vision subsystem monitors physical classrooms to track student presence, focus rates, and exam integrity.

```
       [Camera Frame] ──► Face Detection (RetinaFace) ──► Is Anchor Frame?
                                                               │
                                         ┌─────────────────────┴─────────────────────┐
                                         │ YES                                       │ NO
                                         ▼                                           ▼
                            Face Recognition (ArcFace)                   ByteTrack Object Tracker
                                         │                                           │
                                         ▼                                           ▼
                            Match Enrolled Embeddings                     Maintain Track IDs
                                         │                                           │
                                         └─────────────────────┬─────────────────────┘
                                                               │
                                                               ▼
                                                    2D Landmark Head Pose
                                                               │
                                                               ▼
                                                     Focus State Machine
                                                               │
                                                               ▼
                                                    Broadcast WebSockets
```

### 1. Frame Processing Loop (Anchor vs. Tracking Frames)
To optimize CPU/GPU cycles on host machines, the CV pipeline processes frames in a **30-frame sequence window**:
- **Frame 0 (Anchor Frame):**
  - **RetinaFace Detection:** Locates all facial bounding boxes and landmarks.
  - **ArcFace Recognition:** Extracts 512-dimensional vector embeddings for each face.
  - **FAISS Database Lookup:** Performs a cosine similarity search against enrolled student face profiles. If a match exceeds the threshold (e.g. `>0.6` similarity), the bounding box is labeled with the `student_id`. Unrecognized faces are flagged as `unknown_face`.
- **Frames 1–29 (Tracking Frames):**
  - Skip heavy face recognition.
  - **ByteTrack (Supervision):** Performs object tracking using Kalman filters. It maintains bounding box associations between consecutive frames, locking the `student_id` assigned on the anchor frame.
  - Re-anchoring occurs every 30 frames to correct track drift or identify newly arrived students.

### 2. Landmark-Ratio Head Pose Estimation
Instead of running heavy 3D gaze estimation networks, Seba estimates Pitch, Yaw, and Roll using a highly stable **2D Facial Landmark Ratio Method**:
- **Keypoints extracted:** Left eye pupil ($E_L$), right eye pupil ($E_R$), nose tip ($N$), left mouth corner ($M_L$), right mouth corner ($M_R$).
- **Calculations:**
  - **Yaw (Horizontal turn):** Distance ratio from nose tip to eyes:
    $$\text{Yaw Ratio} = \frac{N_x - E_{L,x}}{E_{R,x} - E_{L,x}}$$
    A ratio close to `0.5` represents looking straight. Significant deviations indicate looking left or right.
  - **Pitch (Vertical tilt):** Distance ratio from nose tip to eye midpoint:
    $$\text{Pitch Ratio} = \frac{N_y - \frac{E_{L,y} + E_{R,y}}{2}}{\text{Face Height}}$$
    Values out of standard bounds represent looking up or down.
- **Benefit:** 100% stable, math-error free, and extremely fast, avoiding the VRAM limits of deep spatial estimators.

### 3. Focus Finite State Machine (FSM)
Each tracked student's pitch and yaw inputs are evaluated against a state machine configured by classroom settings:

| Metric | Classroom Mode | Exam Proctoring Mode |
| :--- | :--- | :--- |
| **Distraction Threshold** | Continuous pitch/yaw deviation for **>10 seconds**. | Continuous pitch/yaw deviation for **>2 seconds**. |
| **Lateral Glance** | Not recorded. | Yaw ratio shifts toward neighbors for **>1.5 seconds** flags a `neighbor_glance`. |
| **Rapid Scan** | Not recorded. | Direction reversals (Left-Right-Left) **>3 times in 5 seconds** flags a `rapid_scan` cheating alert. |

### 4. WebSocket Broadcasting
- Processed overlays (bounding boxes, names, yaw/pitch lines, focus indicators) are converted to structured JSON.
- The WebSocket server (`/api/cv/ws/{classroom_id}`) broadcasts this payload to active frontend clients, rendering HTML5 canvas overlays at 30 FPS.

---

## 🧠 AI Chatbot & Cognitive Engine

The online learning portal features a bilingual AI tutoring companion.

### 1. Bilingual Sentiment Analysis Flow
To adapt to Egyptian students, Seba implements a hybrid sentiment pipeline:
1. **Egyptian Arabic Sentiment:** Uses a local lookup lexicon (`EgySenti`) to detect local dialects (e.g. *مش فاهم*, *متضايق*, *حزين*).
2. **Translation Pipeline:** If the text contains Arabic, it is translated to English using a translation API or local PyTorch translators.
3. **Deep Emotion Classification:** The English text is sent to a HuggingFace `RoBERTa-base-go_emotions` pipeline. It parses the text into 28 discrete emotions (e.g. `confusion`, `sadness`, `excitement`, `curiosity`).
4. **Sentiment Logs:** Labels are saved to the `student_sentiments` table alongside the Cairo local timestamp.

### 2. Retrieval-Augmented Generation (RAG) System
Seba retrieves math explanations from localized Egyptian curriculum documents:
- **Ingestion:** Math textbook PDFs are parsed, segmented into semantic blocks (300-token chunks with 50-token overlap), and cleaned of artifacts.
- **Embeddings:** Chunks are vectorized using either **BGE-M3 (local)** or **Gemini Embedding API** (`models/gemini-embedding-001`).
- **Vector Storage:** Embeddings are written to a local FAISS index.
- **Query Pipeline:**
  1. Student asks a question.
  2. The system embeds the query and performs a FAISS cosine similarity search.
  3. Retrieval results are re-ranked using a Cross-Encoder to select the top 3 most relevant curriculum matches.
  4. Selected texts are injected into the LLM system prompt to generate accurate, localized responses.

### 3. Active Learning & Math OCR
- **Active Learning:** A guided dialogue mode. The chatbot poses a math problem and walks the student through step-by-step solutions, loading/saving conversation memory using `active_learning_sessions` history logs.
- **Multimodal OCR:** The student can upload a photo of a handwritten math problem. The image is parsed via OCR, converted to LaTeX markdown, and explained by the tutor.
- **Voice Pipeline:** Student speech is transcribed using STT (Speech-to-Text) models, processed by the RAG model, and read back using TTS (Text-to-Speech).

### 4. Mood-Adaptive Quiz Engine
When a student requests a quiz ( egip. Arabic trigger words like *اختبرني*, *كويز*, or English *quiz me*):
1. The engine checks the student's last 5 sentiment entries in the `student_sentiments` table.
2. If any recent entries show high anxiety, sadness, or confusion (e.g., `sadness`, `confusion`, `fear`, `nervousness`), the quiz engine adapts:
   - Sets the quiz difficulty to `EASY` to build confidence.
   - Adjusts the tone of the quiz title (e.g., *"Confidence Booster Assessment"*) and the tutor's feedback to be highly supportive.
3. If the student has been positive and focused, the difficulty scales up to `MEDIUM` or `HARD`.

---

## 🗄️ Database Tables Guide

The relational SQLite database manages the following tables:

| Table Name | Primary Key | Foreign Keys | Key Columns | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **`users`** | `id` | None | `name`, `email`, `role`, `school_id`, `is_deleted` | User management and profiles |
| **`schools`** | `id` | None | `name`, `address`, `logo_url` | School profiles |
| **`grades`** | `id` | `school_id` | `name`, `academic_year` | Academic tiers |
| **`physical_classrooms`** | `id` | `grade_id` | `name`, `room_number`, `camera_source`, `is_exam_room` | Monitored school rooms |
| **`classroom_students`** | `id` | `classroom_id`, `student_id` | `joined_at`, `is_active` | Roster mapping students to physical rooms |
| **`classroom_teachers`** | `id` | `classroom_id`, `teacher_id` | `role`, `subject` | Roster mapping teachers to physical rooms |
| **`class_schedule`** | `id` | `classroom_id`, `teacher_id` | `subject`, `day_of_week`, `period_start`, `period_end` | Physical weekly timetables |
| **`student_face_profiles`** | `id` | `student_id` | `embedding` (base64 pickling), `photo_url` | Face verification representations |
| **`cv_sessions`** | `id` | `classroom_id`, `started_by` | `session_type`, `started_at`, `ended_at`, `summary_json` | Camera session tracking |
| **`focus_events`** | `id` | `session_id`, `student_id` | `event_type`, `pitch`, `yaw`, `duration_sec` | Distraction and cheating logs |
| **`courses`** | `id` | None | `title`, `description`, `subject`, `grade_level` | Educational course catalogs |
| **`lessons`** | `id` | `course_id` | `title`, `content_en`, `content_ar` | Bilingual textbook lessons |
| **`enrollments`** | `id` | `student_id`, `course_id` | `progress` | Online course enrollment rates |
| **`lesson_progress`** | `id` | `user_id`, `lesson_id` | `time_spent_seconds`, `completed` | Time spent per student per lesson |
| **`quizzes`** | `id` | `lesson_id`, `student_id` | `quiz_type`, `title`, `difficulty` | MC Quizzes (Generated or Platform) |
| **`quiz_questions`** | `id` | `quiz_id` | `question`, `option_a`, `option_b`, `correct_answer` | MC Quiz questions |
| **`quiz_answers`** | `id` | `student_id`, `quiz_id` | `question_id`, `answer`, `is_correct` | Answer choices selected by students |
| **`quiz_submissions`** | `id` | `student_id`, `quiz_id` | `score`, `correct_answers`, `total_questions` | Structured quiz grades and scores |
| **`activities`** | `id` | `user_id` | `activity_type`, `entity_type`, `description` | Activity log events |
| **`student_sentiments`** | `id` | `student_id` | `sentiment_label`, `confidence_score`, `created_at` | Sentiment log history |
| **`teacher_notes`** | `id` | `student_id` | `teacher_id`, `content`, `created_at` | Teacher comments on students |
| **`classwork`** | `id` | `course_id` | `title`, `classwork_type`, `resource_url`, `max_grade` | Assignments and homework uploads |
| **`classwork_submissions`** | `id` | `classwork_id`, `student_id` | `completed`, `submission_file_url`, `grade` | Student homework file submissions |
| **`active_learning_sessions`** | `id` | `user_id`, `lesson_id` | `history_json`, `is_completed` | Dialog session state logs |
| **`classroom_messages`** | `id` | `classroom_id`, `sender_id` | `student_id`, `message`, `created_at` | Classroom message feeds |

---

## 🧠 VRAM & Memory Management for 16GB RAM Laptops

Running LLM inference locally can easily exhaust systems with 16GB RAM. Seba handles this using a **sequential lifecycle memory clearing system**:
- **Isolated Execution Device:** Heavy embeddings models (BGE-M3) and the emotion parser are restricted to run on the **CPU**, keeping the GPU dedicated to Ollama (running Qwen 9B).
- **RAM Eviction (`unload_local_models`):** Right before prompting Ollama:
  - References to CPU models are deleted.
  - Python's Garbage Collector (`gc.collect()`) is called.
  - CUDA cache is cleared (`torch.cuda.empty_cache()`).
  - This frees **3+ GB of system memory**, allowing Ollama to boot and compile responses without allocation crashes.
- **Caching (`CACHE_LOCAL_MODELS`):**
  - Set to `true` on 32GB RAM machines (keeps models in memory to avoid reload latency).
  - Set to `false` on 16GB RAM machines (performs the eviction cleanup cycle on every prompt).

---

## 🔧 Model Installation & Folders

### 1. BGE-M3 Local Embeddings
- **Folder:** `backend/bge_m3_local/`
- **Link:** [Hugging Face BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3/tree/main)
- **Required files:** `pytorch_model.bin` (~2.27 GB), `tokenizer.json`, `config.json`, and all surrounding configuration binaries.

### 2. InsightFace Models
- **Folder:** `C:\Users\<Username>\.insightface\models\buffalo_l\`
- **Link:** [buffalo_l.zip](https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip)
- **Required files:** Extract zip directly into target folder (`det_10g.onnx`, `w600k_r50.onnx`, etc.).

---

## 🚀 Setup & Execution

### 1. Backend Ingestion & Run
1. Install Python packages:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
2. Place curriculum PDFs in `backend/curriculum_pdfs/Math/term_1/`.
3. Ingest documents:
   ```bash
   python ingest_pdfs.py
   ```
4. Build RAG indexes:
   ```bash
   python build_rag.py
   ```
5. Initialize the database and tables:
   ```bash
   python init_db.py
   ```
6. Run the FastAPI development server:
   ```bash
   python main.py
   ```

### 2. Frontend Development Server
1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```
2. Install Node modules:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to `http://localhost:5173`.
