from typing import List, Optional

from pydantic import BaseModel


class SegmentOut(BaseModel):
    start: float
    end: float
    text: str


class TranscriptionResponse(BaseModel):
    source_type: str
    source_url: Optional[str] = None
    video_title: Optional[str] = None
    detected_language: str
    transcript: str
    translation_thai: str
    segments: List[SegmentOut]


class ChunkTranscriptionResponse(BaseModel):
    chunk_id: str
    detected_language: str
    transcript: str
    translation_thai: str
    segments: List[SegmentOut]
