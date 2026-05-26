<div align="center">

# 🎓 Seba — AI-Powered Tutoring Platform

**An intelligent, bilingual (English/Arabic) learning platform with an AI study assistant, personalized quizzes, and real-time student analytics.**

[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6.4-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## 📖 Overview

**Seba** is a full-stack AI tutoring platform designed for the Egyptian National Curriculum (Math — Grade 8). It combines a modern React frontend with a FastAPI backend powered by Google Gemini, RAG (Retrieval-Augmented Generation), NLP-based sentiment analysis, and FAISS vector search to deliver a personalized and emotionally-aware learning experience.

### ✨ Key Highlights

- 🤖 **AI Study Assistant ("Seba")** — Gemini-powered chatbot with curriculum-grounded responses via RAG
- 🧠 **Emotion-Aware Pedagogy** — Real-time sentiment analysis adapts teaching tone (frustrated → patient, confused → analogies)
- 📝 **Personalized Quizzes** — AI-generated quizzes tailored to each student's progress and weak areas
- 🌍 **Bilingual (EN/AR)** — Full RTL Arabic support with Egyptian Arabic (Masri) chatbot responses
- 📊 **Analytics Dashboard** — Performance tracking, attendance heatmaps, and grade trends for parents & teachers
- 🛡️ **Role-Based Access** — Student, Parent, Teacher, and Admin roles with scoped permissions
- 📚 **PDF Curriculum Ingestion** — Automatic vectorization of curriculum PDFs into the knowledge base
- 🎨 **Dark/Light Theme** — Smooth theme transitions with accessible color contrasts

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)           │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────┐ │
│  │Dashboard │ │ Lessons  │ │ Insights  │ │ Admin │ │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └───┬───┘ │
│       └─────────────┴─────────────┴───────────┘     │
│                         │ Axios                      │
└─────────────────────────┼───────────────────────────┘
                          │ REST API
┌─────────────────────────┼───────────────────────────┐
│                    Backend (FastAPI)                  │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────┐  │
│  │ Auth &   │ │  Chatbot   │ │  Quiz Engine      │  │
│  │ Sessions │ │ (Gemini)   │ │ (AI-Generated)    │  │
│  └──────────┘ └──────┬─────┘ └───────────────────┘  │
│                      │                               │
│  ┌──────────┐ ┌──────┴─────┐ ┌───────────────────┐  │
│  │ NLP      │ │ RAG /      │ │ Admin Panel       │  │
│  │ Engine   │ │ VectorStore│ │ (CRUD)            │  │
│  └──────────┘ └──────┬─────┘ └───────────────────┘  │
│                      │                               │
│  ┌───────────────────┴───────────────────────────┐  │
│  │             SQLite + FAISS Index              │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Features

### For Students
| Feature | Description |
|---------|-------------|
| 📚 Course Browser | Browse and enroll in curriculum-aligned courses |
| 🎬 Video Lessons | Embedded video player with progress tracking |
| 🤖 AI Chat | Ask "Seba" questions — get curriculum-grounded answers with LaTeX math rendering |
| 🧩 Smart Quizzes | AI-generated quizzes personalized to your weak areas |
| 🌙 Dark Mode | Eye-friendly dark theme with smooth toggle |
| 🌐 Arabic Support | Full RTL layout with Egyptian Arabic chatbot responses |

### For Parents & Teachers
| Feature | Description |
|---------|-------------|
| 📊 Student Analytics | Performance trends, grade breakdowns, and time-spent reports |
| 📅 Attendance Heatmap | Visual 30-day activity tracker |
| 💬 Teacher Notes | Automatic AI-generated learning insights per student |
| 😊 Sentiment Tracking | Monitors student emotional state during chat sessions |
| 📝 Comments | Add notes and observations per student |

### For Admins
| Feature | Description |
|---------|-------------|
| 🏫 Course Management | Full CRUD for courses, lessons, and quizzes |
| 👥 User Management | Create, edit, soft-delete users; link parents ↔ students |
| 📄 PDF Ingestion | Upload curriculum PDFs → automatic vectorization into knowledge base |
| ⚙️ System Dashboard | Overview of platform statistics |

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **FastAPI** | REST API framework |
| **SQLAlchemy** | ORM + database models |
| **SQLite** | Persistent storage |
| **Google Gemini** | LLM for AI chatbot & quiz generation |
| **FAISS** | Vector similarity search for RAG |
| **Sentence Transformers** | Text embedding for knowledge base |
| **spaCy** | NLP processing |
| **PyMuPDF** | PDF parsing for curriculum ingestion |
| **LangChain** | Text splitting for document chunking |

### Frontend
| Technology | Purpose |
|-----------|---------|
| **React 18** | UI framework |
| **TypeScript** | Type-safe development |
| **Vite** | Build tool & dev server |
| **Tailwind CSS** | Utility-first styling |
| **Recharts** | Data visualization charts |
| **Framer Motion** | Animations & transitions |
| **React Player** | Video playback |
| **KaTeX** | LaTeX math rendering |
| **Mermaid** | Diagram rendering |
| **Lucide React** | Icon library |

---

## ⚡ Quick Start

### Prerequisites

- **Python 3.12+**
- **Node.js 18+** & npm
- **Google Gemini API Key** ([Get one here](https://aistudio.google.com/apikey))

### 1. Clone the Repository

```bash
git clone https://github.com/peterraafat99/seba.git
cd seba
```

### 2. Backend Setup

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Create .env file
echo GEMINI_API_KEY=your_api_key_here > .env

# Initialize the database with sample data
python init_db.py

# Start the server
python main.py
```

The API will be available at `http://localhost:3000`

> **API Docs:** Visit `http://localhost:3000/docs` for Swagger UI

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env file (if not present)
echo VITE_API_BASE_URL=http://localhost:3000/api > .env

# Start the dev server
npm run dev
```

The app will be available at `http://localhost:5173`

### 4. Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@example.com` | `admin123` |
| Student | `student@example.com` | `student123` |

---

## 📁 Project Structure

```
seba/
├── backend/
│   ├── main.py                # FastAPI app & all API routes
│   ├── models.py              # SQLAlchemy database models
│   ├── schemas.py             # Pydantic request/response schemas
│   ├── auth.py                # JWT authentication logic
│   ├── chatbot.py             # Gemini-powered AI chatbot with RAG
│   ├── quiz_engine.py         # Personalized quiz generation
│   ├── nlp_engine.py          # Sentiment analysis & insight extraction
│   ├── vector_store.py        # FAISS vector store for RAG retrieval
│   ├── build_rag.py           # Build/rebuild the FAISS index
│   ├── ingest_pdfs.py         # PDF curriculum ingestion pipeline
│   ├── admin.py               # Admin panel routes (CRUD)
│   ├── database.py            # Database connection setup
│   ├── init_db.py             # Database seeder with sample data
│   ├── translate_content.py   # Content translation utilities
│   ├── requirements.txt       # Python dependencies
│   └── curriculum_pdfs/       # Uploaded curriculum PDFs
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Main app with routing
│   │   ├── main.tsx           # Entry point
│   │   ├── pages/             # Page components
│   │   │   ├── Home.tsx       # Landing page
│   │   │   ├── Login.tsx      # Authentication
│   │   │   ├── Register.tsx   # Registration
│   │   │   ├── Dashboard.tsx  # Student/Parent/Teacher dashboard
│   │   │   ├── Courses.tsx    # Course browser
│   │   │   ├── CourseDetail.tsx
│   │   │   ├── Lesson.tsx     # Lesson viewer + AI chat + quiz
│   │   │   ├── Insights.tsx   # Analytics dashboard
│   │   │   └── Admin.tsx      # Admin panel
│   │   ├── components/        # Reusable UI components
│   │   ├── contexts/          # React contexts (Theme, Language)
│   │   ├── styles/            # Global CSS & design tokens
│   │   └── utils/             # API client, helpers
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
│
└── README.md
```

---

## 🔑 API Endpoints

<details>
<summary><b>Authentication</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login & get JWT token |
| POST | `/api/auth/logout` | Logout |

</details>

<details>
<summary><b>Dashboard & Courses</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard` | Get role-specific dashboard data |
| GET | `/api/courses` | List all courses |
| GET | `/api/courses/:id` | Get course details with lessons |
| POST | `/api/courses/:id/enroll` | Enroll in a course |

</details>

<details>
<summary><b>Lessons & Chat</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/lessons/:id` | Get lesson content, video, quiz |
| POST | `/api/lessons/:id/track-time` | Track time spent on lesson |
| POST | `/api/chat` | Send message to AI tutor |

</details>

<details>
<summary><b>Quizzes</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/quiz/submit` | Submit quiz answers |
| POST | `/api/quiz/generate` | Generate AI-personalized quiz |
| POST | `/api/quiz/request` | Request a quiz for a lesson |

</details>

<details>
<summary><b>Insights & Analytics</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/insights/students` | List all students with stats |
| GET | `/api/insights/student/:id` | Detailed student analytics |
| GET | `/api/notes/student/:id` | Get AI-generated teacher notes |
| POST | `/api/insights/comment` | Add teacher comment |

</details>

<details>
<summary><b>Admin</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/courses` | List all courses |
| POST | `/api/admin/courses` | Create course |
| PUT | `/api/admin/courses/:id` | Update course |
| DELETE | `/api/admin/courses/:id` | Delete course |
| POST | `/api/admin/lessons` | Create lesson |
| GET | `/api/admin/users` | List users by role |
| POST | `/api/admin/link-parent` | Link parent ↔ students |

</details>

---

## 🧠 AI Architecture

### RAG Pipeline
1. **Ingestion** — Curriculum PDFs are parsed (PyMuPDF), chunked (LangChain), and embedded (Sentence Transformers)
2. **Indexing** — Embeddings are stored in a FAISS vector index for fast similarity search
3. **Retrieval** — Student questions trigger a hybrid search (vector + BM25) across the knowledge base
4. **Generation** — Retrieved context + lesson content are fed to Gemini with pedagogical prompts

### Emotion-Aware Pedagogy
- Student messages are analyzed for sentiment (frustration, confusion, excitement, etc.)
- The chatbot adapts its teaching strategy based on detected emotions
- Learning insights are automatically extracted and saved as teacher notes

### Personalized Quiz Generation
- Quizzes are generated by Gemini based on lesson content and student history
- Weak areas are identified from past quiz scores and adapted accordingly

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ for education**

</div>

