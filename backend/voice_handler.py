"""
voice_handler.py
----------------
Speech-to-Text  : Groq Cloud API (whisper-large-v3) — zero VRAM, free tier
Text-to-Speech  : pyttsx3 (system voices, zero VRAM)

Set GROQ_API_KEY in your .env file.
Get a free key at: https://console.groq.com
"""

import os
import io
import asyncio
import tempfile
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# SPEECH-TO-TEXT (Groq Whisper)
# ---------------------------------------------------------------------------

async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> dict:
    """
    Send audio bytes to Groq's Whisper API and return transcription.

    Args:
        audio_bytes : Raw audio file content (webm, mp3, wav, m4a, ogg, etc.)
        filename    : Original filename — Groq uses the extension to detect format

    Returns:
        {
            "text"     : "The transcribed text",
            "language" : "en" | "ar" | ...,
            "success"  : True | False,
            "error"    : None | "error message"
        }
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return {
            "text": "",
            "language": "en",
            "success": False,
            "error": "GROQ_API_KEY not set in .env"
        }

    try:
        # Import lazily so the server still starts if groq is not installed
        from groq import Groq

        client = Groq(api_key=api_key)

        # Groq requires a file-like object with a name attribute
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = filename

        # Run synchronous Groq call in a thread to avoid blocking async server
        def _call_groq():
            return client.audio.transcriptions.create(
                file=(filename, audio_bytes),
                model="whisper-large-v3",
                response_format="verbose_json",   # gives us language detection too
                temperature=0.0
            )

        result = await asyncio.to_thread(_call_groq)

        text = result.text.strip()
        language = getattr(result, "language", "unknown")
        print(f"[Voice] Transcribed ({language}): {text[:80]}{'...' if len(text) > 80 else ''}")

        return {
            "text": text,
            "language": language,
            "success": True,
            "error": None
        }

    except Exception as e:
        print(f"[Voice] Transcription error: {e}")
        return {
            "text": "",
            "language": "en",
            "success": False,
            "error": str(e)
        }


# ---------------------------------------------------------------------------
# TEXT-TO-SPEECH (pyttsx3 — local system voices, zero VRAM)
# ---------------------------------------------------------------------------

def _get_tts_engine():
    """Create and return a pyttsx3 engine instance."""
    import pyttsx3
    engine = pyttsx3.init()
    engine.setProperty("rate", 165)    # Words per minute (natural pace)
    engine.setProperty("volume", 0.95)
    return engine


async def synthesize_speech(text: str, language: str = "en") -> bytes:
    """
    Convert text to speech and return raw WAV bytes.

    Args:
        text     : The text to speak
        language : 'ar' for Arabic, 'en' for English (used for voice selection)

    Returns:
        WAV audio bytes, or empty bytes on failure
    """
    def _synthesize():
        try:
            import pyttsx3

            engine = pyttsx3.init()
            engine.setProperty("rate", 160)
            engine.setProperty("volume", 0.95)

            # Try to select an Arabic voice if language is Arabic
            if language == "ar":
                voices = engine.getProperty("voices")
                arabic_voice = next(
                    (v for v in voices if "arabic" in v.name.lower() or "ar" in v.id.lower()),
                    None
                )
                if arabic_voice:
                    engine.setProperty("voice", arabic_voice.id)
                    print(f"[Voice] Using Arabic voice: {arabic_voice.name}")
                else:
                    print("[Voice] No Arabic system voice found, using default voice.")

            # Save to a temp WAV file, then read back as bytes
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_path = tmp.name

            engine.save_to_file(text, tmp_path)
            engine.runAndWait()

            with open(tmp_path, "rb") as f:
                audio_bytes = f.read()

            os.unlink(tmp_path)
            return audio_bytes

        except Exception as e:
            print(f"[Voice] TTS error: {e}")
            return b""

    return await asyncio.to_thread(_synthesize)
