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
        print(f"[NLP] Error: {e}")
        return {
            "top_emotion": "neutral",
            "top_3_emotions": [],
            "translated_text": message
        }


async def extract_learning_insight(original_message: str, translated_message: str, model_backend: str = None) -> dict:
    """
    Uses the LLM (based on model_backend) to extract pedagogical insights for the teacher dashboard.
    """
    llm = get_llm_client(force_backend=model_backend)

    prompt = f"""
    You are an expert educational psychologist.
    
    **TASK:**
    Analyze this student message for specific learning indicators.
    Original: "{original_message}"
    Translated: "{translated_message}"
    
    **CRITERIA:**
    1. Does the student reveal a specific **misconception**?
    2. Is there a **gap in prerequisite knowledge**?
    3. Is there a clear **strength** or **interest**?
    
    **OUTPUT:**
    - If YES: Return a concise note (max 6 words). Example: "Struggles with loops", "Confused by recursion".
    - If NO (e.g., just greetings or generic frustration): Return "None".
    
    Return ONLY the note or "None". No explanation.
    """

    try:
        note_content = await llm.generate(prompt)
        note_content = note_content.strip().split("\n")[0].strip()

        if "None" in note_content or len(note_content) < 3:
            return None

        return {
            "note": note_content,
            "weight": 1.5
        }

    except Exception as e:
        print(f"Error extracting insight: {e}")
        return None