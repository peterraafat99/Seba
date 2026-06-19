import os
import re
import asyncio
from dotenv import load_dotenv
from llm_client import get_llm_client

load_dotenv()

# --- 1. LAZY LOADING — Local Emotion Model ---
LOCAL_EMOTION_PIPELINE = None
LOCAL_EMOTION_INITIALIZED = False

def get_emotion_pipeline():
    global LOCAL_EMOTION_PIPELINE, LOCAL_EMOTION_INITIALIZED
    if LOCAL_EMOTION_INITIALIZED:
        return LOCAL_EMOTION_PIPELINE
        
    print("[NLP] Initializing Local AI Engine... (This may take 10-20 seconds)")
    try:
        model_name = "SamLowe/roberta-base-go_emotions"
        from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
        try:
            tokenizer = AutoTokenizer.from_pretrained(model_name, local_files_only=True)
            model = AutoModelForSequenceClassification.from_pretrained(model_name, local_files_only=True)
            logger_msg = "[NLP] Local Emotion Model loaded from cache."
        except Exception:
            print(f"[NLP] Local cache not found for '{model_name}'. Downloading from Hugging Face Hub (this might take a minute)...")
            tokenizer = AutoTokenizer.from_pretrained(model_name, local_files_only=False)
            model = AutoModelForSequenceClassification.from_pretrained(model_name, local_files_only=False)
            logger_msg = "[NLP] Local Emotion Model downloaded and cached."
            
        LOCAL_EMOTION_PIPELINE = pipeline(
            "text-classification",
            model=model,
            tokenizer=tokenizer,
            top_k=None,
            device=-1
        )
        print(logger_msg)
    except Exception as e:
        print(f"[NLP] WARNING: Could not load Local Model. {e}")
        LOCAL_EMOTION_PIPELINE = None
        
    LOCAL_EMOTION_INITIALIZED = True
    return LOCAL_EMOTION_PIPELINE


# --- HELPER FUNCTIONS ---

def contains_arabic(text: str) -> bool:
    """Checks if the string contains any Arabic characters."""
    return bool(re.search(r'[\u0600-\u06FF]', text))


def create_translation_prompt(message: str) -> str:
    return f"""
    You are an expert translator specializing in **Egyptian Arabic Dialect**.
    
    **YOUR GOAL:**
    Translate the Arabic parts of the following message into English to capture the student's emotional intent.
    
    **CRITICAL RULES:**
    1. **ARABIC ONLY:** Translate ONLY the Arabic words. 
    2. **PRESERVE ENGLISH:** Do NOT change, rephrase, or correct any English words, code snippets, or technical terms already present in the message. Keep them exactly as they are.
    3. **OUTPUT:** Return ONLY the final translated sentence. No explanation, no preamble.

    **Input Message:** "{message}"
    
    **Translation:**
    """


# --- MAIN ENGINES ---

async def analyze_sentiment(message: str, model_backend: str = None):
    """
    Hybrid Pipeline: 
    1. Gatekeeper -> Checks if translation is needed.
    2. LLM (Ollama/Gemini, based on model_backend) -> Translates Egyptian Arabic to English.
    3. RoBERTa (Local) -> Analyzes Emotion on CPU (non-blocking thread).
    """
    pipeline_instance = get_emotion_pipeline()
    if not pipeline_instance:
        print("[NLP] Local model missing, returning neutral.")
        return {"top_emotion": "neutral", "top_3_emotions": [], "translated_text": message}

    try:
        # 2. LANGUAGE GATEKEEPER
        if contains_arabic(message):
            safe_msg = message.encode('ascii', errors='replace').decode('ascii')
            print(f"[NLP] Arabic detected: '{safe_msg}' -> Translating via LLM ({model_backend or 'default'})...")
            
            prompt = create_translation_prompt(message)
            translated_text = None
            
            # Try primary backend
            try:
                llm = get_llm_client(force_backend=model_backend)
                translated_text = await llm.generate(prompt)
            except Exception as primary_error:
                print(f"[NLP] Primary LLM backend failed: {primary_error}")
                # Fallback to alternative backend
                current_default_backend = (model_backend or os.getenv("LLM_BACKEND", "ollama")).lower()
                fallback_backend = "gemini" if current_default_backend == "ollama" else "ollama"
                print(f"[NLP] Attempting fallback translation via: {fallback_backend}...")
                try:
                    llm = get_llm_client(force_backend=fallback_backend)
                    translated_text = await llm.generate(prompt)
                except Exception as fallback_error:
                    print(f"[NLP] Fallback LLM backend also failed: {fallback_error}")
            
            if translated_text:
                # Strip any preamble the model might add
                translated_text = translated_text.strip().split("\n")[0].strip()
                safe_trans = translated_text.encode('ascii', errors='replace').decode('ascii')
                print(f"[NLP] Translated: {safe_trans}")
            else:
                print("[NLP] All translation backends failed. Using raw message.")
                translated_text = message
        else:
            translated_text = message

        # 3. Local RoBERTa emotion analysis (non-blocking)
        def run_local_inference(text):
            return pipeline_instance(text)[0]

        emotion_scores_list = await asyncio.to_thread(run_local_inference, translated_text)

        # 4. Process Results
        scores = {item['label']: round(item['score'], 4) for item in emotion_scores_list}
        top_go_emotion = max(scores, key=scores.get)
        sorted_emotions = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:3]

        return {
            "top_emotion": top_go_emotion,
            "top_3_emotions": sorted_emotions,
            "translated_text": translated_text
        }

    except Exception as e:
        safe_err = str(e).encode('ascii', errors='replace').decode('ascii')
        print(f"[NLP] Error: {safe_err}")
        return {
            "top_emotion": "neutral",
            "top_3_emotions": [],
            "translated_text": message
        }


async def extract_learning_insight(original_message: str, translated_message: str, model_backend: str = None) -> dict:
    """
    Uses the LLM to write a flexible, natural teacher observation about the student.
    Returns a structured dict with: note, category, weight, topic_tags.

    Categories (matching TeacherNote model):
      WEAKNESS      — struggles, misconceptions, gaps (weight 2.0)
      STRENGTH      — capabilities, breakthroughs, confidence (weight 1.8)
      CORE_PERSONA  — learning style, personality about learning (weight 2.0)
      TOPIC_SPECIFIC — questions or interest in a specific topic (weight 1.5)
      SITUATIONAL   — emotional state, context, or one-off observation (weight 1.0)
    """
    llm = get_llm_client(force_backend=model_backend)

    prompt = f"""
You are an experienced math teacher writing a brief observation note about a student in your private notebook.

A student just sent this message in your online tutoring chat:
  Original: "{original_message}"
  Translated (if Arabic): "{translated_message}"

Your job is to write a SHORT, NATURAL, INSIGHTFUL teacher observation about what this message reveals.
Think like a real teacher — what would you jot down after seeing this message?

Rules:
- Write the note as a natural observation sentence (NOT a command, NOT a label). Max 12 words.
  Good examples:
    "Confused about why negative times negative gives positive"
    "Asks lots of questions about fractions — shows genuine curiosity"
    "Seems to memorize steps but doesn't understand the underlying concept"
    "Gets frustrated quickly when problems take more than one step"
    "Strong intuition for geometry; struggles to write formal proofs"
    "Prefers visual explanations, dislikes pure algebraic derivations"
- Also classify the note into ONE category:
    WEAKNESS      → a gap, struggle, misconception, or persistent error
    STRENGTH      → a capability, breakthrough, or area of confidence  
    CORE_PERSONA  → a stable learning style or personality trait about learning
    TOPIC_SPECIFIC → an interest or question about a specific math topic
    SITUATIONAL   → an emotional state or one-time contextual observation
- Extract topic tags (comma-separated math topics mentioned, e.g. "Fractions, Algebra")
- Assign a severity weight (float):
    WEAKNESS:      2.0 if clearly significant, 1.5 if minor
    STRENGTH:      1.8 if a clear ability, 1.2 if minor
    CORE_PERSONA:  2.0 (always important for long-term adaptation)
    TOPIC_SPECIFIC: 1.5
    SITUATIONAL:   1.0

If the message is ONLY a greeting, thanks, or has ZERO academic content, return exactly:
SKIP

Otherwise return ONLY valid JSON in this exact format (no markdown, no explanation):
{{
  "note": "<your teacher observation>",
  "category": "<WEAKNESS|STRENGTH|CORE_PERSONA|TOPIC_SPECIFIC|SITUATIONAL>",
  "weight": <float>,
  "topic_tags": "<comma-separated tags or empty string>"
}}
"""

    try:
        raw = await llm.generate(prompt)
        raw = raw.strip()

        # Strip markdown fences if the model wraps output
        import re as _re
        raw = _re.sub(r'^```(?:json)?\s*', '', raw, flags=_re.IGNORECASE)
        raw = _re.sub(r'\s*```$', '', raw)
        raw = raw.strip()

        # Check SKIP signal
        if raw.upper().startswith("SKIP") or raw.lower() == "none":
            print("[NLP] Insight: message has no academic content, skipping note.")
            return None

        # Try to parse JSON
        import json as _json
        try:
            data = _json.loads(raw)
        except Exception:
            # Fallback: try to extract just the JSON object if model added preamble
            match = _re.search(r'\{.*\}', raw, _re.DOTALL)
            if match:
                data = _json.loads(match.group())
            else:
                # Last resort: treat the whole response as a plain note in SITUATIONAL
                note_text = raw.split("\n")[0].strip().strip('"').strip("'")
                if len(note_text) < 3:
                    return None
                data = {
                    "note": note_text,
                    "category": "SITUATIONAL",
                    "weight": 1.0,
                    "topic_tags": ""
                }

        note_text = str(data.get("note", "")).strip().strip('"').strip("'")
        if not note_text or len(note_text) < 3:
            return None

        category = str(data.get("category", "SITUATIONAL")).upper()
        if category not in ("WEAKNESS", "STRENGTH", "CORE_PERSONA", "TOPIC_SPECIFIC", "SITUATIONAL"):
            category = "SITUATIONAL"

        try:
            weight = float(data.get("weight", 1.0))
        except (TypeError, ValueError):
            weight = 1.0

        topic_tags = str(data.get("topic_tags", "")).strip()

        safe_note = note_text.encode('ascii', errors='replace').decode('ascii')
        print(f"[NLP] Insight extracted — [{category}] w={weight}: {safe_note}")

        return {
            "note": note_text,
            "situational_note": note_text,   # kept for backward compat with chatbot.py
            "category": category,
            "weight": weight,
            "topic_tags": topic_tags,
        }

    except Exception as e:
        safe_err = str(e).encode('ascii', errors='replace').decode('ascii')
        print(f"[NLP] Error extracting insight: {safe_err}")
        return None