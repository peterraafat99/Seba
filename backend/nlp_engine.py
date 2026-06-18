import os
import re
import asyncio
from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
from dotenv import load_dotenv
from llm_client import get_llm_client

load_dotenv()

# --- 1. EAGER LOADING — Local Emotion Model ---
print("[NLP] Initializing Local AI Engine... (This may take 10-20 seconds)")

try:
    model_name = "SamLowe/roberta-base-go_emotions"
    tokenizer = AutoTokenizer.from_pretrained(model_name, local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(model_name, local_files_only=True)
    LOCAL_EMOTION_PIPELINE = pipeline(
        "text-classification",
        model=model,
        tokenizer=tokenizer,
        top_k=None,
        device=-1
    )
    print("[NLP] Local Emotion Model Loaded Successfully into RAM.")

except Exception as e:
    print(f"[NLP] WARNING: Could not load Local Model. Ensure it is cached. {e}")
    LOCAL_EMOTION_PIPELINE = None


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
    if not LOCAL_EMOTION_PIPELINE:
        print("[NLP] Local model missing, returning neutral.")
        return {"top_emotion": "neutral", "top_3_emotions": [], "translated_text": message}

    try:
        # 2. LANGUAGE GATEKEEPER
        if contains_arabic(message):
            print(f"[NLP] Arabic detected: '{message}' -> Translating via LLM ({model_backend or 'default'})...")
            llm = get_llm_client(force_backend=model_backend)
            prompt = create_translation_prompt(message)
            translated_text = await llm.generate(prompt)
            # Strip any preamble the model might add
            translated_text = translated_text.strip().split("\n")[0].strip()
            print(f"[NLP] Translated: {translated_text}")
        else:
            translated_text = message

        # 3. Local RoBERTa emotion analysis (non-blocking)
        def run_local_inference(text):
            return LOCAL_EMOTION_PIPELINE(text)[0]

        emotion_scores_list = await asyncio.to_thread(run_local_inference, translated_text)

        # 4. Process Results
        scores = {item['label']: round(item['score'], 4) for item in emotion_scores_list}
        top_emotion = max(scores, key=scores.get)
        sorted_emotions = sorted(scores.items(), key=lambda item: item[1], reverse=True)[:3]

        return {
            "top_emotion": top_emotion,
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
    
    **OUTPUT FORMAT:**
    Return ONLY valid JSON.
    There are TWO types of insights you can extract:
    1. "profile_updates": Global, definitive traits about the student's persona. These will OVERWRITE existing traits. 
       Examples of keys: "learning_style" (visual, textual, auditory), "attention_span" (short, long), "frustration_threshold" (low, high), "tone_preference" (encouraging, strict).
    2. "situational_note": A specific, situational observation (e.g. "Struggles with fractions", "Loves space examples").
    
    You can return one, both, or neither (if no insight is found).
    
    Example Output:
    {{
      "profile_updates": {{"learning_style": "textual"}},
      "situational_note": "Confused by common denominators"
    }}
    If no insight, return: {{}}
    """

    try:
        response = await llm.generate(prompt)
        import json
        import re
        # Find JSON block in the response
        match = re.search(r'\{.*\}', response.replace('\n', ' '))
        if match:
            data = json.loads(match.group(0))
            if not data:
                return None
            return {
                "profile_updates": data.get("profile_updates"),
                "situational_note": data.get("situational_note"),
                "weight": 1.0
            }
        return None

    except Exception as e:
        print(f"Error extracting insight: {e}")
        return None