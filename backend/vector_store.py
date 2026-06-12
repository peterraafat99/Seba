import os
import pickle
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer, CrossEncoder
from rank_bm25 import BM25Okapi

# ---------------------------------------------------------------------------
# Embedding model configuration (Local or Cloud API)
# ---------------------------------------------------------------------------
EMBEDDING_BACKEND = os.getenv("EMBEDDING_BACKEND", "local").lower()

if EMBEDDING_BACKEND == "gemini":
    EMBEDDING_MODEL_NAME = "models/gemini-embedding-001"
    EMBEDDING_DIM = 3072  # gemini-embedding-001 outputs 3072 dimensions
else:
    EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
    EMBEDDING_DIM = 1024  # BGE-M3 output dimension

_embedding_model = None
_genai_configured = False

def get_embedding_model() -> SentenceTransformer:
    """Lazy-load the local embedding model (avoids slowing down server startup)."""
    global _embedding_model
    if _embedding_model is None:
        print(f"⏳ Loading local embedding model: {EMBEDDING_MODEL_NAME} ...")
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME, device="cpu")
        print(f"✅ Embedding model ready  ({EMBEDDING_DIM}-dim, local, no API needed)")
    return _embedding_model


def get_gemini_embeddings(texts: list | str, is_query: bool = False) -> np.ndarray:
    """Fetch embeddings from the Google Generative AI API with automatic rate-limit retries."""
    global _genai_configured
    import google.generativeai as genai
    import time
    from google.api_core.exceptions import ResourceExhausted

    if not _genai_configured:
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        _genai_configured = True

    task_type = "retrieval_query" if is_query else "retrieval_document"

    def embed_with_retry(content_data):
        retries = 6
        delay = 5
        for attempt in range(retries):
            try:
                return genai.embed_content(
                    model=EMBEDDING_MODEL_NAME,
                    content=content_data,
                    task_type=task_type
                )
            except ResourceExhausted as e:
                if attempt == retries - 1:
                    raise e
                print(f"⚠️ Rate limit hit (429). Retrying in {delay} seconds (attempt {attempt+1}/{retries})...")
                time.sleep(delay)
                delay *= 2
            except Exception as e:
                if attempt == retries - 1:
                    raise e
                print(f"⚠️ API error: {e}. Retrying in {delay} seconds (attempt {attempt+1}/{retries})...")
                time.sleep(delay)
                delay *= 2

    if is_query and isinstance(texts, str):
        response = embed_with_retry(texts)
        return np.array([response['embedding']], dtype='float32')
    else:
        # Handle string input or batch list input
        input_list = [texts] if isinstance(texts, str) else texts
        embeddings = []
        # Batch in chunks of 16 (smaller batch size to stay safer under free-tier TPM limits)
        for i in range(0, len(input_list), 16):
            if i > 0:
                print("⏳ Spacing API requests (sleeping 3 seconds)...")
                time.sleep(3)
            batch = input_list[i:i+16]
            response = embed_with_retry(batch)
            # Response returns 'embeddings' list when batch input is provided
            if 'embeddings' in response:
                embeddings.extend(response['embeddings'])
            else:
                embeddings.append(response['embedding'])
        return np.array(embeddings, dtype='float32')


class KnowledgeBase:
    def __init__(self, index_file=None, meta_file=None):
        if index_file is None:
            index_file = "course_index_gemini.faiss" if EMBEDDING_BACKEND == "gemini" else "course_index.faiss"
        if meta_file is None:
            meta_file = "course_meta_gemini.pkl" if EMBEDDING_BACKEND == "gemini" else "course_meta.pkl"

        self.index_file = index_file
        self.meta_file = meta_file

        # Reranking model (lazy-loaded to save RAM)
        self.reranker = None

        self.index = None
        self.metadata = []
        self.bm25 = None

        self._load_index()

    def _load_index(self):
        """Loads FAISS index, metadata, and rebuilds BM25."""
        if os.path.exists(self.index_file) and os.path.exists(self.meta_file):
            self.index = faiss.read_index(self.index_file)
            with open(self.meta_file, "rb") as f:
                self.metadata = pickle.load(f)

            # Detect dimension mismatch (old Gemini 768-dim vs new BGE-M3 1024-dim)
            if self.index.d != EMBEDDING_DIM:
                print(
                    f"⚠️  FAISS index has {self.index.d}-dim embeddings "
                    f"but current model produces {EMBEDDING_DIM}-dim.\n"
                    f"   The old index was built with Gemini embeddings.\n"
                    f"   👉 Run: python build_rag.py   to rebuild with local embeddings."
                )
                # Start fresh so queries don't crash
                self.index = faiss.IndexFlatL2(EMBEDDING_DIM)
                self.metadata = []
            else:
                # Rebuild BM25 from loaded metadata
                tokenized_corpus = [doc['text'].lower().split() for doc in self.metadata]
                self.bm25 = BM25Okapi(tokenized_corpus)
                print(f"✅ Knowledge Base loaded: {len(self.metadata)} chunks  ({EMBEDDING_DIM}-dim, local embeddings)")
        else:
            print(f"⚠️  No FAISS index found. Run: python build_rag.py")
            self.index = faiss.IndexFlatL2(EMBEDDING_DIM)

    def add_lessons(self, lessons_data: list):
        """Embeds lesson chunks locally or via Gemini cloud API and adds them to the FAISS index."""
        if not lessons_data:
            return

        texts = [item['text'] for item in lessons_data]

        if EMBEDDING_BACKEND == "gemini":
            print(f"⏳ Generating Gemini cloud embeddings for {len(texts)} chunks...")
            embeddings = get_gemini_embeddings(texts, is_query=False)
        else:
            model = get_embedding_model()
            print(f"⏳ Generating local embeddings for {len(texts)} chunks...")
            embeddings = model.encode(
                texts,
                normalize_embeddings=True,
                show_progress_bar=True,
                batch_size=4,
            ).astype('float32')

        self.index.add(embeddings)
        self.metadata.extend(lessons_data)

        # Rebuild BM25
        tokenized_corpus = [doc['text'].lower().split() for doc in self.metadata]
        self.bm25 = BM25Okapi(tokenized_corpus)

        self.save()
        print(f"✅ Added {len(lessons_data)} chunks. Knowledge Base ready.")

    def search(self, query: str, course_id: int = None, k=3):
        """Hybrid Search (FAISS vector + BM25 keyword) + Cross-Encoder reranking."""
        if self.index.ntotal == 0:
            return []

        # --- STEP 1: RETRIEVAL ---
        candidates = {}

        # A. Vector Search (semantic)
        if EMBEDDING_BACKEND == "gemini":
            query_vector = get_gemini_embeddings(query, is_query=True)
        else:
            model = get_embedding_model()
            query_vector = model.encode(
                [query],
                normalize_embeddings=True,
            ).astype('float32')

        v_distances, v_indices = self.index.search(query_vector, k=10)

        for idx in v_indices[0]:
            if idx != -1 and idx < len(self.metadata):
                doc = self.metadata[idx]
                if course_id is None or doc.get('course_id') == course_id:
                    candidates[idx] = doc

        # B. Keyword Search (BM25 — unchanged)
        if self.bm25:
            tokenized_query = query.lower().split()
            bm25_docs = self.bm25.get_top_n(tokenized_query, self.metadata, n=10)

            for doc in bm25_docs:
                if course_id is None or doc.get('course_id') == course_id:
                    if doc not in candidates.values():
                        candidates[f"bm25_{len(candidates)}"] = doc

        unique_candidates = list(candidates.values())
        if not unique_candidates:
            return []

        # --- STEP 2: RERANKING (cross-encoder — unchanged) ---
        if self.reranker is None:
            print("⏳ Loading local reranker model (CrossEncoder) on CPU...")
            self.reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2', device="cpu")
            print("✅ Reranker model ready.")

        top_candidates = unique_candidates[:10]
        pairs = [[query, doc['text']] for doc in top_candidates]
        scores = self.reranker.predict(pairs)

        scored_docs = []
        for doc, score in zip(top_candidates, scores):
            new_doc = doc.copy()
            new_doc['rerank_score'] = float(score)
            scored_docs.append(new_doc)

        scored_docs.sort(key=lambda x: x['rerank_score'], reverse=True)
        return scored_docs[:k]

    def save(self):
        """Persist FAISS index and metadata to disk."""
        faiss.write_index(self.index, self.index_file)
        with open(self.meta_file, "wb") as f:
            pickle.dump(self.metadata, f)