import os
from typing import List


class ThaiTranslator:
    """Adapter around a local Hugging Face translation model.

    Defaults to NLLB distilled because it supports many source languages. Keep
    this class isolated if you want to swap in Argos Translate or a smaller
    language-specific model later.
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

    def __init__(self) -> None:
        self._tokenizer = None
        self._model = None
        self._pipeline = None
        self.model_name = os.getenv("TRANSLATION_MODEL", "facebook/nllb-200-distilled-600M")
        self.max_chunk_chars = int(os.getenv("TRANSLATION_MAX_CHUNK_CHARS", "1200"))

    def _load(self):
        if self._pipeline is None:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, pipeline

            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(self.model_name)
            self._pipeline = pipeline("translation", model=self._model, tokenizer=self._tokenizer)
        return self._pipeline

    def translate(self, text: str, source_language: str) -> str:
        if not text.strip():
            return ""
        if source_language == "th":
            return text

        pipe = self._load()
        src_lang = self.NLLB_CODES.get(source_language, "eng_Latn")

        if hasattr(self._tokenizer, "src_lang"):
            self._tokenizer.src_lang = src_lang

        translated_chunks = []
        for chunk in self._chunk_text(text):
            result = pipe(
                chunk,
                src_lang=src_lang,
                tgt_lang="tha_Thai",
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
