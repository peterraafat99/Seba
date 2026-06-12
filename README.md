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
        ┌────────────────────────────────┐
        │     Face Detector Backend      │
        │  (Configured in config.py)     │
        └──────────────┬─────────────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
     [RetinaFace DEFAULT]   [YOLOv11 OPTIONAL] (yolov11n-face.pt)
     (InsightFace det_10g)       │
             │                   │
             ▼                   ▼
       ┌───────────────────────────────┐
       │   InsightFace Recognition     │  (Anchor Frames only)
       │  (ArcFace w600k_r50 Vector)   │ ──► Matches 512-dim FAISS index
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │ Supervision ByteTrack Tracker │ ──► Maintains locked Student ID
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │      Head Pose Estimator      │ ──► 2D Landmark Ratios (Stable)
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │   Focus State Machine (FSM)   │ ──► Focus/Distraction/Cheating Signals
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │     WebSocket Broadcaster     │ ──► Live React Canvas Overlay
       └───────────────────────────────┘
```

### Core Components
* **Face Profile Enrollment:** Generates 512-dimensional ArcFace embeddings from student photos and stores them as base64-encoded strings in the SQLite database.
* **Supervision ByteTrack Tracker:** Maps active bounding boxes dynamically to prevent ID switching or recognition lag on intermediate frames.
* **Head Pose Estimator:** Replaced heavy gaze networks with an optimized **2D Landmark Ratio Method** mapping distances between 5 keypoints (eyes, nose, mouth corners) to approximate Pitch, Yaw, and Roll. This provides 100% stable, jitter-free results without 180° rotation flips or mathematical ambiguities.
* **Focus Finite State Machine (FSM):**
  * **Classroom Mode:** Calculates continuous distraction. If a student is distracted (pitch/yaw out of bounds) for **>10 seconds**, a `distracted` event is logged and streamed.
  * **Exam Proctoring Mode:** Activates stricter rules:
    * **Distraction Timer:** Reduced to **2 seconds**.
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

## 📥 Detailed Model Download & Directory Guide

To run the offline models, your team must download the weights files manually and place them in the correct directories:

### 1. BGE-M3 Local Embeddings (For Offline RAG)
* **Source Repository:** Hugging Face [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)
* **Target Folder:** `backend/bge_m3_local/`
* **Files to Download:**
  Go to [BAAI/bge-m3 Files and Versions](https://huggingface.co/BAAI/bge-m3/tree/main) and download these files directly:
  1. `pytorch_model.bin` (~2.27 GB)
  2. `sentencepiece.bpe.model`
  3. `tokenizer.json`
  4. `config.json`
  5. `config_sentence_transformers.json`
  6. `modules.json`
  7. `sentence_bert_config.json`
  8. `special_tokens_map.json`
  9. `tokenizer_config.json`
  10. The folder `1_Pooling/` (which contains `config.json` inside it).

### 2. InsightFace Models (Face Detection & Recognition)
By default, InsightFace downloads these models automatically at first run. If your team is offline or behind a firewalled network, they must download them manually:
* **Source Repository:** GitHub [DeepInsight Releases](https://github.com/deepinsight/insightface/releases)
* **Target Folder:** `C:\Users\<Your-PC-Username>\.insightface\models\buffalo_l\`
* **Files to Download:**
  Download the model bundle: [buffalo_l.zip](https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip)
  Extract the contents of the zip directly into the target folder so it contains:
  1. `det_10g.onnx` (RetinaFace Detector)
  2. `w600k_r50.onnx` (ArcFace Recognizer)
  3. `1k3d68.onnx`
  4. `2d106det.onnx`
  5. `genderage.onnx`

### 3. YOLOv11 Face Weights (Optional Backend)
* **Source Repository:** GitHub [akanametov/yolo-face](https://github.com/akanametov/yolo-face/releases)
* **Target Folder:** `backend/`
* **File to Download:** `yolov11n-face.pt` (or any compatible ONNX conversion like `yolov8n-face.onnx` placed in the backend directory).

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
