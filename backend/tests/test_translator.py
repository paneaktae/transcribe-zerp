import unittest

from translator import ThaiTranslator


class FakeTranslator(ThaiTranslator):
    def __init__(self) -> None:
        super().__init__()
        self.calls = []

    def _translate_text(self, text: str, source_language: str, target_language: str) -> str:
        self.calls.append((text, source_language, target_language))
        return f"{source_language}->{target_language}:{text}"


class TranslatePipelineTests(unittest.TestCase):
    def test_english_source_goes_directly_to_thai(self):
        translator = FakeTranslator()

        result = translator.translate_pipeline("Hello world", "en")

        self.assertEqual(result.detected_language, "en")
        self.assertEqual(result.transcript_original, "Hello world")
        self.assertEqual(result.transcript_english, "Hello world")
        self.assertEqual(result.translation_thai, "en->th:Hello world")
        self.assertEqual(result.translation_path, "original_to_thai")
        self.assertEqual(translator.calls, [("Hello world", "en", "th")])

    def test_non_english_source_routes_through_english(self):
        translator = FakeTranslator()

        result = translator.translate_pipeline("Bonjour", "fr")

        self.assertEqual(result.detected_language, "fr")
        self.assertEqual(result.transcript_original, "Bonjour")
        self.assertEqual(result.transcript_english, "fr->en:Bonjour")
        self.assertEqual(result.translation_thai, "en->th:fr->en:Bonjour")
        self.assertEqual(result.translation_path, "original_to_english_to_thai")
        self.assertEqual(translator.calls, [("Bonjour", "fr", "en"), ("fr->en:Bonjour", "en", "th")])

    def test_unknown_language_fallback_warns_and_routes_through_english(self):
        translator = FakeTranslator()

        result = translator.translate_pipeline("Texto", "")

        self.assertEqual(result.detected_language, "unknown")
        self.assertEqual(result.transcript_english, "unknown->en:Texto")
        self.assertEqual(result.translation_thai, "en->th:unknown->en:Texto")
        self.assertEqual(result.translation_path, "original_to_english_to_thai")
        self.assertIn("Language could not be detected reliably", result.warnings[0])

    def test_empty_transcript_returns_empty_outputs(self):
        translator = FakeTranslator()

        result = translator.translate_pipeline("   ", "en")

        self.assertEqual(result.transcript_original, "")
        self.assertEqual(result.transcript_english, "")
        self.assertEqual(result.translation_thai, "")
        self.assertEqual(result.translation_path, "original_to_thai")
        self.assertEqual(translator.calls, [])


if __name__ == "__main__":
    unittest.main()
