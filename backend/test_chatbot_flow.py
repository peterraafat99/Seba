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
            db=db
        )
        
        print("\n=================== CHATBOT RESPONSE ===================")
        print(response)
        print("========================================================\n")
        
    except Exception as e:
        print(f"Error during chatbot test: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(main())
