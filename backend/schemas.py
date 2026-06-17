from typing import List, Optional

from pydantic import BaseModel, Field


class RawSegment(BaseModel):
    start: float
    end: float
    text: str


class SegmentOut(BaseModel):
    start: float
    end: float
    text_original: str
    text_english: str
    text_thai: str


class TranscriptionResponse(BaseModel):
    source_type: str
    source_url: Optional[str] = None
    video_title: Optional[str] = None
    detected_language: str
    transcript_original: str
    transcript_english: str
    translation_thai: str
    translation_path: str
    warnings: List[str] = Field(default_factory=list)
    segments: List[SegmentOut]


class ChunkTranscriptionResponse(BaseModel):
    chunk_id: str
    detected_language: str
    transcript_original: str
    transcript_english: str
    translation_thai: str
    translation_path: str
    warnings: List[str] = Field(default_factory=list)
    segments: List[SegmentOut]
