"""Optional SMTP email delivery, used only to notify a user by email when one of their
armed price/RSI alerts triggers (see routers/alerts.py, alert_service.py, and
main.py's _auto_refresh_loop). Deliberately a soft dependency, same philosophy as
Sentry/Redis elsewhere in this app: with smtp_host unset (the default), send_email()
is a no-op rather than raising, so the app behaves identically configured or not — a
triggered alert always still lands on the in-app "alerts" WebSocket channel regardless
of whether email is set up.
"""

import html
import logging
import smtplib
from email.message import EmailMessage

from config import settings

logger = logging.getLogger("uvicorn.error")


def is_configured() -> bool:
    return bool(settings.smtp_host)


def _render_email_shell(title: str, intro: str, body_html: str) -> str:
    """Wraps `body_html` in a small branded HTML shell matching the app's own dark/gold
    palette (--bg/--primary in frontend/index.css) — a dark header bar with the app
    name and a gold accent, a white content card, plain-text-safe layout tables rather
    than flexbox/grid (email clients' CSS support is far behind browsers'), and a
    system font stack (Google Fonts isn't reliably loaded by email clients, unlike in
    the app itself).
    """
    return f"""\
<!DOCTYPE html>
<html lang="tr">
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;width:100%;">
        <tr>
          <td style="background:#0a0e14;padding:20px 28px;">
            <span style="color:#c9a15f;font-size:18px;font-weight:600;letter-spacing:0.3px;">Portföy Analiz</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <h1 style="margin:0 0 12px;font-size:20px;color:#0a0e14;">{html.escape(title)}</h1>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#444;">{html.escape(intro)}</p>
            {body_html}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background:#f4f5f7;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#888;">
              Bu e-posta Portföy Analiz uygulaması bildirim tercihleriniz uyarınca gönderildi.
              Tercihlerinizi Hesap Ayarları &gt; Bildirimler bölümünden değiştirebilirsiniz.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def send_email(to_address: str, subject: str, body: str, html_body: str | None = None) -> bool:
    """Best-effort send. Returns whether it actually sent — callers should treat a
    False return as "email notification skipped", never as a reason to fail the
    caller's own operation (an alert still triggered and is still visible in-app
    even if this returns False). When `html_body` is given, sends a proper
    multipart/alternative message (plain-text `body` as the fallback part, `html_body`
    as the rendered one) via stdlib EmailMessage.add_alternative — every mail client
    picks whichever part it can render, no third-party mail library needed.
    """
    if not is_configured():
        return False

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from_address
    message["To"] = to_address
    message.set_content(body)
    if html_body is not None:
        message.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
        return True
    except Exception as exc:
        logger.warning("email send to %s failed: %s", to_address, exc)
        return False


def send_verification_email(to_address: str, verify_url: str) -> bool:
    subject = "[Portföy Analiz] E-posta adresini doğrula"
    intro = "Hesabınızı oluşturduğunuz için teşekkürler. Bu e-posta adresinin size ait olduğunu doğrulamak için aşağıdaki bağlantıya tıklayın."
    body = f"{intro}\n\n{verify_url}\n\nBu bağlantı 24 saat içinde geçerliliğini yitirir."
    body_html = (
        f'<p style="margin:0 0 20px;"><a href="{html.escape(verify_url)}" '
        f'style="display:inline-block;background:#c9a15f;color:#0a0e14;text-decoration:none;'
        f'font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">E-postamı Doğrula</a></p>'
        f'<p style="margin:0;font-size:12px;color:#888;">Bağlantı 24 saat içinde geçerliliğini yitirir. '
        f'Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>'
    )
    html_body = _render_email_shell("E-posta Adresini Doğrula", intro, body_html)
    return send_email(to_address, subject, body, html_body)


def send_password_reset_email(to_address: str, reset_url: str) -> bool:
    subject = "[Portföy Analiz] Şifre sıfırlama isteği"
    intro = (
        "Hesabınız için bir şifre sıfırlama isteği aldık. Şifrenizi sıfırlamak için "
        "aşağıdaki bağlantıya tıklayın."
    )
    body = (
        f"{intro}\n\n{reset_url}\n\nBu bağlantı 30 dakika içinde geçerliliğini yitirir.\n\n"
        "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; hesabınızda hiçbir "
        "değişiklik yapılmayacaktır."
    )
    body_html = (
        f'<p style="margin:0 0 20px;"><a href="{html.escape(reset_url)}" '
        f'style="display:inline-block;background:#c9a15f;color:#0a0e14;text-decoration:none;'
        f'font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Şifremi Sıfırla</a></p>'
        f'<p style="margin:0;font-size:12px;color:#888;">Bağlantı 30 dakika içinde geçerliliğini yitirir. '
        f'Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; hesabınızda hiçbir '
        f'değişiklik yapılmayacaktır.</p>'
    )
    html_body = _render_email_shell("Şifreni Sıfırla", intro, body_html)
    return send_email(to_address, subject, body, html_body)


def send_alert_triggered_email(to_address: str, ticker: str, condition: str, threshold: float) -> bool:
    condition_labels = {
        "price_above": f"fiyat {threshold} üzerine çıktı",
        "price_below": f"fiyat {threshold} altına indi",
        "rsi_above": f"RSI {threshold} üzerine çıktı",
        "rsi_below": f"RSI {threshold} altına indi",
    }
    description = condition_labels.get(condition, f"{condition} eşiği ({threshold}) gerçekleşti")
    subject = f"[Portföy Analiz] {ticker} uyarınız tetiklendi"
    intro = f"{ticker} için kurduğunuz uyarı tetiklendi: {description}."
    body = f"{intro}\n\nDetayları görüntülemek için uygulamadaki Uyarılar sayfasını ziyaret edin."
    body_html = (
        f'<p style="margin:0;font-size:14px;color:#0a0e14;">'
        f'<strong>{html.escape(ticker)}</strong> — {html.escape(description)}</p>'
    )
    html_body = _render_email_shell("Fiyat Uyarısı Tetiklendi", intro, body_html)
    return send_email(to_address, subject, body, html_body)


def send_portfolio_digest_email(to_address: str, frequency_label: str, portfolios: list[dict]) -> bool:
    """`portfolios` is a list of {name, period_return_percent, best_ticker,
    best_return_percent, worst_ticker, worst_return_percent} dicts, one per portfolio
    the user owns — see services/digest_service.build_digest_content, which computes
    these from the same analysis_service machinery /portfolios/{id}/analysis already
    uses, not a separate calculation.
    """
    subject = f"[Portföy Analiz] {frequency_label} Portföy Özeti"
    intro = f"{frequency_label.lower()} portföy performans özetiniz aşağıdadır."

    text_lines = [intro, ""]
    table_rows = []
    for p in portfolios:
        sign = "+" if p["period_return_percent"] >= 0 else ""
        text_lines.append(
            f"- {p['name']}: {sign}{p['period_return_percent']:.2f}% "
            f"(en iyi: {p['best_ticker']} {p['best_return_percent']:+.2f}%, "
            f"en kötü: {p['worst_ticker']} {p['worst_return_percent']:+.2f}%)"
        )
        color = "#1a8f4c" if p["period_return_percent"] >= 0 else "#d1453b"
        table_rows.append(
            f'<tr>'
            f'<td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#0a0e14;">{html.escape(p["name"])}</td>'
            f'<td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:{color};text-align:right;">{sign}{p["period_return_percent"]:.2f}%</td>'
            f'<td style="padding:10px 0;border-bottom:1px solid #eee;font-size:12px;color:#666;text-align:right;">↑ {html.escape(p["best_ticker"])} · ↓ {html.escape(p["worst_ticker"])}</td>'
            f'</tr>'
        )

    body = "\n".join(text_lines)
    body_html = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        '<tr><th align="left" style="font-size:12px;color:#888;padding-bottom:8px;">Portföy</th>'
        '<th align="right" style="font-size:12px;color:#888;padding-bottom:8px;">Getiri</th>'
        '<th align="right" style="font-size:12px;color:#888;padding-bottom:8px;">En iyi / en kötü</th></tr>'
        + "".join(table_rows)
        + "</table>"
    )
    html_body = _render_email_shell(f"{frequency_label} Portföy Özeti", intro, body_html)
    return send_email(to_address, subject, body, html_body)
