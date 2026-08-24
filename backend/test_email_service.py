from unittest.mock import MagicMock, patch

from services import email_service


def test_send_email_is_noop_when_smtp_not_configured():
    with patch.object(email_service.settings, "smtp_host", ""):
        assert email_service.is_configured() is False
        assert email_service.send_email("user@example.com", "subject", "body") is False


def test_send_email_uses_smtp_and_starttls_when_configured():
    mock_server = MagicMock()
    mock_smtp_cls = MagicMock()
    mock_smtp_cls.return_value.__enter__.return_value = mock_server

    with (
        patch.object(email_service.settings, "smtp_host", "smtp.example.com"),
        patch.object(email_service.settings, "smtp_username", "user"),
        patch.object(email_service.settings, "smtp_password", "pass"),
        patch.object(email_service.settings, "smtp_use_tls", True),
        patch.object(email_service.smtplib, "SMTP", mock_smtp_cls),
    ):
        sent = email_service.send_email("user@example.com", "Subject", "Body")

    assert sent is True
    mock_server.starttls.assert_called_once()
    mock_server.login.assert_called_once_with("user", "pass")
    mock_server.send_message.assert_called_once()


def test_send_email_returns_false_on_smtp_error():
    mock_smtp_cls = MagicMock(side_effect=OSError("connection refused"))

    with (
        patch.object(email_service.settings, "smtp_host", "smtp.example.com"),
        patch.object(email_service.smtplib, "SMTP", mock_smtp_cls),
    ):
        assert email_service.send_email("user@example.com", "Subject", "Body") is False


def test_send_alert_triggered_email_builds_turkish_body():
    with (
        patch.object(email_service.settings, "smtp_host", "smtp.example.com"),
        patch.object(email_service, "send_email", return_value=True) as mock_send,
    ):
        result = email_service.send_alert_triggered_email("user@example.com", "THYAO", "price_above", 250.0)

    assert result is True
    args, _ = mock_send.call_args
    assert args[0] == "user@example.com"
    assert "THYAO" in args[1]
    assert "250" in args[2]


def test_send_alert_triggered_email_passes_html_alternative():
    with (
        patch.object(email_service.settings, "smtp_host", "smtp.example.com"),
        patch.object(email_service, "send_email", return_value=True) as mock_send,
    ):
        email_service.send_alert_triggered_email("user@example.com", "THYAO", "price_above", 250.0)

    args, _ = mock_send.call_args
    html_body = args[3]
    assert "THYAO" in html_body
    assert "<html" in html_body


def test_send_email_with_html_body_adds_alternative_part():
    mock_server = MagicMock()
    mock_smtp_cls = MagicMock()
    mock_smtp_cls.return_value.__enter__.return_value = mock_server

    with (
        patch.object(email_service.settings, "smtp_host", "smtp.example.com"),
        patch.object(email_service.smtplib, "SMTP", mock_smtp_cls),
    ):
        sent = email_service.send_email("user@example.com", "Subject", "Plain body", "<html><body>Hi</body></html>")

    assert sent is True
    sent_message = mock_server.send_message.call_args[0][0]
    assert sent_message.is_multipart()
    payloads = [part.get_content_type() for part in sent_message.walk()]
    assert "text/html" in payloads
    assert "text/plain" in payloads


def test_render_email_shell_escapes_html_in_title_and_intro():
    rendered = email_service._render_email_shell("<script>alert(1)</script>", "intro & more", "<p>body</p>")
    assert "<script>alert(1)</script>" not in rendered
    assert "&lt;script&gt;" in rendered
    assert "&amp;" in rendered


def test_send_portfolio_digest_email_builds_summary():
    portfolios = [
        {
            "name": "Ana Portföy",
            "period_return_percent": 3.25,
            "best_ticker": "THYAO",
            "best_return_percent": 5.1,
            "worst_ticker": "ASELS",
            "worst_return_percent": -1.2,
        }
    ]
    with (
        patch.object(email_service.settings, "smtp_host", "smtp.example.com"),
        patch.object(email_service, "send_email", return_value=True) as mock_send,
    ):
        result = email_service.send_portfolio_digest_email("user@example.com", "Haftalık", portfolios)

    assert result is True
    args, _ = mock_send.call_args
    assert "Haftalık" in args[1]
    assert "Ana Portföy" in args[2]
    assert "THYAO" in args[3]
