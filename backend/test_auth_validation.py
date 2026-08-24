import pytest
from pydantic import ValidationError

from routers.auth import RegisterRequest, UpdatePasswordRequest


def test_valid_password_accepted():
    req = RegisterRequest(email="user@example.com", password="Secret123")
    assert req.password == "Secret123"


def test_too_short_password_rejected():
    with pytest.raises(ValidationError):
        RegisterRequest(email="user@example.com", password="Ab1")


def test_password_without_digit_rejected():
    with pytest.raises(ValidationError):
        RegisterRequest(email="user@example.com", password="onlyletters")


def test_password_without_letter_rejected():
    with pytest.raises(ValidationError):
        RegisterRequest(email="user@example.com", password="12345678")


def test_update_password_request_enforces_same_strength_rules():
    with pytest.raises(ValidationError):
        UpdatePasswordRequest(current_password="whatever", new_password="short")

    req = UpdatePasswordRequest(current_password="whatever", new_password="Secret123")
    assert req.new_password == "Secret123"
