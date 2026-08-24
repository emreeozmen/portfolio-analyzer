from config import Settings


def test_cors_origins_list_splits_and_trims():
    settings = Settings(cors_origins="http://localhost:5173, https://app.example.com ,http://x.test")
    assert settings.cors_origins_list == ["http://localhost:5173", "https://app.example.com", "http://x.test"]


def test_cors_origins_list_defaults_to_local_dev_server():
    settings = Settings()
    assert settings.cors_origins_list == ["http://localhost:5173"]


def test_cors_origins_list_ignores_empty_entries():
    settings = Settings(cors_origins="http://localhost:5173,,")
    assert settings.cors_origins_list == ["http://localhost:5173"]
