import os
from dotenv import load_dotenv  # <--- 1. Import the library

# 2. LOAD THE KEY (Crucial Step)
load_dotenv() 

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Lesson
from vector_store import KnowledgeBase
from langchain_text_splitters import RecursiveCharacterTextSplitter

# 3. CONFIGURATION
RAG_DB_FILE = "rag_content.db"
RAG_DB_URL = f"sqlite:///./{RAG_DB_FILE}"

def build_index():
    # Cleanup old files based on backend
    backend = os.getenv("EMBEDDING_BACKEND", "local").lower()
    index_file = "course_index_gemini.faiss" if backend == "gemini" else "course_index.faiss"
    meta_file = "course_meta_gemini.pkl" if backend == "gemini" else "course_meta.pkl"

    if os.path.exists(index_file):
        os.remove(index_file)
    if os.path.exists(meta_file):
        os.remove(meta_file)
    print(f"🧹 Cleared old AI memory files ({index_file}, {meta_file}).")

    # Check DB
    if not os.path.exists(RAG_DB_FILE):
        print(f"❌ Error: {RAG_DB_FILE} not found. Run 'python ingest_pdfs.py' first!")
        return

    rag_engine = create_engine(RAG_DB_URL, connect_args={"check_same_thread": False})
    RagSession = sessionmaker(autocommit=False, autoflush=False, bind=rag_engine)
    db = RagSession()
    
    # Initialize KnowledgeBase (uses local BGE-M3 embeddings — no API key needed)
    try:
        kb = KnowledgeBase()
    except Exception as e:
        print(f"❌ Error initializing KnowledgeBase: {e}")
        return
    
    # Splitter Config
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=3000,
        chunk_overlap=500,
        separators=["Topic ", "\n\n", "\n", ". ", " ", ""]
    )
    
    lessons = db.query(Lesson).all()
    
    if not lessons:
        print("❌ No lessons found in database. Run 'python ingest_pdfs.py' first!")
        return

    print(f"🔄 Processing {len(lessons)} lessons for the Knowledge Base...")

    data_to_embed = []
    
    for lesson in lessons:
        if not lesson.content:
            continue

        chunks = splitter.split_text(lesson.content)
        
        for chunk in chunks:
            full_text = f"Lesson: {lesson.title}.\nContent: {chunk}"
            
            data_to_embed.append({
                "id": lesson.id,           
                "course_id": lesson.course_id,
                "title": lesson.title,
                "text": full_text          
            })
    
    if data_to_embed:
        backend = os.getenv("EMBEDDING_BACKEND", "local").lower()
        if backend == "gemini":
            print(f"🚀 Embedding {len(data_to_embed)} chunks via Google Gemini API...")
            kb.add_lessons(data_to_embed)
            print("✅ SUCCESS: Knowledge Base updated with Gemini Cloud embeddings.")
        else:
            print(f"🚀 Embedding {len(data_to_embed)} chunks locally (BGE-M3, no API needed)...")
            kb.add_lessons(data_to_embed)
            print("✅ SUCCESS: Knowledge Base updated with local BGE-M3 embeddings.")
    else:
        print("⚠️ No content found to index.")

if __name__ == "__main__":
    build_index()