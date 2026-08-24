from i18n import ERROR_TRANSLATIONS, get_lang, localize


def test_get_lang_defaults_to_turkish_when_header_missing():
    assert get_lang(None) == "tr"


def test_get_lang_defaults_to_turkish_for_unrelated_header():
    assert get_lang("fr") == "tr"


def test_get_lang_recognizes_english_case_insensitively():
    assert get_lang("en") == "en"
    assert get_lang("EN") == "en"
    assert get_lang("en-US") == "en"


def test_localize_returns_turkish_message_unchanged_for_turkish_lang():
    assert localize("Varlık bulunamadı", "tr") == "Varlık bulunamadı"


def test_localize_translates_known_message_for_english_lang():
    assert localize("Varlık bulunamadı", "en") == "Asset not found"


def test_localize_passes_through_unknown_message_for_english_lang():
    # A dynamic/interpolated message (e.g. containing a ticker) has no dictionary
    # entry — it must be returned as-is rather than raising or returning None.
    unknown = "AKBNK için fiyat verisi bulunamadı"
    assert localize(unknown, "en") == unknown


def test_every_translation_entry_has_a_non_empty_value():
    for turkish, english in ERROR_TRANSLATIONS.items():
        assert turkish.strip() != ""
        assert english.strip() != ""
        assert turkish != english
