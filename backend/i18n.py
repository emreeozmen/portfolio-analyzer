"""Best-effort localization of backend-originated, user-facing error messages into
English. The rest of this app's error messages are written in Turkish at the point
they're raised (deep in services/*.py) — restructuring every raise site to carry a
translation key + params, the way the frontend's react-i18next setup does, would mean
threading a `lang` parameter through every service function that can fail. Instead,
this module translates a curated set of the most common, *fixed* (non-interpolated)
Turkish error strings at the two places they actually reach the client:
routers/*.py's HTTPException(detail=...) sites (via `localize()`) and Pydantic
field-validator messages (via main.py's RequestValidationError handler).

Known, narrow limitation: messages that interpolate dynamic values (a ticker symbol,
a computed percentage, a yfinance error string, ...) are NOT translated — matching
those would require the raise site itself to carry a message key, which is exactly
the deeper refactor this module deliberately avoids. Those messages are simply shown
in Turkish regardless of the selected UI language. If a commonly-hit error turns out
to be one of these, consider adding a fixed-string variant here or, for a true fix,
threading `lang` into that specific service function.
"""

from fastapi import Header

SUPPORTED_LANGUAGES = {"tr", "en"}


def get_lang(x_lang: str | None = Header(default=None)) -> str:
    """FastAPI dependency: reads the frontend's app-level language choice (see
    frontend's src/api.ts, which sends this on every request from i18next's current
    language) — deliberately not the browser's Accept-Language header, since that
    header can't be set from `fetch()` at all (it's a forbidden header name in the
    Fetch API spec) and wouldn't necessarily match the in-app TR/EN toggle anyway.
    """
    if x_lang and x_lang.lower().startswith("en"):
        return "en"
    return "tr"


# Turkish source string -> English translation. Only fixed strings (no f-string
# interpolation) belong here — see module docstring.
ERROR_TRANSLATIONS: dict[str, str] = {
    "Şifre en az 8 karakter olmalıdır": "Password must be at least 8 characters",
    "Şifre en az bir harf içermelidir": "Password must contain at least one letter",
    "Şifre en az bir rakam içermelidir": "Password must contain at least one digit",
    "Mevcut şifre yanlış": "Current password is incorrect",
    "Şifre yanlış": "Incorrect password",
    "Bu e-posta adresi zaten kullanımda": "This email address is already in use",
    "Geçersiz uyarı koşulu": "Invalid alert condition",
    "Eşik değeri pozitif olmalıdır": "Threshold must be positive",
    "Varlık bulunamadı": "Asset not found",
    "Uyarı bulunamadı": "Alert not found",
    "Varsayılan varlıklar izlemeden çıkarılamaz": "Default assets cannot be removed from your watchlist",
    "Portföyde varlık bulunamadı": "No assets found in portfolio",
    "Geçersiz optimizasyon hedefi": "Invalid optimization objective",
    "Optimizasyon için en az iki varlık gerekir": "Optimization requires at least two assets",
    "Satış kaydı bulunamadı": "Sale record not found",
    "Portföy adı boş olamaz": "Portfolio name cannot be empty",
    "En az bir varlık seçilmelidir": "At least one asset must be selected",
    "Aynı varlık birden fazla kez eklenemez": "The same asset cannot be added more than once",
    "Satış miktarı pozitiften büyük olmalıdır": "Sale quantity must be greater than zero",
    "CSV dosyası boş veya okunamadı": "The CSV file is empty or couldn't be read",
    "Sembol boş olamaz": "Symbol cannot be empty",
    "Miktar ve fiyat pozitif olmalıdır": "Quantity and price must be positive",
}


def localize(message: str, lang: str) -> str:
    """Translates a known fixed Turkish message when lang == "en"; returns the
    message unchanged for Turkish (the source language) or for any message not in
    ERROR_TRANSLATIONS (an untranslated fixed string, or a dynamic/interpolated one —
    see module docstring)."""
    if lang != "en":
        return message
    return ERROR_TRANSLATIONS.get(message, message)
