import asyncio
import os
from dotenv import load_dotenv

# Load env variables from .env
load_dotenv()

from database import SessionLocal
from chatbot import get_ai_response

async def main():
    db = SessionLocal()
    try:
        # John Doe (student) is user_id=2
        # HTML Basics is lesson_id=1
        user_id = 2
        lesson_id = 1
        user_message = "Hi Seba! Can you explain what the Real Number System is, and what numbers it includes?"
        
        print("Querying local Seba AI Tutor chatbot...")
        print(f"Message: '{user_message}'\n")
        
        response = await get_ai_response(
            user_id=user_id,
            lesson_id=lesson_id,
            user_message=user_message,
            db=db,
            model_backend="gemini"
        )
        
        print("\n=================== CHATBOT RESPONSE ===================")
        if isinstance(response, dict):
            import pprint
            safe_widget = {k: (str(v).encode('ascii', errors='replace').decode('ascii') if isinstance(v, str) else v) for k, v in response.items()}
            pprint.pprint(safe_widget)
        else:
            safe_response = str(response).encode('ascii', errors='replace').decode('ascii')
            print(safe_response)
        print("========================================================\n")
        
    except Exception as e:
        safe_err = str(e).encode('ascii', errors='replace').decode('ascii')
        print(f"Error during chatbot test: {safe_err}")
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(main())
