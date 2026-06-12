# Seba: School Management & Real-time Classroom Analytics System

Seba is a comprehensive, modern **School Management System** designed for the Egyptian National Curriculum. The Online Learning Platform is one subsystem of this ecosystem, which integrates administrative tools, student engagement portals, and a state-of-the-art **Computer Vision (CV) Real-time Proctoring and Focus Analytics engine**.

---

## 🏛️ System Roles & Dashboard Hierarchies

Seba is built on a strict role-based access control (RBAC) model. The system provides custom dashboards tailored to each stakeholder in the educational lifecycle:

### 1. 👑 Super Admin (Platform Owner)
* Platform-wide dashboard to manage multiple schools, subscriptions, and system health.
* Oversees school creation, platform licensing, and global database migrations.

### 2. 🏫 School Manager (School Principal / Admin)
* **School & Grade Management:** Creates grades (e.g., "Grade 8"), schedules academic years, and defines physical classrooms.
* **Classroom Setup:** Configures camera sources (RTSP stream URLs or USB webcam indices) for physical classrooms.
* **Roster Management:** Registers students, links them to classrooms, and manages teacher assignments.
* **Timetable Scheduler:** Creates the physical class schedules (days, periods, start/end times, and subjects).
* **Face Enrollment Auditor:** Reviews student face profiles enrolled via the system.

### 3. 👩‍🏫 Teacher (Classroom & Lesson Auditor)
* **Real-time Session Controls:** Starts/stops CV monitoring sessions for a classroom.
* **Live Analytics Visualizer:** Monitors live student engagement rates and focus overlays via WebSockets.
* **Behavior & Proctoring Reports:** Receives alerts for distracted states, cheating signals (during exam sessions), and unknown faces in the room.
* **Student Analytics:** Evaluates student profile trends, platform progress, chatbot query sentiments, and custom learning notes.
* **Manual Feedback:** Adds pedagogical comments or custom notes on student profiles.

### 4. 🎓 Student (Online Learning & Tutoring Portal)
* **Lesson Player:** Accesses bilingual lessons (Arabic/English) with course progress tracking.
* **Seba AI Study Assistant:** Interactive chatbot tutoring right inside the lessons.
* **Personalized Quizzes:** Takes math quizzes auto-generated to match their unique learning speed and weakness areas.
* **Voice & Vision:** Ask questions via microphone (STT) or uploads pictures of handwritten math problems.

### 5. 👪 Parent (Engagement Auditor)
* Monitors student platform completion rates and quiz scores.
* Reviews real-time physical classroom engagement charts (average focus rate, historical distraction events).

---

## 📹 The Computer Vision (CV) Monitoring Suite

Seba monitors physical classrooms through a real-time video processing pipeline built on top of modern deep learning frameworks:

```
[Camera Stream] 
       │
       ▼
[YOLOv8/11 Face Detector] ──► [InsightFace Recognition] ──► Matches 512-dim ArcFace Vectors
       │
       ▼
[ByteTrack Multi-Object Tracker] ──► Mapped to Student ID
       │
       ▼
[MediaPipe Face Mesh] ──► OpenCV solvePnP ──► Calculates Pitch, Yaw, Roll
       │
       ▼
[Focus State Machine (FSM)] ──► Emits Focus/Distraction/Cheating Signals
       │
       ▼
[WebSocket Broadcaster] ──► Live React Canvas Overlay
```

### Core Components
* **Face Profile Enrollment:** Generates 512-dimensional ArcFace embeddings from student photos and stores them as base64-encoded strings in the SQLite database.
* **Supervision ByteTrack Tracker:** Maps active bounding boxes dynamically to prevent ID switching or recognition lag on intermediate frames.
* **Head Pose Estimator:** MediaPipe Face Mesh tracks key 3D facial landmarks. An OpenCV `solvePnP` solver computes the Euler angles (**Pitch, Yaw, Roll**) in degrees:
  * **Pitch < -20°:** Looking down (likely at a phone, desk, or cheating sheet).
  * **Yaw > 25° or < -25°:** Head turned lateral (looking away from board/screen).
* **Focus Finite State Machine (FSM):**
  * **Classroom Mode:** Calculates continuous distraction. If a student is distracted (pitch/yaw out of bounds) for **>10 seconds**, a `distracted` event is logged and streamed.
  * **Exam Proctoring Mode:** Activates stricter rules:
    * **Distraction Timer:** Reduced to **3 seconds**.
    * **Neighbor Glance:** Triggers a `neighbor_glance` flag if the student looks laterally toward an adjacent desk for more than a brief second.
    * **Rapid Scan:** Tracks direction reversals. If a student shifts head direction (Left-Right-Left) **>3 times inside a 5-second window**, a `rapid_scan` cheating flag is logged.

---

## ⚙️ Model Toggling: Local Offline vs. Cloud API

Seba is designed to work in hardware-constrained environments (e.g., 16 GB RAM laptops). You can switch between a **100% offline local setup** and a **zero-local-RAM cloud setup** simply by toggling environment variables.

### 🔌 How to Switch Backends in `.env`

Open [`backend/.env`](file:///d:/grad%203/Seba%20AI%20tutor/Seba%20AI%20tutor/backend/.env) to configure your preference:

#### Option A: 100% Local Offline Mode (GPU + CPU)
* **LLM Engine:** Local Qwen 3.5 9B running on your GPU via Ollama.
* **Embeddings & Reranker:** BGE-M3 and Cross-Encoder running locally on your CPU.
* **Pros:** 100% private, free, works without internet.
* **Cons:** High CPU/GPU load. Requires model downloads.
* **Configuration:**
  ```env
  LLM_BACKEND=ollama
  OLLAMA_MODEL=qwen3.5:9b
  OLLAMA_HOST=http://localhost:11434
  EMBEDDING_BACKEND=local
  EMBEDDING_MODEL=./bge_m3_local
  CACHE_LOCAL_MODELS=false
  ```

#### Option B: Cloud API Mode (0 MB Local RAM / VRAM)
* **LLM Engine:** Gemini 2.5 Flash API on Google Cloud.
* **Embeddings:** Gemini Embedding API (`models/gemini-embedding-001`).
* **Pros:** Instant response, zero load on your CPU/GPU, leaves 100% of RAM free for other applications.
* **Cons:** Requires internet access and API keys.
* **Configuration:**
  ```env
  LLM_BACKEND=gemini
  CLOUD_MODEL=gemini-2.5-flash
  EMBEDDING_BACKEND=gemini
  GEMINI_API_KEY=your_google_ai_studio_api_key
  ```

---

## 🧠 Local Memory Optimization Scheme (For 16GB Laptops)

When running **Option A (Local Offline)** on 16GB laptops, system memory bottlenecks can cause Ollama to crash when loading a 9B model. We solved this with a **sequential lifecycle cleanup scheme** inside [chatbot.py](file:///d:/grad%203/Seba%20AI%20tutor/Seba%20AI%20tutor/backend/chatbot.py):

1. **Step-by-Step Execution:** We do not run the RAG search, emotion classification, and LLM calls in parallel. 
2. **Device Isolation:** Local BGE-M3 and emotion classifiers are forced onto `device="cpu"` to keep your GPU VRAM 100% free for Ollama.
3. **RAM Eviction (`unload_local_models`):** 
   Right before the backend sends the prompt to Ollama, it frees the references to local BGE-M3, the CrossEncoder, and the emotion pipeline, and calls `gc.collect()` and `torch.cuda.empty_cache()`. 
   This releases **3+ GB of system RAM**, giving Ollama the contiguous memory space it needs to launch the 9B model on the GPU.
4. **Caching Switch (`CACHE_LOCAL_MODELS`):**
   * If you have a **32 GB RAM laptop** (like your friend's), set `CACHE_LOCAL_MODELS=true`. The system will skip unloading, keeping all models in RAM for instant, lag-free consecutive responses.
   * If you have a **16 GB RAM laptop**, keep `CACHE_LOCAL_MODELS=false` to protect your system from allocation crashes.

---

## 🚀 Installation & Running

### 1. Backend Setup & Ingestion
1. Navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Install Python packages:
   ```bash
   pip install -r requirements.txt
   ```
3. Place your math curriculum PDFs in `backend/curriculum_pdfs/Math/term_1/` and `term_2/`.
4. Ingest and extract text from the PDFs:
   ```bash
   python ingest_pdfs.py
   ```
5. Build the vector database index (this script automatically creates `course_index.faiss` or `course_index_gemini.faiss` depending on your `.env` setting):
   ```bash
   $env:PYTHONIOENCODING="utf-8"; python build_rag.py
   ```
6. Populate the platform database tables with initial course schedules, sample users, and lessons:
   ```bash
   python init_db.py
   ```
7. Launch the FastAPI server:
   ```bash
   python main.py
   ```

### 2. Frontend Setup
1. Navigate to the frontend folder:
   ```bash
   cd ../frontend
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Start the React/Vite development server:
   ```bash
   npm run dev
   ```
4. Access the portal in your browser at `http://localhost:5173`.
