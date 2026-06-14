import os
import asyncio
import re
import aiohttp
from sqlalchemy.orm import Session
from dotenv import load_dotenv
from llm_client import get_llm_client

# Import models
from models import Lesson, StudentSentiment, TeacherNote, User, Enrollment, Activity
# Import engines
from nlp_engine import analyze_sentiment, extract_learning_insight
from vector_store import KnowledgeBase
# IMPORT THE QUIZ ENGINE
from quiz_engine import generate_personalized_quiz

# --- Configuration ---
load_dotenv()

# --- LAZY LOADING KNOWLEDGE BASE ---
_kb = None

def get_kb():
    global _kb
    if _kb is None:
        try:
            print("⏳ Loading Knowledge Base... (Lazy Load)")
            _kb = KnowledgeBase()
            print("✅ Knowledge Base Ready.")
        except Exception as e:
            print(f"⚠️ Warning: Could not load Knowledge Base: {e}")
            return None
    return _kb


def unload_local_models():
    """Unloads local embedding and emotion models to free up system RAM before calling Ollama."""
    import gc
    
    # 1. Unload Knowledge Base and Embeddings
    global _kb
    if _kb is not None:
        _kb.reranker = None
        _kb = None
    
    import vector_store
    vector_store._embedding_model = None
    
    # 2. Unload Emotion classification pipeline
    import nlp_engine
    nlp_engine.LOCAL_EMOTION_PIPELINE = None
    nlp_engine.model = None
    nlp_engine.tokenizer = None
    
    # 3. Trigger Python Garbage Collection
    gc.collect()
    
    # 4. Clear PyTorch CPU/GPU memory caches
    try:
        import torch
        torch.cuda.empty_cache()
    except ImportError:
        pass
        
    print("🧹 Unloaded local embedding and NLP models from RAM to free resources.")

# LLM client is loaded lazily on first use via get_llm_client()
# Configure LLM_BACKEND in .env: 'ollama' (local) or 'gemini' (cloud)

def clean_query_for_search(query: str) -> str:
    """Clean query by removing LaTeX math notation and special characters."""
    # Remove LaTeX math delimiters and content: $...$ or $$...$$
    query = re.sub(r'\$+[^$]*\$+', '', query)
    # Remove LaTeX commands like \angle, \circ, etc.
    query = re.sub(r'\\[a-zA-Z]+\{?[^}]*\}?', '', query)
    # Remove extra whitespace
    query = ' '.join(query.split())
    # Remove trailing periods and commas
    query = query.rstrip('.,;')
    return query.strip()

# --- ASYNC IMAGE INJECTOR ---
async def fetch_image_url(session, query, api_key):
    """Async helper to fetch a single image URL using SerpApi."""
    # Clean the query first - remove LaTeX and math notation
    clean_query = clean_query_for_search(query)
    
    url = "https://serpapi.com/search"
    params = {
        "engine": "google_images",
        "q": clean_query,
        "api_key": api_key,
        "num": 1,
        "safe": "active"
    }
    try:
        timeout = aiohttp.ClientTimeout(total=10)  # Increased timeout to 10 seconds
        async with session.get(url, params=params, timeout=timeout) as response:
            if response.status == 200:
                data = await response.json()
                # SerpApi returns images in 'images_results' array
                if "images_results" in data and data["images_results"]:
                    image_url = data["images_results"][0]["original"]
                    print(f"✅ Image found for '{clean_query}': {image_url}")
                    return query, image_url
                else:
                    print(f"⚠️ No images found for query: {clean_query}")
            elif response.status in [401, 403]:
                # API access denied - likely wrong key or rate limit
                error_data = await response.json()
                error_msg = error_data.get("error", "Unknown error")
                print(f"❌ SerpApi Access Denied ({response.status}): {error_msg}")
                print(f"   💡 Check: 1) API key is valid")
                print(f"            2) You have remaining searches in your quota")
                # Return a special marker to indicate API access denied
                return query, "API_ACCESS_DENIED"
            else:
                error_text = await response.text()
                print(f"❌ Image API Error ({response.status}) for '{clean_query}': {error_text[:200]}")
    except asyncio.TimeoutError:
        print(f"⏱️ Image fetch timeout for query: {clean_query}")
    except Exception as e:
        print(f"❌ Image Fetch Error ({clean_query}): {type(e).__name__}: {e}")
    return query, None

async def inject_real_images_async(text: str):
    """
    Finds [Image of X] tags and fetches them in PARALLEL using SerpApi.
    """
    if not text:
        return ""

    api_key = os.getenv("SERPAPI_KEY")
    
    # ✅ YOUR EXACT REGEX PATTERN (Restored & Verified)
    pattern = r"\[Image of ([^\]]+)\]"
    
    try:
        # 1. Find all queries first
        matches = re.findall(pattern, text)
        
        if not matches:
            return text

        if not api_key:
            print("⚠️ SerpApi not configured. SERPAPI_KEY missing.")
            # Fallback: Simple string replacement to avoid regex issues in fallback text
            return text.replace("[Image of", "*(Image Search Not Configured:").replace("]", ")*")
        
        # Track if we got a 403 error (API access denied)
        api_access_denied = False

        print(f"🔍 Searching for {len(matches)} image(s): {matches}")
        
        # 2. Create parallel tasks with proper error handling
        async with aiohttp.ClientSession() as session:
            tasks = [fetch_image_url(session, query, api_key) for query in matches]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        # 3. Create a replacement map, handling exceptions
        replacements = {}
        api_access_denied = False
        for result in results:
            if isinstance(result, Exception):
                print(f"❌ Task exception: {result}")
                if "403" in str(result) or "access" in str(result).lower():
                    api_access_denied = True
                continue
            query, url = result
            if url and url != "API_ACCESS_DENIED":
                replacements[query] = url
            elif url == "API_ACCESS_DENIED":
                api_access_denied = True

        # 4. Replace in text using the map
        def replace_callback(match):
            query = match.group(1)
            url = replacements.get(query)
            if url:
                print(f"✅ Image injected for: {query}")
                return f"![{query}]({url})"
            # Check if it's an API access issue
            clean_q = clean_query_for_search(query)
            if api_access_denied:
                return f"*(Image search unavailable - SerpApi access denied. Please check your API key and quota.)*"
            print(f"⚠️ No image URL found for: {clean_q}")
            return f"*(No image found for {clean_q})*"

        final_text = re.sub(pattern, replace_callback, text)
        print(f"📝 Image injection complete. Found {len(replacements)}/{len(matches)} images.")
        return final_text
        
    except Exception as e:
        print(f"❌ Image Injection Logic Error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return text

# --- BACKGROUND TASK: SAVE MEMORY ---
async def save_memory_background(user_id: int, user_message: str, translated_text: str, emotion: str, db: Session):
    try:
        # 1. Save Sentiment
        db.add(StudentSentiment(
            student_id=user_id,
            original_message=user_message,
            translated_message=translated_text,
            sentiment_label=emotion,
            confidence_score=0.9
        ))
        
        # 2. Extract & Save Hybrid Memory
        insight = await extract_learning_insight(user_message, translated_text)
        if insight:
            import json
            
            # --- A. Update Persona Profile ---
            profile_updates = insight.get("profile_updates")
            if profile_updates and isinstance(profile_updates, dict):
                student = db.query(User).filter(User.id == user_id).first()
                if student:
                    current_profile = {}
                    if student.persona_profile:
                        try:
                            current_profile = json.loads(student.persona_profile)
                        except:
                            pass
                    current_profile.update(profile_updates)
                    student.persona_profile = json.dumps(current_profile)
                    print(f"👤 Persona Profile Updated: {profile_updates}")

            # --- B. Save Situational Note ---
            situational_note = insight.get("situational_note")
            if situational_note and isinstance(situational_note, str) and len(situational_note) > 2:
                print(f"📝 Background Note Saved: {situational_note}")
                
                from vector_store import get_embedding_model, EMBEDDING_BACKEND, get_gemini_embeddings
                
                embedding_json = None
                try:
                    if EMBEDDING_BACKEND == "gemini":
                        emb = get_gemini_embeddings(situational_note, is_query=True)[0].tolist()
                    else:
                        model = get_embedding_model()
                        emb = model.encode([situational_note], normalize_embeddings=True).astype('float32')[0].tolist()
                    embedding_json = json.dumps(emb)
                except Exception as e:
                    print(f"⚠️ Failed to generate embedding for note: {e}")

                # Check for existing similar note
                import numpy as np
                is_duplicate = False
                if embedding_json:
                    query_vec = np.array(emb, dtype='float32')
                    existing_notes = db.query(TeacherNote).filter(TeacherNote.student_id == user_id).all()
                    for en in existing_notes:
                        if en.embedding:
                            try:
                                en_vec = np.array(json.loads(en.embedding), dtype='float32')
                                sim = np.dot(query_vec, en_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(en_vec))
                                if sim > 0.85: # High similarity threshold
                                    en.weight += 0.5 # Increase weight
                                    is_duplicate = True
                                    print(f"🔄 Similar note found! Increased weight of: {en.note_content}")
                                    break
                            except:
                                pass
                
                if not is_duplicate:
                    db.add(TeacherNote(
                        student_id=user_id,
                        note_content=situational_note,
                        category="SITUATIONAL",
                        weight=insight.get("weight", 1.0),
                        embedding=embedding_json
                    ))
        db.commit()
    except Exception as e:
        print(f"⚠️ Background Memory Error: {e}")

# --- Main Chat Logic ---
async def get_ai_response(user_message: str, lesson_id: int, user_id: int, db: Session, image_b64: str = None):
    
    clean_msg = user_message.lower().strip()

    # --- 0. SIMPLE GREETING HANDLER (Fast Response) ---
    greeting_keywords = ["hi", "hello", "hey", "marhaba", "السلام عليكم", "ازيك", "ازيك يا"]
    is_simple_greeting = any(keyword in clean_msg for keyword in greeting_keywords) and len(clean_msg) < 20
    
    if is_simple_greeting:
        # Get lesson title for context
        sys_lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
        lesson_title = sys_lesson.title if sys_lesson else "this lesson"
        student = db.query(User).filter(User.id == user_id).first()
        student_name = student.name if student else "there"
        
        return f"Hi {student_name}! 👋 Ready to explore **{lesson_title}**? Ask me anything about the topics covered here, or type 'quiz me' if you want to test your understanding!"

    # --- 1. INTENT DETECTION: QUIZ (Preserved) ---
    if "quiz" in clean_msg or "test me" in clean_msg:
        print(f"🎯 Quiz Intent Detected for Lesson ID: {lesson_id}")
        quiz_data = await generate_personalized_quiz(user_id, db, lesson_id)
        
        if quiz_data.get("error"):
            return "I couldn't generate a quiz right now. Please try again later."
            
        return {
            "type": "quiz_widget",
            "message": "I've generated a personalized quiz based on this lesson and your learning history. Give it a try!",
            "data": quiz_data
        }


    # --- 2. GET CURRENT LESSON CONTENT + RAG SEARCH ---
    # We get the lesson info directly from the DB
    sys_lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not sys_lesson:
        return "I couldn't find information about this lesson. Please try again."
    
    current_lesson_title = sys_lesson.title
    current_lesson_content = sys_lesson.content or "No content available for this lesson."
    current_course_id = sys_lesson.course_id

    print(f"🚀 Processing message for lesson: {current_lesson_title}")

    # Step 3.1: Sentiment / Translation (Calls Ollama if Arabic is present)
    try:
        sentiment_result = await analyze_sentiment(user_message)
    except Exception as e:
        print(f"⚠️ Sentiment Pipeline Warning: {e}")
        sentiment_result = {"top_emotion": "neutral", "translated_text": user_message}
        
    emotion = sentiment_result.get("top_emotion", "neutral")
    translated_text = sentiment_result.get("translated_text", user_message)

    # Step 3.2: RAG Search (Loads embedding model lazily)
    kb_instance = get_kb()
    should_search_rag = (len(clean_msg) > 3) and (kb_instance is not None)
    if should_search_rag:
        try:
            # Run in executor to prevent blocking the async loop
            rag_docs = await asyncio.to_thread(kb_instance.search, user_message, current_course_id, 3)
        except Exception as e:
            print(f"⚠️ RAG Pipeline Warning: {e}")
            rag_docs = []
    else:
        rag_docs = []
        
    print(f"✅ Processing Complete. Emotion: {emotion}, RAG Docs: {len(rag_docs)}")

    # --- 5. CONTEXT PREP (CURRENT LESSON + LIBRARY) ---
    # Retrieve Student Info
    student = db.query(User).filter(User.id == user_id).first()
    student_name = student.name if student else "Student"
    
    # Format Persona Profile
    persona_txt = "No specific persona traits recorded."
    if student and student.persona_profile:
        try:
            import json
            profile_data = json.loads(student.persona_profile)
            if profile_data:
                persona_txt = "\n    ".join([f"- {k.replace('_', ' ').title()}: {v}" for k, v in profile_data.items()])
        except:
            pass

    # 1. Semantic Search for Situational Teacher Notes
    all_notes = db.query(TeacherNote).filter(TeacherNote.student_id == user_id).all()
    
    top_semantic_notes = []
    if all_notes and len(clean_msg) > 3:
        try:
            import json
            import numpy as np
            from vector_store import get_embedding_model, EMBEDDING_BACKEND, get_gemini_embeddings
            
            # Embed the user query
            if EMBEDDING_BACKEND == "gemini":
                query_vector = get_gemini_embeddings(user_message, is_query=True)[0]
            else:
                model = get_embedding_model()
                query_vector = model.encode([user_message], normalize_embeddings=True).astype('float32')[0]
                
            scored_notes = []
            for n in all_notes:
                if n.embedding:
                    try:
                        note_vec = np.array(json.loads(n.embedding), dtype='float32')
                        sim = np.dot(query_vector, note_vec) / (np.linalg.norm(query_vector) * np.linalg.norm(note_vec))
                        final_score = sim * n.weight
                        scored_notes.append((final_score, n))
                    except:
                        pass
            
            scored_notes.sort(key=lambda x: x[0], reverse=True)
            top_semantic_notes = [n for score, n in scored_notes[:3]] # Take top 3 situational notes
        except Exception as e:
            print(f"⚠️ Note retrieval error: {e}")
            top_semantic_notes = sorted(all_notes, key=lambda x: x.created_at, reverse=True)[:3]
    elif all_notes:
        top_semantic_notes = sorted(all_notes, key=lambda x: x.created_at, reverse=True)[:3]
        
    notes_txt = "\n    ".join([f"- {n.note_content}" for n in top_semantic_notes]) if top_semantic_notes else "No situational notes."

    # RAG CONTEXT (Additional Reference Material)
    rag_context = ""
    if rag_docs:
        rag_context = "\n### ADDITIONAL REFERENCE MATERIAL (Other Lessons):\n"
        for doc in rag_docs:
            # Check if this is from a different lesson
            is_different_lesson = doc['title'] != current_lesson_title
            rag_context += f"--- REFERENCE: {doc['title']} {'(OUT OF CURRENT SCOPE)' if is_different_lesson else ''} ---\n{doc['text']}\n"

    # --- 6. PROMPT ENGINEERING (HYBRID APPROACH) ---
    
    # Dynamic Instruction based on Emotion
    pedagogical_strategy = "Be encouraging and clear."
    if emotion in ["annoyance", "anger", "frustration"]:
        pedagogical_strategy = "The student is FRUSTRATED. Validate their feelings first. Be extra patient. Break the explanation down into very small, simple steps."
    elif emotion in ["confusion", "nervousness"]:
        pedagogical_strategy = "The student is CONFUSED. Do not just give the answer; explain the 'Why' behind it using simple analogies."

    # Dynamic Formatting & Visuals based on Persona
    visuals_instruction = "4. **VISUALS:** If explaining a geometric shape or complex concept, include an image tag: [Image of concept]."
    depth_instruction = "Keep your answers detailed but easy to follow. Keep paragraphs short and readable."
    
    if student and student.persona_profile:
        profile_str = student.persona_profile.lower()
        if "short" in profile_str or "concise" in profile_str or "dislike long" in profile_str:
            depth_instruction = "CRITICAL: Keep your answers extremely short, concise, and to the point. Do NOT write long paragraphs. Use bullet points."
            visuals_instruction = "4. **VISUALS:** Do NOT use image tags unless absolutely necessary, to keep the answer brief."
        elif "in depth" in profile_str or "detailed" in profile_str or "deep" in profile_str:
            depth_instruction = "CRITICAL: Provide a very detailed, in-depth explanation. Do not hold back information."
            
        if "visual" in profile_str or "picture" in profile_str:
            visuals_instruction = "4. **VISUALS:** CRITICAL: The student is a visual learner. You MUST include image tags like [Image of concept] frequently."

    final_prompt = f"""
    You are 'Seba', an expert AI Math Tutor for the Egyptian National Curriculum.
    
    **STUDENT PROFILE (GLOBAL TRAITS):**
    - Name: {student_name}
    - Detected Emotion: {emotion}
    {persona_txt}
    
    **SITUATIONAL MEMORIES (RELEVANT TO QUERY):**
    {notes_txt}
    
    **CURRENT LESSON (PRIMARY FOCUS):**
    Title: {current_lesson_title}
    Content:
    {current_lesson_content}
    
    {rag_context}
    
    **USER MESSAGE:** "{user_message}"
    
    **CORE INSTRUCTIONS:**
    1. **PEDAGOGY:** {pedagogical_strategy}
    2. **LANGUAGE:** Match the student's language strictly. 
       - If they speak Egyptian Arabic (Masri), reply in friendly Masri mixed with English technical terms.
       - If they speak English, reply in English.
    
    **SCOPE MANAGEMENT RULES:**
    1. **PRIMARY FOCUS:** Always prioritize content from the CURRENT LESSON ({current_lesson_title}) when answering.
    
    2. **OUT-OF-SCOPE QUESTIONS:** If a question is about a topic NOT in the current lesson but IS found in the "ADDITIONAL REFERENCE MATERIAL":
       - You MAY answer it, BUT you MUST start with a clear disclaimer:
         "⚠️ **Note:** This topic is covered in [Lesson Name], not in our current lesson ({current_lesson_title}). Here's what you need to know:"
       - Then provide a helpful answer based on that reference material
       - Cite the source lesson clearly: [Term X LesY]
    
    3. **COMPLETELY UNKNOWN TOPICS:** If a question is about something NOT in the current lesson AND NOT in the reference material:
       - Politely decline: "That's a great question! However, I don't have information about that topic in our current curriculum. Let's focus on {current_lesson_title} for now, or feel free to ask about other lessons in the Math Grade 8 course."
    
    {visuals_instruction}
    
    **FORMATTING:**
    - Use LaTeX for ALL math equations: $x^2 + y^2 = z^2$.
    - {depth_instruction}
    - Always cite lesson sources when using reference material
    
    Answer the student now:
    """

    # --- 7. Append image instruction to prompt if image was sent ---
    if image_b64:
        final_prompt += """

**STUDENT UPLOADED AN IMAGE:**
The student sent a photo (likely a handwritten math problem or textbook question).
Analyze the image carefully. Identify any mathematical expressions, equations, or
geometric shapes in it. Then solve or explain it fully in context of the current lesson.
If the image is unclear, describe what you can see and ask the student to clarify.
"""

    # Free up RAM before making the Ollama API call (if caching is disabled)
    cache_local = os.getenv("CACHE_LOCAL_MODELS", "false").lower() == "true"
    if not cache_local and os.getenv("LLM_BACKEND", "ollama").lower() == "ollama":
        unload_local_models()

    print(f"🤖 Generating response via {get_llm_client().backend_name()} ...")
    try:
        llm = get_llm_client()
        response_text = await llm.generate(final_prompt, image_b64=image_b64)
    except RuntimeError as e:
        # Ollama offline or model not loaded — give a helpful error
        print(f"❌ LLM error: {e}")
        return f"⚠️ **AI Service Unavailable**: {e}"

    # --- 8. ASYNC INTERCEPTOR — inject real images (unchanged) ---
    final_text = await inject_real_images_async(response_text)

    # --- 4. BACKGROUND MEMORY (Run at the very end to prevent memory overlap during LLM load) ---
    asyncio.create_task(save_memory_background(user_id, user_message, translated_text, emotion, db))

    return final_text

# --- ACTIVE LEARNING MODE ---
from models import ActiveLearningSession

async def start_active_learning(lesson_id: int, user_id: int, db: Session):
    import json
    sys_lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not sys_lesson:
        return {"error": "Lesson not found"}
        
    student = db.query(User).filter(User.id == user_id).first()
    student_name = student.name if student else "Student"
    
    persona_txt = ""
    if student and student.persona_profile:
        try:
            profile_data = json.loads(student.persona_profile)
            if profile_data:
                persona_txt = "\n".join([f"- {k}: {v}" for k, v in profile_data.items()])
        except: pass

    session = db.query(ActiveLearningSession).filter_by(user_id=user_id, lesson_id=lesson_id, is_completed=False).first()
    if not session:
        session = ActiveLearningSession(user_id=user_id, lesson_id=lesson_id, history_json="[]")
        db.add(session)
        db.commit()
    
    history = json.loads(session.history_json)
    if len(history) > 0:
        return {"message": history[-1]["content"]}
        
    prompt = f"""
    You are an active learning AI tutor. You are about to start teaching a lesson.
    
    STUDENT PROFILE:
    Name: {student_name}
    {persona_txt}
    
    LESSON CONTENT:
    {sys_lesson.title}
    {sys_lesson.content_en or sys_lesson.content or sys_lesson.content_ar}
    
    INSTRUCTIONS:
    1. Read the lesson content above.
    2. Pick the FIRST logical part/concept to teach. Do not teach everything at once.
    3. Explain it simply, adapting to the student's profile.
    4. End your response with a single question to check their understanding of this specific part.
    """
    
    llm = get_llm_client()
    response_text = await llm.generate(prompt)
    final_text = await inject_real_images_async(response_text)
    
    history.append({"role": "assistant", "content": final_text})
    session.history_json = json.dumps(history)
    db.commit()
    
    return {"message": final_text}

async def process_active_learning(user_message: str, lesson_id: int, user_id: int, db: Session):
    import json
    sys_lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    session = db.query(ActiveLearningSession).filter_by(user_id=user_id, lesson_id=lesson_id, is_completed=False).first()
    
    if not session:
        return {"message": "Active learning session not found. Please toggle Active Learning off and on again to restart.", "is_completed": True}
        
    history = json.loads(session.history_json)
    history.append({"role": "user", "content": user_message})
    
    history_txt = ""
    for msg in history[-7:]: # Keep last 7 turns
        history_txt += f"{msg['role'].upper()}: {msg['content']}\n\n"
        
    prompt = f"""
    You are an active learning AI tutor teaching a lesson part-by-part.
    
    FULL LESSON CONTENT:
    {sys_lesson.title}
    {sys_lesson.content_en or sys_lesson.content or sys_lesson.content_ar}
    
    RECENT CONVERSATION (Your teaching & their answers):
    {history_txt}
    
    INSTRUCTIONS:
    1. Evaluate the USER's last answer to your question.
    2. If their answer is correct: Praise them, explain the NEXT logical part of the lesson, and ask a new question about that next part.
    3. If their answer is incorrect or partial: Gently correct them, re-explain the CURRENT part in a different way, and ask another question to check understanding.
    4. If the entire lesson is completed and they understood the last part, congratulate them and say "[LESSON_COMPLETE]" at the very end of your response.
    """
    
    llm = get_llm_client()
    response_text = await llm.generate(prompt)
    final_text = await inject_real_images_async(response_text)
    
    is_complete = "[LESSON_COMPLETE]" in final_text
    clean_text = final_text.replace("[LESSON_COMPLETE]", "").strip()
    
    history.append({"role": "assistant", "content": clean_text})
    session.history_json = json.dumps(history)
    if is_complete:
        session.is_completed = True
        
    db.commit()
    
    return {"message": clean_text, "is_completed": is_complete}