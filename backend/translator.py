import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class TranslationResult:
    detected_language: str
    transcript_original: str
    transcript_english: str
    translation_thai: str
    translation_path: str
    warnings: List[str] = field(default_factory=list)


class ThaiTranslator:
    """Pluggable adapter around a local Hugging Face translation model.

    Defaults to NLLB distilled because it supports many source languages. The
    public method is `translate_pipeline`; replace `_translate_text` to swap
    translator backends without changing API code.
    """

    NLLB_CODES = {
        "en": "eng_Latn",
        "th": "tha_Thai",
        "ja": "jpn_Jpan",
        "ko": "kor_Hang",
        "zh": "zho_Hans",
        "fr": "fra_Latn",
        "de": "deu_Latn",
        "es": "spa_Latn",
        "it": "ita_Latn",
        "pt": "por_Latn",
        "ru": "rus_Cyrl",
        "vi": "vie_Latn",
        "id": "ind_Latn",
        "ms": "zsm_Latn",
        "lo": "lao_Laoo",
        "my": "mya_Mymr",
        "km": "khm_Khmr",
        "ar": "arb_Arab",
        "hi": "hin_Deva",
    }

    LANGUAGE_ALIASES = {
        "eng": "en",
        "english": "en",
        "tha": "th",
        "thai": "th",
        "zh-cn": "zh",
        "zh-tw": "zh",
        "cmn": "zh",
        "jpn": "ja",
        "kor": "ko",
        "spa": "es",
        "deu": "de",
        "fra": "fr",
        "fre": "fr",
        "por": "pt",
        "rus": "ru",
    }

    def __init__(self) -> None:
        self._tokenizer = None
        self._model = None
        self._pipeline = None
        self.model_name = os.getenv("TRANSLATION_MODEL", "facebook/nllb-200-distilled-600M")
        self.max_chunk_chars = int(os.getenv("TRANSLATION_MAX_CHUNK_CHARS", "1200"))
        self.min_translate_chars = int(os.getenv("TRANSLATION_MIN_CHARS", "2"))

    def translate_pipeline(self, text: str, source_lang: str) -> TranslationResult:
        original = text.strip()
        normalized_source = self.normalize_language(source_lang)
        warnings: List[str] = []

        if not original:
            return TranslationResult(
                detected_language=normalized_source,
                transcript_original="",
                transcript_english="",
                translation_thai="",
                translation_path="original_to_thai" if normalized_source == "en" else "original_to_english_to_thai",
                warnings=[],
            )

        if len(original) < self.min_translate_chars:
            warnings.append("Transcript too short to translate reliably.")
            return TranslationResult(
                detected_language=normalized_source,
                transcript_original=original,
                transcript_english=original if normalized_source == "en" else "",
                translation_thai="",
                translation_path="original_to_thai" if normalized_source == "en" else "original_to_english_to_thai",
                warnings=warnings,
            )

        if normalized_source == "unknown":
            warnings.append("Language could not be detected reliably; attempted original-to-English first.")

        if normalized_source == "en":
            english = original
            thai = self._translate_text(english, "en", "th")
            path = "original_to_thai"
        else:
            english = self._translate_text(original, normalized_source, "en")
            thai = self._translate_text(english, "en", "th") if english.strip() else ""
            path = "original_to_english_to_thai"

        return TranslationResult(
            detected_language=normalized_source,
            transcript_original=original,
            transcript_english=english,
            translation_thai=thai,
            translation_path=path,
            warnings=warnings,
        )

    def normalize_language(self, source_lang: str) -> str:
        value = (source_lang or "").strip().lower().replace("_", "-")
        if not value or value in {"und", "unknown", "none", "null"}:
            return "unknown"
        value = self.LANGUAGE_ALIASES.get(value, value)
        value = value.split("-")[0]
        if value in self.NLLB_CODES:
            return value
        return "unknown"

    def _load(self):
        if self._pipeline is None:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, pipeline

            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(self.model_name)
            self._pipeline = pipeline("translation", model=self._model, tokenizer=self._tokenizer)
        return self._pipeline

    def _translate_text(self, text: str, source_language: str, target_language: str) -> str:
        if not text.strip():
            return ""
        if source_language == target_language:
            return text.strip()

        pipe = self._load()
        src_lang = self.NLLB_CODES.get(source_language, "eng_Latn")
        tgt_lang = self.NLLB_CODES.get(target_language, "eng_Latn")

        if hasattr(self._tokenizer, "src_lang"):
            self._tokenizer.src_lang = src_lang

        translated_chunks = []
        for chunk in self._chunk_text(text):
            result = pipe(
                chunk,
                src_lang=src_lang,
                tgt_lang=tgt_lang,
                max_length=512,
            )
            translated_chunks.append(result[0]["translation_text"].strip())
        return "\n\n".join(translated_chunks).strip()

    def _chunk_text(self, text: str) -> List[str]:
        paragraphs = [part.strip() for part in text.splitlines() if part.strip()]
        if not paragraphs:
            paragraphs = [text.strip()]

        chunks: List[str] = []
        current = ""
        for paragraph in paragraphs:
            if len(current) + len(paragraph) + 1 <= self.max_chunk_chars:
                current = f"{current}\n{paragraph}".strip()
            else:
                if current:
                    chunks.append(current)
                current = paragraph
        if current:
            chunks.append(current)
        return chunks
