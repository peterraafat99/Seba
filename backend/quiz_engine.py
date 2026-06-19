import os
import re
import json
from sqlalchemy.orm import Session
from sqlalchemy import desc
from llm_client import get_llm_client

# Import your models
from models import User, Lesson, Course, StudentSentiment

def is_quiz_request(message: str) -> bool:
    clean = message.lower().strip()
    # Remove simple punctuation
    clean = re.sub(r'[?.!,]', '', clean).strip()
    
    # 1. Direct explicit phrases requesting a quiz
    phrases = [
        "quiz me", "test me", "generate quiz", "make a quiz", 
        "give me a quiz", "start a quiz", "take a quiz", "generate a quiz",
        "want a quiz", "want a test", "want quiz", "want test", "ask me",
        "اختبرني", "امتحنني", "عايز اختبار", "عايزة اختبار", "عايز كويز", 
        "عايزة كويز", "عايز امتحان", "عايزة امتحان", "اعملي اختبار", "اعملي كويز", 
        "ابدا اختبار", "ابدأ اختبار", "ابدأ الكويز", "ابدأ الامتحان", "اسألني سؤال", 
        "اسألني أسئلة", "اسألني اسئلة", "اسألني", "اعملي امتحان", "عايز امتحن", "عايزة امتحن"
    ]
    if any(p in clean for p in phrases):
        return True
        
    # 2. Standalone keywords (exactly matching the word, or preceded by simple politeness like "please", "ممكن", "عايز")
    standalone_keywords = ["quiz", "test", "كويز", "اختبار", "امتحان"]
    words = clean.split()
    if len(words) <= 3:
        # Check if the primary noun is one of the standalone keywords
        if any(w in standalone_keywords for w in words):
            # Check for negative or purely questioning contexts to prevent false positives
            # e.g., "how is quiz?", "quiz why", "what is test"
            negatives = ["why", "how", "what", "where", "score", "degree", "درجة", "درجات", "ليه", "إزاي", "ازاي", "فين", "إيه", "ايه"]
            if not any(neg in words for neg in negatives):
                return True
                
    return False

async def generate_personalized_quiz(user_id: int, db: Session, target_lesson_id: int, model_backend: str = None):
    """
    Generates a quiz covering the TARGET lesson AND reviewing PREVIOUS lessons.
    Adjusts difficulty based on student sentiment.
    """
    
    # --- 1. GET CONTEXT (Current & Past) ---
    # Get the specific lesson the user is on
    current_lesson = db.query(Lesson).filter(Lesson.id == target_lesson_id).first()
    if not current_lesson:
        return {"error": True, "message": "Lesson not found."}

    # Get the student profile
    student = db.query(User).filter(User.id == user_id).first()
    student_name = student.name if student else "Student"

    # Get previous lessons in this course (for review questions)
    # We assume 'id' indicates order. If you have an 'order' column, use that instead.
    past_lessons = db.query(Lesson).filter(
        Lesson.course_id == current_lesson.course_id,
        Lesson.id < current_lesson.id,  # Less than current ID = Previous
        Lesson.content != None          # Only lessons that have content
    ).limit(3).all()                    # Limit to last 3 to save context window

    # Prepare Context Strings
    current_topic_content = current_lesson.content or "No content available."
    
    review_topics_str = "No previous topics."
    if past_lessons:
        review_topics_str = "\n".join([
            f"- Lesson '{p.title}': {p.content[:300]}..." # Take first 300 chars as summary
            for p in past_lessons
        ])

    safe_name = student_name.encode('ascii', errors='replace').decode('ascii')
    safe_title = current_lesson.title.encode('ascii', errors='replace').decode('ascii')
    print(f"[Quiz] Generating quiz for {safe_name} on {safe_title} + Review...")

    # --- 2. DETECT EMOTION (The Sentiment Part) ---
    # Fetch the last 5 sentiment records to look for sad or unconfident emotions
    recent_sentiments = db.query(StudentSentiment).filter(
        StudentSentiment.student_id == user_id
    ).order_by(desc(StudentSentiment.created_at)).limit(5).all()
    
    sad_or_unconfident_emotions = {
        "sadness", "grief", "remorse", "disappointment", "disapproval",
        "confusion", "nervousness", "fear", "embarrassment", "annoyance", "anger", "disgust"
    }
    
    emotion = "neutral"
    if recent_sentiments:
        # Check if any recent emotion is sad or unconfident, in order of recency
        found_emotion = None
        for s in recent_sentiments:
            if s.sentiment_label in sad_or_unconfident_emotions:
                found_emotion = s.sentiment_label
                break
        
        if found_emotion:
            emotion = found_emotion
            print(f"[Quiz Engine] Detected recent sad/unconfident emotion: '{emotion}'")
        else:
            emotion = recent_sentiments[0].sentiment_label
    
    # Adjust Difficulty & Tone based on Emotion
    if emotion in ["annoyance", "anger", "frustration", "nervousness", "confusion", "sadness", "grief", "remorse", "disappointment", "disapproval", "fear", "embarrassment", "disgust"]:
        difficulty = "EASY"
        tone_instruction = f"The student is feeling {emotion}. Be very encouraging. Use simpler language. Focus on building confidence."
    elif emotion in ["boredom"]:
        difficulty = "HARD"
        tone_instruction = "The student is bored. Challenge them with an interesting or tricky application problem."
    elif emotion in ["joy", "excitement", "curiosity", "pride", "optimism"]:
        difficulty = "MEDIUM-HARD"
        tone_instruction = "The student is excited! Keep the momentum high with interesting questions."
    else:
        difficulty = "MEDIUM" # Standard
        tone_instruction = "Standard academic tone."

    # --- 3. CONSTRUCT THE PROMPT ---
    prompt = f"""
    You are an expert tutor creating a personalized quiz for {student_name}.
    
    **GOAL:** Create a 5-question quiz.
    - **Question 1 & 2:** Must be about the CURRENT LESSON.
    - **Question 3:** Must be a REVIEW question from PREVIOUS LESSONS (Spaced Repetition).
    - **Question 4 & 5:** Must be about the CURRENT LESSON.

    **CONTEXT:**
    1. CURRENT LESSON: "{current_lesson.title}"
       Content: {current_topic_content}
    
    2. PREVIOUS LESSONS (For Review):
       {review_topics_str}

    **PERSONALIZATION SETTINGS:**
    - Student Emotion: {emotion}
    - Quiz Difficulty: {difficulty}
    - Tone Strategy: {tone_instruction}

    **OUTPUT FORMAT:**
    Return strictly valid JSON with this structure:
    {{
      "title": "A fun title based on the emotion (e.g., 'Confidence Booster Quiz')",
      "difficulty": "{difficulty}",
      "questions": [
        {{
          "id": 1,
          "text": "The question text",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correct_option_index": 0 
        }}
      ]
    }}
    """

    # --- 4. GENERATE & RETURN ---
    try:
        llm = get_llm_client(force_backend=model_backend)
        # Add explicit JSON instruction since local models don't support mime type enforcement
        json_prompt = prompt + """

IMPORTANT: Return ONLY the raw JSON object. Do not wrap it in markdown code fences.
Do not add any explanation before or after the JSON."""

        response_text = await llm.generate(json_prompt)

        # Robust JSON cleaning
        clean_text = response_text.strip()
        # Remove markdown fences
        clean_text = re.sub(r'^```json\s*', '', clean_text, flags=re.IGNORECASE)
        clean_text = re.sub(r'\s*```$', '', clean_text)
        
        # Extract main JSON object
        json_match = re.search(r'\{.*\}', clean_text, re.DOTALL)
        if not json_match:
            raise ValueError("No JSON object found in model response.")
            
        json_str = json_match.group()
        # Clean trailing commas in objects and arrays
        json_str = re.sub(r',\s*([\]}])', r'\1', json_str)

        quiz_data = json.loads(json_str)
        
        # Save generated quiz to database
        try:
            from models import Quiz, QuizQuestion
            new_quiz = Quiz(
                lesson_id=target_lesson_id,
                quiz_type="generated",
                student_id=user_id,
                title=quiz_data.get("title", "Generated Quiz"),
                difficulty=quiz_data.get("difficulty", "MEDIUM")
            )
            db.add(new_quiz)
            db.commit()
            db.refresh(new_quiz)
            
            # Save questions and update their IDs with database IDs
            questions_list = quiz_data.get("questions", [])
            for i, q in enumerate(questions_list):
                opts = q.get("options", ["", "", "", ""])
                option_a = opts[0] if len(opts) > 0 else ""
                option_b = opts[1] if len(opts) > 1 else ""
                option_c = opts[2] if len(opts) > 2 else ""
                option_d = opts[3] if len(opts) > 3 else None
                
                new_q = QuizQuestion(
                    quiz_id=new_quiz.id,
                    question=q.get("text", "Question"),
                    option_a=option_a,
                    option_b=option_b,
                    option_c=option_c,
                    option_d=option_d,
                    correct_answer=q.get("correct_option_index", 0),
                    order=i
                )
                db.add(new_q)
                db.commit()
                db.refresh(new_q)
                
                # Update returned ID with the real DB ID
                q["id"] = new_q.id
                
            quiz_data["id"] = new_quiz.id
            print(f"[Quiz Engine] Saved generated quiz ID {new_quiz.id} with {len(questions_list)} questions to DB")
        except Exception as e:
            db.rollback()
            print(f"[Quiz Engine] Failed to save generated quiz to DB: {e}")

        return quiz_data

    except Exception as e:
        print(f"[Quiz] Generation Error: {e}")
        return {
            "error": True,
            "message": "AI failed to generate quiz. Please try again."
        }