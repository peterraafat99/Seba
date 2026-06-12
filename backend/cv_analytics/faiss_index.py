"""
FAISS Index Manager
====================
Builds and manages a per-classroom FAISS IndexFlatIP (inner product = cosine
similarity for L2-normalized vectors) loaded from the database at session start.

Why IndexFlatIP:
  InsightFace normed_embedding is already L2-normalized (||v|| = 1).
  For unit vectors, inner product = cosine similarity.
  A score > RECOGNITION_THRESHOLD means "same person".

Lifecycle:
  index = ClassFAISSIndex(classroom_id=5, db=session)
  index.build()         # loads all StudentFaceProfiles for enrolled students
  student_id = index.query(embedding)
  index.release()       # free memory
"""

from __future__ import annotations

import base64
import json
import logging
import pickle
from typing import Dict, List, Optional, Tuple

import numpy as np

from cv_analytics.config import EMBEDDING_DIM, RECOGNITION_THRESHOLD

logger = logging.getLogger(__name__)


class ClassFAISSIndex:
    """
    Per-classroom FAISS index containing face embeddings for enrolled students only.

    Parameters
    ----------
    classroom_id : int
        Physical classroom ID. Used to query the student roster.
    db : SQLAlchemy Session
        Database session for loading StudentFaceProfiles.
    """

    def __init__(self, classroom_id: int, db):
        self.classroom_id = classroom_id
        self._db = db
        self._index = None
        self._id_map: List[str] = []   # index position → student_id string
        self._built = False

    # ------------------------------------------------------------------
    # Build
    # ------------------------------------------------------------------

    def build(self) -> int:
        """
        Load face embeddings from DB for all active students in this classroom.

        Returns
        -------
        int : number of students indexed (0 if classroom has no face profiles)
        """
        try:
            import faiss
        except ImportError:
            raise ImportError(
                "faiss-cpu is not installed. Run: pip install faiss-cpu"
            )

        from models import ClassroomStudent, StudentFaceProfile

        # Step 1: Get active student IDs for this classroom
        roster = (
            self._db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == self.classroom_id,
                ClassroomStudent.is_active == True,
            )
            .all()
        )
        student_ids = [str(row.student_id) for row in roster]
        logger.info(
            f"[FAISS] Classroom {self.classroom_id}: {len(student_ids)} students on roster."
        )

        if not student_ids:
            self._index = faiss.IndexFlatIP(EMBEDDING_DIM)
            self._built = True
            return 0

        # Step 2: Load face profiles for students who have enrolled faces
        profiles = (
            self._db.query(StudentFaceProfile)
            .filter(
                StudentFaceProfile.student_id.in_(
                    [int(sid) for sid in student_ids]
                )
            )
            .all()
        )

        if not profiles:
            logger.warning(
                f"[FAISS] No face profiles found for classroom {self.classroom_id}. "
                "All detections will be labelled UNKNOWN until faces are enrolled."
            )
            self._index = faiss.IndexFlatIP(EMBEDDING_DIM)
            self._built = True
            return 0

        # Step 3: Decode embeddings and build index
        embeddings: List[np.ndarray] = []
        self._id_map = []

        for profile in profiles:
            try:
                emb = self._decode_embedding(profile.embedding)
                if emb is not None and emb.shape == (EMBEDDING_DIM,):
                    embeddings.append(emb)
                    self._id_map.append(str(profile.student_id))
                else:
                    logger.warning(
                        f"[FAISS] Invalid embedding for student {profile.student_id}, skipping."
                    )
            except Exception as e:
                logger.error(
                    f"[FAISS] Failed to decode embedding for student {profile.student_id}: {e}"
                )

        if not embeddings:
            self._index = faiss.IndexFlatIP(EMBEDDING_DIM)
            self._built = True
            return 0

        matrix = np.vstack(embeddings).astype(np.float32)

        # Ensure all embeddings are unit-normalized (InsightFace already does this,
        # but we normalize again as a safety measure)
        faiss.normalize_L2(matrix)

        self._index = faiss.IndexFlatIP(EMBEDDING_DIM)
        self._index.add(matrix)
        self._built = True

        logger.info(
            f"[FAISS] Index built: {len(embeddings)} face profiles indexed "
            f"for classroom {self.classroom_id}."
        )
        return len(embeddings)

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def query(self, embedding: np.ndarray) -> Tuple[Optional[str], float]:
        """
        Find the best matching student for a given face embedding.

        Parameters
        ----------
        embedding : np.ndarray
            512-d L2-normalized face embedding from InsightFace.

        Returns
        -------
        (student_id, score) — student_id is None if UNKNOWN (score below threshold)
        """
        if not self._built or self._index is None:
            raise RuntimeError("Index not built. Call .build() first.")

        if self._index.ntotal == 0:
            return None, 0.0

        query = embedding.astype(np.float32).reshape(1, -1)

        # Normalize query vector (safety measure)
        try:
            import faiss
            faiss.normalize_L2(query)
        except ImportError:
            norm = np.linalg.norm(query)
            if norm > 0:
                query /= norm

        scores, indices = self._index.search(query, k=1)
        best_score = float(scores[0][0])
        best_idx = int(indices[0][0])

        if best_score >= RECOGNITION_THRESHOLD and 0 <= best_idx < len(self._id_map):
            student_id = self._id_map[best_idx]
            logger.debug(
                f"[FAISS] Match: student={student_id}, score={best_score:.4f}"
            )
            return student_id, best_score
        else:
            logger.debug(f"[FAISS] No match (best score={best_score:.4f})")
            return None, best_score

    def query_batch(
        self, embeddings: List[np.ndarray]
    ) -> List[Tuple[Optional[str], float]]:
        """Batch query for multiple embeddings in one FAISS call."""
        if not embeddings:
            return []
        if self._index is None or self._index.ntotal == 0:
            return [(None, 0.0)] * len(embeddings)

        try:
            import faiss
        except ImportError:
            return [self.query(e) for e in embeddings]

        matrix = np.vstack([e.reshape(1, -1) for e in embeddings]).astype(np.float32)
        faiss.normalize_L2(matrix)
        scores, indices = self._index.search(matrix, k=1)

        results = []
        for i in range(len(embeddings)):
            score = float(scores[i][0])
            idx = int(indices[i][0])
            if score >= RECOGNITION_THRESHOLD and 0 <= idx < len(self._id_map):
                results.append((self._id_map[idx], score))
            else:
                results.append((None, score))
        return results

    # ------------------------------------------------------------------
    # Release
    # ------------------------------------------------------------------

    def release(self) -> None:
        """Free the FAISS index from memory."""
        self._index = None
        self._id_map = []
        self._built = False
        logger.info(f"[FAISS] Index for classroom {self.classroom_id} released.")

    # ------------------------------------------------------------------
    # Embedding Encoding/Decoding (Base64 ↔ numpy)
    # ------------------------------------------------------------------

    @staticmethod
    def encode_embedding(embedding: np.ndarray) -> str:
        """Encode a numpy float32 array to a Base64 string for DB storage."""
        return base64.b64encode(embedding.astype(np.float32).tobytes()).decode("utf-8")

    @staticmethod
    def decode_embedding(encoded: str) -> Optional[np.ndarray]:
        """Decode a Base64 string back to a numpy float32 array."""
        try:
            raw = base64.b64decode(encoded.encode("utf-8"))
            return np.frombuffer(raw, dtype=np.float32).copy()
        except Exception as e:
            logger.error(f"[FAISS] Embedding decode error: {e}")
            return None

    def _decode_embedding(self, encoded: str) -> Optional[np.ndarray]:
        return self.decode_embedding(encoded)
