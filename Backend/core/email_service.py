"""
core/email_service.py  (NEW — additive, nothing else imports-then-breaks)

Sends transactional emails (verification + password reset) over your Hostinger
mailbox via SMTP. This file is self-contained: it only reads env vars and uses
the Python standard library (smtplib + email), so it adds NO new dependencies.

Required .env vars (Hostinger SMTP — values shown are Hostinger's defaults):
  SMTP_HOST=smtp.hostinger.com
  SMTP_PORT=465                       # 465 = SSL (recommended). 587 = STARTTLS.
  SMTP_USER=support@resuviq-ai.nl     # the full mailbox address
  SMTP_PASSWORD=your-mailbox-password # the password you set in hPanel for the mailbox
  SMTP_FROM=support@resuviq-ai.nl     # what recipients see in "From" (usually = SMTP_USER)
  SMTP_FROM_NAME=Resuviq AI           # display name in the From header
  FRONTEND_URL=https://resuviq-ai.nl  # used to build the links inside the emails

Design notes:
  - All sends are best-effort and wrapped so a mail failure NEVER 500s an auth
    route in a way that leaks internals; callers decide how to react.
  - We never reveal whether an address exists (anti-enumeration) — that policy
    lives in the routes, not here.
"""

import os
import ssl
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from dotenv import load_dotenv

load_dotenv()

SMTP_HOST      = os.getenv("SMTP_HOST", "smtp.hostinger.com")
SMTP_PORT      = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER      = os.getenv("SMTP_USER", "")
SMTP_PASSWORD  = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM      = os.getenv("SMTP_FROM", SMTP_USER or "support@resuviq-ai.nl")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Resuviq AI")
FRONTEND_URL   = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

BRAND = "Resuviq AI"


# ── Low-level send ────────────────────────────────────────────────────────────

def _send(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """
    Send a single multipart (text + html) email. Returns True on success, False
    on any failure (and logs the reason). Raises nothing to the caller.
    """
    if not SMTP_USER or not SMTP_PASSWORD:
        print("[email_service] SMTP_USER / SMTP_PASSWORD not configured — email NOT sent.")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = formataddr((SMTP_FROM_NAME, SMTP_FROM))
    msg["To"]      = to_email
    msg.set_content(text_body)                       # plain-text fallback
    msg.add_alternative(html_body, subtype="html")   # rich version

    try:
        if SMTP_PORT == 465:
            # Implicit SSL (Hostinger recommended).
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=20) as server:
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        else:
            # STARTTLS (e.g. port 587).
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.send_message(msg)
        return True
    except Exception as e:
        print(f"[email_service] Failed to send '{subject}' to {to_email}: {e}")
        return False


# ── Shared HTML shell ─────────────────────────────────────────────────────────

def _wrap(title: str, intro: str, button_label: str, button_url: str, footer_note: str) -> str:
    return f"""\
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0C1318;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0C1318;padding:32px 0;">
      <tr><td align="center">
        <table width="100%" style="max-width:480px;background:#111A21;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;">
            <div style="font-size:20px;font-weight:700;color:#00E87A;">{BRAND}</div>
          </td></tr>
          <tr><td style="padding:8px 32px 4px;">
            <h1 style="margin:0;font-size:20px;color:#EDF6F2;">{title}</h1>
          </td></tr>
          <tr><td style="padding:8px 32px 0;color:#9FB3AD;font-size:14px;line-height:22px;">
            {intro}
          </td></tr>
          <tr><td style="padding:24px 32px;">
            <a href="{button_url}" style="display:inline-block;background:linear-gradient(135deg,#00E87A,#00C9FF);color:#0C1318;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;">{button_label}</a>
          </td></tr>
          <tr><td style="padding:0 32px 8px;color:#5E7068;font-size:12px;line-height:18px;">
            Or copy and paste this link into your browser:<br>
            <a href="{button_url}" style="color:#00C9FF;word-break:break-all;">{button_url}</a>
          </td></tr>
          <tr><td style="padding:16px 32px 28px;color:#5E7068;font-size:12px;line-height:18px;border-top:1px solid rgba(255,255,255,0.06);">
            {footer_note}
          </td></tr>
        </table>
        <div style="color:#3E4C46;font-size:11px;margin-top:16px;">© {BRAND} · support@resuviq-ai.nl</div>
      </td></tr>
    </table>
  </body>
</html>"""


# ── Public: verification email ────────────────────────────────────────────────

def send_verification_email(to_email: str, token: str) -> bool:
    link = f"{FRONTEND_URL}/verify-email?token={token}"
    subject = f"Verify your {BRAND} email"
    html = _wrap(
        title="Confirm your email",
        intro=f"Welcome to {BRAND}! Please confirm this is your email address to activate your account and sign in.",
        button_label="Verify email",
        button_url=link,
        footer_note="This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.",
    )
    text = (
        f"Welcome to {BRAND}!\n\n"
        f"Verify your email by opening this link (expires in 24 hours):\n{link}\n\n"
        f"If you didn't create an account, ignore this email."
    )
    return _send(to_email, subject, html, text)


# ── Public: password reset email ──────────────────────────────────────────────

def send_password_reset_email(to_email: str, token: str) -> bool:
    link = f"{FRONTEND_URL}/reset-password?token={token}"
    subject = f"Reset your {BRAND} password"
    html = _wrap(
        title="Reset your password",
        intro="We received a request to reset your password. Click the button below to choose a new one.",
        button_label="Reset password",
        button_url=link,
        footer_note="This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email — your password won't change.",
    )
    text = (
        f"Reset your {BRAND} password using this link (expires in 1 hour):\n{link}\n\n"
        f"If you didn't request this, ignore this email."
    )
    return _send(to_email, subject, html, text)


# ── Shared HTML shell WITHOUT a button (for informational emails) ─────────────

def _wrap_plain(title: str, body_html: str, footer_note: str) -> str:
    return f"""\
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0C1318;font-family:Arial,Helvetica,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0C1318;padding:32px 0;">
      <tr><td align="center">
        <table width="100%" style="max-width:480px;background:#111A21;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
          <tr><td style="padding:28px 32px 8px;">
            <div style="font-size:20px;font-weight:700;color:#00E87A;">{BRAND}</div>
          </td></tr>
          <tr><td style="padding:8px 32px 4px;">
            <h1 style="margin:0;font-size:20px;color:#EDF6F2;">{title}</h1>
          </td></tr>
          <tr><td style="padding:8px 32px 20px;color:#9FB3AD;font-size:14px;line-height:22px;">
            {body_html}
          </td></tr>
          <tr><td style="padding:16px 32px 28px;color:#5E7068;font-size:12px;line-height:18px;border-top:1px solid rgba(255,255,255,0.06);">
            {footer_note}
          </td></tr>
        </table>
        <div style="color:#3E4C46;font-size:11px;margin-top:16px;">© {BRAND} · support@resuviq-ai.nl</div>
      </td></tr>
    </table>
  </body>
</html>"""


# ── Public: account-deletion / goodbye email ─────────────────────────────────

def send_goodbye_email(to_email: str) -> bool:
    subject = f"Your {BRAND} account has been deleted"
    body_html = (
        "Your account and associated data have been permanently deleted, as you "
        "requested. We're sorry to see you go.<br><br>"
        "If this wasn't you, or you change your mind, you're always welcome back — "
        f"just sign up again any time at <a href=\"{FRONTEND_URL}\" style=\"color:#00C9FF;\">{FRONTEND_URL}</a>.<br><br>"
        "Before you go — if there's anything we could have done better, we'd "
        "truly love to hear it. Just reply to this email or write to us at "
        "<a href=\"mailto:support@resuviq-ai.nl\" style=\"color:#00C9FF;\">support@resuviq-ai.nl</a>, "
        "and we'll use your feedback to improve.<br><br>"
        "Thank you for having given us a try. We'd love to have you again."
    )
    html = _wrap_plain(
        title="We're sorry to see you go",
        body_html=body_html,
        footer_note="This is a confirmation that your account was deleted. No further action is needed. If you have questions, reach us at support@resuviq-ai.nl.",
    )
    text = (
        f"Your {BRAND} account and data have been permanently deleted, as requested.\n\n"
        f"We're sorry to see you go. You're always welcome back — sign up again any time at {FRONTEND_URL}.\n\n"
        f"Before you go — if there's anything we could have done better, we'd love to hear it. "
        f"Just reply to this email or write to support@resuviq-ai.nl, and we'll use your feedback to improve.\n\n"
        f"Thank you for having given us a try.\n\n"
        f"Questions? support@resuviq-ai.nl"
    )
    return _send(to_email, subject, html, text)

# ── Public: manual iDEAL payment-link email ───────────────────────────────────
# Sent by the admin (you) from the iDEAL admin panel after a user requests Pro
# and you've created a Tikkie/iDEAL link for them. Delivers the link with the
# price + 30-day terms. This is an explicit, admin-triggered action — never
# automatic.

def send_payment_link_email(to_email: str, payment_url: str, amount_eur: int, period_days: int = 30, link_expires: str | None = None) -> bool:
    subject = f"Your {BRAND} Pro payment link"
    expiry_line = (
        f" This payment link is valid until <b>{link_expires}</b> — please pay before "
        f"then, otherwise you'll need to request a new link."
        if link_expires else ""
    )
    html = _wrap(
        title="Your Pro payment link is ready",
        intro=(
            f"Thanks for requesting {BRAND} Pro! Use the secure iDEAL link below "
            f"to pay €{amount_eur} for {period_days} days of Pro. Your Pro features "
            f"are activated as soon as we confirm your payment.{expiry_line}"
        ),
        button_label=f"Pay €{amount_eur} with iDEAL",
        button_url=payment_url,
        footer_note=(
            f"This grants {period_days} days of Pro access and does not renew "
            f"automatically."
            + (f" Payment link valid until {link_expires}." if link_expires else "")
            + " If you didn't request this, you can ignore this email."
        ),
    )
    text = (
        f"Thanks for requesting {BRAND} Pro!\n\n"
        f"Pay €{amount_eur} for {period_days} days of Pro using this iDEAL link:\n{payment_url}\n\n"
        + (f"This link is valid until {link_expires}. If you don't pay before then, "
           f"you'll need to request a new link.\n\n" if link_expires else "")
        + f"Your Pro features activate as soon as we confirm your payment. "
        f"This does not renew automatically.\n\n"
        f"Questions? support@resuviq-ai.nl"
    )
    return _send(to_email, subject, html, text)


# ── Public: Pro activated confirmation email ──────────────────────────────────
# Sent by the admin confirm step once a manual iDEAL payment is verified and Pro
# has been granted. Lets the user know their access is live.

def send_pro_activated_email(to_email: str, period_days: int = 30, period_end: str | None = None) -> bool:
    subject = f"You're Pro on {BRAND}! 🎉"
    end_line = (
        f"Your Pro access is active until <b>{period_end}</b>."
        if period_end else
        f"Your Pro access is active for the next {period_days} days."
    )
    html = _wrap(
        title="Welcome to Pro — you're all set!",
        intro=(
            f"Your payment is confirmed and your {BRAND} Pro access is now live. "
            f"{end_line} Enjoy the full service — AI resume rewriting, cover and "
            f"motivation letters, PDF export, unlimited refreshes, and more job "
            f"matches. Thank you for your support!"
        ),
        button_label="Open Resuviq AI",
        button_url=FRONTEND_URL,
        footer_note=(
            f"This Pro period lasts {period_days} days and does not renew "
            f"automatically — we'll be in touch when it's time to extend."
        ),
    )
    text = (
        f"You're Pro on {BRAND}!\n\n"
        f"Your payment is confirmed and your Pro access is now live. "
        f"{'Active until ' + period_end + '.' if period_end else f'Active for the next {period_days} days.'}\n\n"
        f"Enjoy the full service — AI resume rewriting, cover & motivation letters, "
        f"PDF export, unlimited refreshes, and more job matches.\n\n"
        f"Open {BRAND}: {FRONTEND_URL}\n\n"
        f"This Pro period lasts {period_days} days and does not renew automatically.\n\n"
        f"Questions? support@resuviq-ai.nl"
    )
    return _send(to_email, subject, html, text)
