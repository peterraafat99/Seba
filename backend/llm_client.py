"""
LLM Client Abstraction
======================
Provides a unified async interface to generate text/vision responses
from different LLM backends without changing any calling code.

Supported backends (set LLM_BACKEND in .env):
  "ollama"  → Local Qwen 3.5 9B (or any Ollama model) via Ollama REST API
  "gemini"  → Cloud Gemini/Gemma API (fallback or for large cloud models)

Usage:
    from llm_client import get_llm_client
    llm = get_llm_client()
    text = await llm.generate(prompt)
    text = await llm.generate(prompt, image_b64="base64encodedimage...")

Switch model in .env:
    LLM_BACKEND=ollama
    OLLAMA_MODEL=seba-tutor           # Your custom Ollama model name
    OLLAMA_HOST=http://localhost:11434

    # Cloud fallback (when LLM_BACKEND=gemini or CLOUD_MODEL is set):
    GEMINI_API_KEY=your_key_here
    CLOUD_MODEL=gemini-2.5-flash      # or gemma-4-31b-it etc.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Optional

import aiohttp
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------

class LLMClient(ABC):
    """Abstract base — all backends expose the same interface."""

    @abstractmethod
    async def generate(self, prompt: str, image_b64: Optional[str] = None) -> str:
        """
        Generate a text response.

        Parameters
        ----------
        prompt : str
            Full prompt string (system + context + user message, already assembled).
        image_b64 : str, optional
            Base64-encoded image (PNG/JPEG). When provided, the model receives
            both the text prompt and the image (vision/multimodal request).

        Returns
        -------
        str — the model's response text.
        """
        ...

    @abstractmethod
    def backend_name(self) -> str:
        ...


# ---------------------------------------------------------------------------
# Ollama Client  (local — Qwen 3.5 9B, Gemma 4, etc.)
# ---------------------------------------------------------------------------

class OllamaClient(LLMClient):
    """
    Calls the local Ollama REST API.
    Supports text-only and vision (image+text) requests.

    Ollama must be running:  ollama serve
    Model must be pulled:    ollama pull qwen3.5:9b
                             ollama create seba-tutor -f Modelfile
    """

    def __init__(
        self,
        model: str = "seba-tutor",
        host: str = "http://localhost:11434",
        timeout: int = 120,
    ):
        self.model = model
        self.host = host.rstrip("/")
        self.timeout = timeout
        logger.info(f"[LLM] Ollama client ready — model={model}, host={host}")

    def backend_name(self) -> str:
        return f"ollama:{self.model}"

    async def generate(self, prompt: str, image_b64: Optional[str] = None) -> str:
        """
        Send a chat completion request to Ollama.
        Uses /api/chat endpoint which supports vision models.
        """
        url = f"{self.host}/api/chat"

        # Build message content — Ollama vision format
        if image_b64:
            content_message = {
                "role": "user",
                "content": prompt,
                "images": [image_b64],  # Ollama accepts raw base64 strings (no data: prefix)
            }
        else:
            content_message = {
                "role": "user",
                "content": prompt,
            }

        payload = {
            "model": self.model,
            "messages": [content_message],
            "stream": False, 
            "think": False,       # 🔥 ADD THIS HERE AT THE ROOT LEVEL!
            "keep_alive": "30m",  # Keeps model in VRAM for fast follow-up chats
            "options": {
                "temperature": 0.7,
                "num_predict": 1024,  # 1024 tokens is now a massive budget just for the text response!
                "num_ctx": 8192,      
            },
        }

        try:
            timeout = aiohttp.ClientTimeout(total=self.timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as resp:
                    if resp.status != 200:
                        error = await resp.text()
                        logger.error(f"[Ollama] HTTP {resp.status}: {error[:300]}")
                        raise RuntimeError(f"Ollama returned HTTP {resp.status}. Is Ollama running? Run: ollama serve")
                    
                    data = await resp.json()
                    text = data.get("message", {}).get("content", "")
                    
                    if not text:
                        logger.warning("[Ollama] Empty response from model.")
                        return "عذراً، لم أستطع توليد رد. حاول مرة أخرى."
                    
                    logger.debug(f"[Ollama] Response length: {len(text)} chars")
                    return text.strip()

        except aiohttp.ClientConnectorError:
            logger.error("[Ollama] Connection refused — Ollama is not running!")
            raise RuntimeError(
                "Cannot connect to Ollama. Please start it with: ollama serve\n"
                "Then ensure the model is available: ollama pull qwen3.5:9b"
            )
        except asyncio.TimeoutError:
            logger.error(f"[Ollama] Request timed out after {self.timeout}s")
            raise RuntimeError(
                f"Ollama timed out after {self.timeout}s. "
                "The model may still be loading — try again in a few seconds."
            )

    async def is_healthy(self) -> bool:
        """Check if Ollama is reachable and the model is available."""
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(f"{self.host}/api/tags") as resp:
                    if resp.status != 200:
                        return False
                    data = await resp.json()
                    models = [m["name"] for m in data.get("models", [])]
                    available = any(self.model in m for m in models)
                    if not available:
                        logger.warning(
                            f"[Ollama] Model '{self.model}' not found. "
                            f"Available: {models}. Run: ollama pull qwen3.5:9b"
                        )
                    return available
        except Exception:
            return False


# ---------------------------------------------------------------------------
# Gemini / Cloud Client  (API fallback — also handles Gemma 4 31B via API)
# ---------------------------------------------------------------------------

class GeminiClient(LLMClient):
    """
    Calls the Google Generative AI API.
    Works for:
      - gemini-2.5-flash        (current default)
      - gemma-4-31b-it          (Gemma 4 31B via Google AI API — set CLOUD_MODEL=gemma-4-31b-it)
      - Any future Google models
    
    Set CLOUD_MODEL in .env to switch between them without code changes.
    """

    def __init__(self, model: str = None, api_key: str = None):
        import google.generativeai as genai

        self.model_name = model or os.getenv("CLOUD_MODEL", "gemini-2.5-flash")
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")

        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not set in .env — required for gemini backend.")

        genai.configure(api_key=self.api_key)
        self._genai = genai
        logger.info(f"[LLM] Gemini client ready — model={self.model_name}")

    def backend_name(self) -> str:
        return f"gemini:{self.model_name}"

    async def generate(self, prompt: str, image_b64: Optional[str] = None) -> str:
        model = self._genai.GenerativeModel(self.model_name)

        if image_b64:
            # Gemini vision: pass image as Part
            import PIL.Image
            import io

            image_bytes = base64.b64decode(image_b64)
            image = PIL.Image.open(io.BytesIO(image_bytes))
            response = await model.generate_content_async([prompt, image])
        else:
            response = await model.generate_content_async(prompt)

        return response.text.strip()


# ---------------------------------------------------------------------------
# Factory — returns the correct client based on .env settings
# ---------------------------------------------------------------------------

_client_instance: Optional[LLMClient] = None


def get_llm_client(force_backend: Optional[str] = None) -> LLMClient:
    """
    Returns a singleton LLM client based on LLM_BACKEND env var.

    LLM_BACKEND=ollama  → OllamaClient (local Qwen 3.5 9B)
    LLM_BACKEND=gemini  → GeminiClient (cloud Gemini/Gemma API)

    To switch to Gemma 4 31B API, set in .env:
        LLM_BACKEND=gemini
        CLOUD_MODEL=gemma-4-31b-it
    """
    global _client_instance

    # Allow forcing a backend (useful for tests)
    backend = force_backend or os.getenv("LLM_BACKEND", "ollama").lower()

    # Only create once (singleton)
    if _client_instance is not None:
        return _client_instance

    if backend == "ollama":
        _client_instance = OllamaClient(
            model=os.getenv("OLLAMA_MODEL", "seba-tutor"),
            host=os.getenv("OLLAMA_HOST", "http://localhost:11434"),
            timeout=int(os.getenv("OLLAMA_TIMEOUT", "120")),
        )
    elif backend == "gemini":
        _client_instance = GeminiClient(
            model=os.getenv("CLOUD_MODEL", "gemini-2.5-flash"),
            api_key=os.getenv("GEMINI_API_KEY"),
        )
    else:
        raise ValueError(
            f"Unknown LLM_BACKEND='{backend}'. Use 'ollama' or 'gemini'."
        )

    logger.info(f"[LLM] Using backend: {_client_instance.backend_name()}")
    return _client_instance


def reset_llm_client():
    """Force re-creation of the client (e.g., after .env changes in tests)."""
    global _client_instance
    _client_instance = None
