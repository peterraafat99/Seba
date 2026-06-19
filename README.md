# Seba: School Management, Online Learning & Real-time Classroom Analytics System
## Complete System Developer Guide & Architecture Specification

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
- **Connection:** An Arduino or ESP32-based RFID/NFC reader module (e.g. RC522 or PN532) connects to the host machine via a USB serial interface.
- **Protocol:** Serial connection established over COM ports (or `/dev/ttyUSB` on Linux) configured at **9600 baud rate**.
- **ESP32 Code (`esp32_nfc_code.ino`):** Scans Mifare NFC cards and outputs the UID as a clean hex string over the Serial interface.
- **Listener Daemon (`nfc_listener.py`):** Runs as a persistent background process. It polls the COM port for raw card UIDs, sanitizes the inputs, and sends structured HTTP POST requests to the backend's scan endpoint.

### 2. Enrollment & Scanning Flow
1. **Card Registration (`/api/attendance/enroll_card`):**
   - The student places a new card on the scanner.
   - The scanner reads the card's Unique Identifier (UID) (e.g. `4A:F2:88:C1`).
   - The admin maps the card UID to the student's ID inside the database.
2. **Daily Scanning (`/api/attendance/scan`):**
   - When a student taps their card in a physical classroom, the listener captures the UID.
   - The backend checks `classroom_students` to verify that the student is registered.
   - A new attendance record is logged in the `attendance_records` table, updating the classroom's active attendance roster.

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
  - **FAISS Database Lookup:** Performs a cosine similarity search against enrolled student face profiles. If a match exceeds the threshold (cosine similarity `>0.6`), the bounding box is labeled with the `student_id`. Unrecognized faces are flagged as `unknown_face`.
- **Frames 1–29 (Tracking Frames):**
  - Skips heavy face recognition.
  - **ByteTrack (Supervision):** Performs object tracking using Kalman filters. It maintains bounding box associations between consecutive frames, locking the `student_id` assigned on the anchor frame.
  - Re-anchoring occurs every 30 frames to correct track drift or identify newly arrived students.

### 2. Landmark-Ratio Head Pose Estimation
Instead of running heavy 3D gaze estimation networks, Seba estimates Pitch, Yaw, and Roll using a highly stable **2D Facial Landmark Ratio Method**:
- **Keypoints extracted:** Left eye pupil ($E_L$), right eye pupil ($E_R$), nose tip ($N$), left mouth corner ($M_L$), right mouth corner ($M_R$).
- **Calculations:**
  - **Yaw (Horizontal turn):** Distance ratio from nose tip to eyes:
    $$d_L = \|E_L - N\|_2, \quad d_R = \|E_R - N\|_2$$
    $$\text{Yaw Ratio} = \frac{d_L - d_R}{d_L + d_R + 10^{-6}}$$
    $$\text{Yaw (Degrees)} = \text{Yaw Ratio} \times 130.0$$
    A ratio close to `0.0` represents looking straight. Positive values indicate turning right; negative values indicate turning left.
  - **Pitch (Vertical tilt):** Distance ratio of the nose relative to the eye-mouth vertical baseline:
    $$\text{Eye Midpoint } (E_{\text{mid}}) = \frac{E_L + E_R}{2}, \quad \text{Mouth Midpoint } (M_{\text{mid}}) = \frac{M_L + M_R}{2}$$
    $$\text{Face Height } (H_f) = \|E_{\text{mid}} - M_{\text{mid}}\|_2$$
    $$\text{Nose Position } (P_N) = \frac{(N - E_{\text{mid}}) \cdot (M_{\text{mid}} - E_{\text{mid}})}{H_f^2}$$
    $$\text{Pitch (Degrees)} = -(P_N - 0.38) \times 130.0$$
    Neutral position is typically around `0.38`. Deviations compute the vertical pitch angle.
  - **Roll (Sideways tilt):** Angle of the inter-ocular line:
    $$dy = E_{R,y} - E_{L,y}, \quad dx = E_{R,x} - E_{L,x}$$
    $$\text{Roll (Degrees)} = \text{atan2}(dy, dx) \times \frac{180}{\pi}$$
    Aligned to range from $-90^\circ$ to $+90^\circ$ relative to upright orientation.
- **Benefit:** 100% stable, math-error free, and extremely fast, avoiding the VRAM limits of deep spatial estimators.

### 3. Focus Finite State Machine (FSM)
Each tracked student's pitch and yaw inputs are evaluated against a state machine configured by classroom settings:

| Metric | Classroom Mode (`is_exam=False`) | Exam Proctoring Mode (`is_exam=True`) |
| :--- | :--- | :--- |
| **Distraction Threshold** | Continuous pitch/yaw deviation for **>3.0 seconds**. | Continuous pitch/yaw deviation for **>2.0 seconds**. |
| **Instant Distraction** | Yaw deviation exceeds **$35^\circ$** immediately flags distraction. | Yaw deviation exceeds **$35^\circ$** immediately flags distraction. |
| **Lateral Glance** | Not recorded. | Yaw deviation toward seat-neighbors ($>22^\circ$) for **>1.5 seconds** flags a `neighbor_glance`. |
| **Rapid Scan** | Not recorded. | Direction reversals (Left-Right-Left) **>3 times in 5 seconds** flags a `rapid_scan` cheating alert. |

### 4. WebSocket Broadcasting
- Processed overlays (bounding boxes, names, yaw/pitch lines, focus indicators) are converted to structured JSON.
- The WebSocket server (`/api/cv/ws/{classroom_id}`) broadcasts this payload to active frontend clients, rendering HTML5 canvas overlays at 30 FPS.

---

## 🧠 AI Chatbot & Cognitive Engine

The online learning portal features a bilingual AI tutoring companion.

### 1. Bilingual Sentiment Analysis Flow
To adapt to Egyptian students, Seba implements a hybrid sentiment pipeline:
1. **Arabic Dialect Gatekeeper:** Automatically checks if the student's message contains Arabic characters using a regex pattern.
2. **Translation Pipeline:** If Arabic is detected, a specialized translation prompt is sent to the active LLM (Ollama/Gemini) to translate the Egyptian Arabic dialect (e.g. *مش فاهم*, *متضايق*, *حزين*) to English while preserving technical terms. If the primary LLM fails, it automatically runs a fallback gatekeeper to try the alternative backend.
3. **Deep Emotion Classification:** The translated English text is processed using a local, CPU-based HuggingFace `RoBERTa-base-go_emotions` pipeline. It classifies the text into 28 discrete emotions (e.g. `confusion`, `sadness`, `excitement`, `curiosity`).
4. **Sentiment Logs:** The detected emotion, confidence score, original message, and translated text are saved to the `student_sentiments` table alongside local Cairo timestamps.


### 2. Hybrid Retrieval-Augmented Generation (RAG) System
Seba retrieves math explanations from localized Egyptian curriculum documents using a hybrid search and re-ranking architecture:

```
                  ┌──────────────────────┐
                  │    Student Query     │
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   Vector Search (FAISS)              Lexical Search (BM25)
   - BGE-M3 / Gemini Embeds           - Tokenized Keywords
            │                                 │
            └────────────────┬────────────────┘
                             │
                             ▼
                    Course ID Filtering
                             │
                             ▼
                   Combined Candidates (10)
                             │
                             ▼
                  Cross-Encoder Reranking
               (ms-marco-MiniLM-L-6-v2 CPU)
                             │
                             ▼
                    Top 3 Reranked Chunks
                             │
                             ▼
                    LLM Prompt Injection
```

- **Ingestion:** Math textbook PDFs are parsed, segmented into semantic blocks (300-token chunks with 50-token overlap), and cleaned of artifacts.
- **Embeddings:** Chunks are vectorized using either **BGE-M3 (local)** or **Gemini Embedding API** (`models/gemini-embedding-001`).
- **Vector Storage:** Embeddings are written to a local FAISS index.
- **Lexical Storage:** Chunks are tokenized and loaded into a `BM25Okapi` index.
- **Query Pipeline:**
  1. **Dual Retrieval:** The system embeds the query and retrieves the top 10 candidates from FAISS (semantic) and the top 10 candidates from BM25 (lexical).
  2. **In-Context Course Filtering:** Filter candidate chunks based on active course IDs (e.g., mapping generic course ID 1 to Term 1 Course ID 6 or Term 2 Course ID 7) to enforce logical scoping.
  3. **Cross-Encoder Re-ranking:** Combined candidate chunks are scored via a CPU-based local `cross-encoder/ms-marco-MiniLM-L-6-v2` model.
  4. **Scope Management & Disclaimer Router:**
     - **In-Scope:** If retrieval matches the current lesson title, the tutor focuses strictly on this content.
     - **Out-of-Scope (Reference Curriculum):** If the topic is found in the curriculum but outside the current lesson, the response is generated but prefixed with:
       `⚠️ Note: This topic is covered in [Lesson Name], not in our current lesson ([Current Lesson]). Here's what you need to know:`
       and cites the source lesson clearly as `[Term X LesY]`.
     - **Completely Unknown:** If not in current lesson or reference materials, the chatbot declines politely and redirects the student to the current lesson content.

### 3. Active Learning & Math OCR
- **Active Learning:** A guided dialogue mode. The chatbot poses a math problem and walks the student through step-by-step solutions, loading/saving conversation memory using `active_learning_sessions` history logs.
- **Multimodal OCR:** The student can upload a photo of a handwritten math problem. The image is parsed via OCR, converted to LaTeX markdown, and explained by the tutor.
- **Voice Pipeline:**
  - **Speech-to-Text (STT):** Transcribes audio bytes utilizing Groq Cloud's `whisper-large-v3` API (zero local VRAM, free tier).
  - **Text-to-Speech (TTS):** Local pyttsx3 synthesis engine. Selecting Arabic voices if language is `ar` (searching system voices containing "arabic" or "ar") and writing output to WAV bytes for frontend playback.

### 4. Mood-Adaptive Quiz Engine
When a student requests a quiz (Egyptian Arabic trigger words like *اختبرني*, *كويز*, or English *quiz me*):
1. **Trigger Phrase Parsing:** Recognizes intent from explicit phrases or standalone nouns combined with politeness markers.
2. **Sentiment Check:** The engine checks the student's last 5 sentiment entries in the `student_sentiments` table.
3. **Adaptation Strategy:**
   - If any recent entries show high anxiety, sadness, or confusion (e.g. `sadness`, `confusion`, `fear`, `nervousness`), the quiz engine adapts:
     - Sets the quiz difficulty to `EASY` to build confidence.
     - Adjusts the tone of the quiz title (e.g. *"Confidence Booster Assessment"*) and tutor feedback to be highly supportive.
   - If the student has been positive and focused, the difficulty scales up to `MEDIUM` or `HARD`.
4. **Spaced Repetition:** Generates 5 questions: Questions 1, 2, 4, and 5 cover the current lesson. Question 3 is seeded as a review question from previous lessons (looking back up to 3 past lessons).
5. **Database Persistence:** Saves the generated quiz to the `quizzes` and `quiz_questions` tables for structured grading.

---

## 👩‍🏫 Automated Psychologist Insights & Teacher Notes

Seba implements a background cognitive memory pipeline that automatically extracts, merges, and recalls pedagogical observations:

### 1. AI Extraction Flow
- At the end of chat sessions, a background thread runs `extract_learning_insight` in `nlp_engine.py`.
- It prompts the LLM to analyze the student's messages for specific learning indicators:
  - Specific **misconceptions** (e.g. "Confused by fractions").
  - Specific **prerequisite knowledge gaps** (e.g. "Struggles with division").
  - Specific **strengths or interests** (e.g. "Excels at geometry").
- The pipeline produces a concise **6-word maximum note**.

### 2. Semantic Duplicate Merging & Weighting
- The system embeds the extracted note content using BGE-M3 or Gemini.
- It compares this embedding to the student's existing notes in the `teacher_notes` table.
- **Merging Threshold:** If the cosine similarity between the new note and an existing note exceeds **`0.85`**:
  - The new duplicate note is discarded.
  - The existing note's **`weight`** is incremented by **`0.5`** to highlight this recurring learning pattern.
- If no duplicate is found, the note is saved as a new entry with an initial weight (typically `1.5`).

### 3. Dynamic Memory Recall (In-Context)
- When a student initiates a chat, the chatbot embeds the user's message.
- It computes the cosine similarity between the query embedding and all of the student's stored notes:
  $$\text{Score} = \text{Similarity}(V_{\text{query}}, V_{\text{note}}) \times \text{Weight}_{\text{note}}$$
- Notes are sorted by Score, and the **top 3 notes** are injected as `SITUATIONAL MEMORIES` in the system prompt.
- This allows Seba to dynamically tailor its pedagogy to the student's persistent misconceptions or strengths.

---

## 🗄️ Database Tables Guide

The relational SQLite database manages the following 26 tables:

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
| **`attendance_records`** | `id` | `student_id`, `classroom_id` | `scanned_uid`, `created_at` | NFC-triggered attendance logs |
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
