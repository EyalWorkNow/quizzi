import { randomInt } from 'crypto';
import db from '../db/index.js';
import { getPublicAppUrl, sendMail, type MailDeliveryResult } from './mailer.js';
import { getStudentUserByEmail, hashStudentPassword, normalizeStudentEmail, verifyStudentPassword } from './studentUsers.js';

const RESET_CODE_TTL_MS = 5 * 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

type PasswordResetLocale = 'he' | 'en';

type PasswordResetVerificationResult =
  | { ok: true; studentUser: any; recordId: number }
  | { ok: false; error: 'invalid' | 'expired' | 'too_many_attempts' };

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveLocale(value: string | null | undefined): PasswordResetLocale {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'he' ? 'he' : 'en';
}

function buildResetCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function buildPasswordResetCopy(locale: PasswordResetLocale) {
  if (locale === 'he') {
    return {
      subject: 'קוד לאיפוס סיסמה ב-Quizzi',
      preheader: 'קוד חד-פעמי, תקף ל-5 דקות, כדי לאפס את הסיסמה ולהיכנס חזרה.',
      eyebrow: 'איפוס סיסמה',
      title: 'הקוד שלך לאיפוס סיסמה',
      intro: 'קיבלנו בקשה לאיפוס הסיסמה של חשבון התלמיד ב-Quizzi. אפשר להזין את הקוד הבא כדי לקבוע סיסמה חדשה.',
      expires: 'הקוד תקף ל-5 דקות בלבד.',
      warning: 'אם לא ביקשת לאפס סיסמה, אפשר פשוט להתעלם מהמייל הזה.',
      support: 'אם משהו לא עובד, נסה/י לבקש קוד חדש מתוך מסך ההתחברות.',
    };
  }

  return {
    subject: 'Your Quizzi password reset code',
    preheader: 'A one-time code valid for 5 minutes so you can reset your password and get back in.',
    eyebrow: 'Password reset',
    title: 'Your password reset code',
    intro: 'We received a request to reset the password for your Quizzi student account. Enter the code below to set a new password.',
    expires: 'This code stays active for 5 minutes only.',
    warning: 'If you did not request a password reset, you can safely ignore this email.',
    support: 'If something does not work, request a new code from the sign-in screen.',
  };
}

function buildResetEmailHtml(code: string, locale: PasswordResetLocale) {
  const copy = buildPasswordResetCopy(locale);
  const isRtl = locale === 'he';
  const align = isRtl ? 'right' : 'left';
  const dir = isRtl ? 'rtl' : 'ltr';
  const baseUrl = getPublicAppUrl();

  return `
    <!doctype html>
    <html lang="${locale}" dir="${dir}">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="x-apple-disable-message-reformatting" />
        <title>${escapeHtml(copy.subject)}</title>
      </head>
      <body style="margin:0;padding:0;background:#F7F0E7;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
          ${escapeHtml(copy.preheader)}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F0E7;">
          <tr>
            <td align="center" style="padding:28px 14px 42px 14px;">
              <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:640px;max-width:640px;">
                <tr>
                  <td align="${align}" style="padding:0 0 14px 0;">
                    <img
                      src="${escapeHtml(`${baseUrl}/quizzi-logo-email.svg`)}"
                      alt="Quizzi"
                      width="170"
                      style="display:block;width:170px;max-width:100%;height:auto;border:0;outline:none;"
                    />
                  </td>
                </tr>
                <tr>
                  <td>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border:3px solid #1A1A1A;border-radius:32px;box-shadow:8px 8px 0 0 #1A1A1A;overflow:hidden;">
                      <tr>
                        <td style="padding:28px 30px;background:linear-gradient(135deg,#FFF3D6 0%,#FFFFFF 58%,#F0E7FF 100%);">
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;color:#FF5A36;text-align:${align};margin-bottom:14px;">
                            ${escapeHtml(copy.eyebrow)}
                          </div>
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:34px;line-height:1.1;font-weight:900;color:#1A1A1A;text-align:${align};margin-bottom:14px;">
                            ${escapeHtml(copy.title)}
                          </div>
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.75;font-weight:600;color:#3E3E3E;text-align:${align};margin-bottom:22px;">
                            ${escapeHtml(copy.intro)}
                          </div>
                          <div style="padding:20px 18px;border:2px solid #1A1A1A;border-radius:24px;background:#1A1A1A;text-align:center;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:38px;line-height:1;letter-spacing:0.32em;font-weight:900;color:#FFD13B;">
                              ${escapeHtml(code)}
                            </div>
                          </div>
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;font-weight:800;color:#4C4C4C;text-align:${align};margin-top:18px;">
                            ${escapeHtml(copy.expires)}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:24px 30px 30px 30px;">
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;font-weight:700;color:#1A1A1A;text-align:${align};margin-bottom:10px;">
                            ${escapeHtml(copy.warning)}
                          </div>
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.8;font-weight:700;color:#666666;text-align:${align};">
                            ${escapeHtml(copy.support)}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function buildResetEmailText(code: string, locale: PasswordResetLocale) {
  const copy = buildPasswordResetCopy(locale);
  return [
    copy.title,
    '',
    copy.intro,
    '',
    code,
    '',
    copy.expires,
    copy.warning,
    copy.support,
  ].join('\n');
}

export async function sendStudentPasswordResetCodeEmail({
  email,
  code,
  locale,
}: {
  email: string;
  code: string;
  locale?: string | null;
}): Promise<MailDeliveryResult> {
  const resolvedLocale = resolveLocale(locale);
  const copy = buildPasswordResetCopy(resolvedLocale);
  return sendMail({
    to: email,
    subject: copy.subject,
    html: buildResetEmailHtml(code, resolvedLocale),
    text: buildResetEmailText(code, resolvedLocale),
  });
}

export async function createStudentPasswordResetRequest({
  email,
  locale,
}: {
  email: string;
  locale?: string | null;
}) {
  const normalizedEmail = normalizeStudentEmail(email);
  const studentUser = await getStudentUserByEmail(normalizedEmail);
  if (!studentUser?.id || String(studentUser.status || 'active') !== 'active') {
    return { ok: true, deliveryStatus: 'sent' as const };
  }

  const code = buildResetCode();
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();

  await db
    .prepare(`
      UPDATE student_password_reset_codes
      SET consumed_at = CURRENT_TIMESTAMP
      WHERE student_user_id = ?
        AND consumed_at IS NULL
    `)
    .run(Number(studentUser.id));

  await db
    .prepare(`
      INSERT INTO student_password_reset_codes (
        student_user_id,
        email,
        code_hash,
        attempt_count,
        expires_at
      )
      VALUES (?, ?, ?, 0, ?)
    `)
    .run(
      Number(studentUser.id),
      normalizedEmail,
      hashStudentPassword(code),
      expiresAt,
    );

  const delivery = await sendStudentPasswordResetCodeEmail({
    email: normalizedEmail,
    code,
    locale,
  });

  return {
    ok: delivery.ok,
    deliveryStatus: delivery.deliveryStatus,
    error: delivery.error,
  };
}

export async function verifyStudentPasswordResetCode({
  email,
  code,
}: {
  email: string;
  code: string;
}): Promise<PasswordResetVerificationResult> {
  const normalizedEmail = normalizeStudentEmail(email);
  const studentUser = await getStudentUserByEmail(normalizedEmail);
  if (!studentUser?.id || String(studentUser.status || 'active') !== 'active') {
    return { ok: false, error: 'invalid' };
  }

  const record = (await db
    .prepare(`
      SELECT *
      FROM student_password_reset_codes
      WHERE student_user_id = ?
        AND email = ?
        AND consumed_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(Number(studentUser.id), normalizedEmail)) as any;

  if (!record?.id) {
    return { ok: false, error: 'invalid' };
  }

  const now = Date.now();
  const expiresAt = new Date(String(record.expires_at || '')).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    await db.prepare('UPDATE student_password_reset_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(record.id));
    return { ok: false, error: 'expired' };
  }

  const attempts = Number(record.attempt_count || 0);
  if (attempts >= MAX_RESET_ATTEMPTS) {
    await db.prepare('UPDATE student_password_reset_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(record.id));
    return { ok: false, error: 'too_many_attempts' };
  }

  if (!verifyStudentPassword(String(code || '').trim(), String(record.code_hash || ''))) {
    await db
      .prepare(`
        UPDATE student_password_reset_codes
        SET attempt_count = attempt_count + 1
        WHERE id = ?
      `)
      .run(Number(record.id));
    return { ok: false, error: attempts + 1 >= MAX_RESET_ATTEMPTS ? 'too_many_attempts' : 'invalid' };
  }

  await db.prepare('UPDATE student_password_reset_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(record.id));
  return {
    ok: true,
    studentUser,
    recordId: Number(record.id),
  };
}
