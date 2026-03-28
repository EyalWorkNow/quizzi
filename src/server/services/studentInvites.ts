import { getPublicAppUrl, sendMail, type MailDeliveryResult } from './mailer.js';

type StudentInvitePayload = {
  studentName: string;
  studentEmail: string;
  classId: number;
  className: string;
  classSubject?: string | null;
  classGrade?: string | null;
  teacherName?: string | null;
  teacherEmail?: string | null;
  alreadyClaimed?: boolean;
};

type InviteLocale = 'he' | 'en';

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function containsHebrew(value: string) {
  return /[\u0590-\u05FF]/.test(String(value || ''));
}

function resolveInviteLocale(payload: StudentInvitePayload): InviteLocale {
  const signal = [
    payload.studentName,
    payload.className,
    payload.classSubject,
    payload.classGrade,
    payload.teacherName,
  ]
    .filter(Boolean)
    .join(' ');

  return containsHebrew(signal) ? 'he' : 'en';
}

function buildInviteLink({
  classId,
  studentEmail,
  className,
  alreadyClaimed,
}: {
  classId: number;
  studentEmail: string;
  className: string;
  alreadyClaimed?: boolean;
}) {
  const params = new URLSearchParams();
  params.set('email', studentEmail);
  params.set('class_id', String(classId));
  params.set('class_name', className);
  params.set('mode', alreadyClaimed ? 'login' : 'register');
  return `${getPublicAppUrl()}/student/auth?${params.toString()}`;
}

function getInviteCopy(locale: InviteLocale, alreadyClaimed: boolean) {
  if (locale === 'he') {
    return alreadyClaimed
      ? {
          subjectPrefix: 'הכיתה שלך ב-Quizzi מוכנה',
          preheader: 'הכיתה כבר מחוברת לחשבון שלך. כניסה קצרה ותוכל/י לראות התקדמות, תרגול וגישה לשיעורים חיים.',
          eyebrow: 'מרחב התלמיד של Quizzi',
          title: 'הכיתה כבר מחכה לך',
          intro:
            'הכיתה כבר מחוברת לחשבון שלך ב-Quizzi. בכניסה אחת אפשר לראות את הכיתה, את ההתקדמות שלך, ואת כל מה שמחכה לך בהמשך.',
          primaryCta: 'פתיחת מרחב התלמיד',
          secondaryLine: 'כדאי להיכנס עם אותו אימייל שאליו נשלחה ההזמנה כדי שהכיתה תופיע מיד.',
          teacherLabel: 'נשלח דרך',
          detailsLabel: 'פרטי הכיתה',
          teacherField: 'מורה',
          unlockLabel: 'מה נפתח עבורך בתוך הכיתה',
          unlockItems: [
            'גישה מרוכזת לכיתה ולכל מה שמחכה לך שם',
            'מעקב התקדמות לאורך זמן במקום אחד',
            'כניסה מהירה לסשנים חיים ולתרגול המשכי',
          ],
          stepsLabel: 'כך זה עובד',
          steps: [
            'נכנסים עם אותו האימייל שאליו קיבלת את ההזמנה.',
            'הכיתה כבר תופיע אוטומטית במרחב התלמיד.',
            'משם אפשר להיכנס, לעקוב אחרי התקדמות, ולהצטרף כשיש פעילות חיה.',
          ],
          fallbackLabel: 'אם הכפתור לא נפתח, אפשר להעתיק את הקישור הזה לדפדפן:',
          footer:
            'אם זה לא האימייל הנכון או שיש בעיה בגישה, אפשר פשוט להשיב למייל הזה והמורה יקבל/תקבל את ההודעה.',
        }
      : {
          subjectPrefix: 'הוזמנת להצטרף לכיתה ב-Quizzi',
          preheader: 'אישור קצר והכיתה תיפתח אצלך עם התקדמות, תרגול וגישה לשיעורים חיים.',
          eyebrow: 'הזמנה אישית ל-Quizzi',
          title: 'כיתה חדשה מחכה לך',
          intro:
            'המורה הוסיף/ה אותך לכיתה ב-Quizzi. אחרי אישור קצר הכיתה תופיע אצלך במרחב התלמיד, עם כל המעקב, התרגול, והגישה לפעילות חיה כשיש.',
          primaryCta: 'אישור והכניסה לכיתה',
          secondaryLine:
            'כדי שהכיתה תופיע נכון, כדאי להיכנס או להירשם עם אותו האימייל שאליו נשלחה ההזמנה.',
          teacherLabel: 'נשלח דרך',
          detailsLabel: 'פרטי הכיתה',
          teacherField: 'מורה',
          unlockLabel: 'מה תקבל/י אחרי האישור',
          unlockItems: [
            'גישה לכיתה שלך מתוך מרחב תלמיד מסודר וברור',
            'מעקב אישי אחרי התקדמות לאורך זמן',
            'כניסה ישירה לסשנים חיים ולתרגול המשכי',
          ],
          stepsLabel: 'מה יקרה אחרי הלחיצה',
          steps: [
            'נכנסים או נרשמים עם אותו האימייל.',
            'מאשרים את ההזמנה לכיתה.',
            'הכיתה נפתחת אצלך אוטומטית במרחב התלמיד.',
          ],
          fallbackLabel: 'אם הכפתור לא נפתח, אפשר להעתיק את הקישור הזה לדפדפן:',
          footer:
            'אם משהו לא ברור או שההזמנה הגיעה לכתובת לא נכונה, אפשר פשוט להשיב למייל הזה והמורה יקבל/תקבל את ההודעה.',
        };
  }

  return alreadyClaimed
    ? {
        subjectPrefix: 'Your Quizzi class is ready',
        preheader: 'Your class is already connected. Sign in once to open it, track progress, and join live activity.',
        eyebrow: 'Quizzi student space',
        title: 'Your class is already waiting for you',
        intro:
          'This class is already connected to your Quizzi account. One quick sign-in opens your class space, your progress view, and anything active or upcoming.',
        primaryCta: 'Open student space',
        secondaryLine: 'Use the same email address this invitation was sent to so the class opens immediately.',
        teacherLabel: 'Sent via',
        detailsLabel: 'Class details',
        teacherField: 'Teacher',
        unlockLabel: 'What opens inside your class',
        unlockItems: [
          'A clean class space with everything in one place',
          'Long-term progress tracking',
          'Fast access to live sessions and follow-up practice',
        ],
        stepsLabel: 'What happens next',
        steps: [
          'Sign in with the same email address.',
          'Your class appears automatically in your student space.',
          'Open it to track progress and join when something is live.',
        ],
        fallbackLabel: 'If the button does not open, copy this link into your browser:',
        footer:
          'If this reached the wrong inbox or you need help accessing the class, simply reply to this email and your teacher will receive it.',
      }
    : {
        subjectPrefix: 'You were invited to a Quizzi class',
        preheader: 'Approve the invite once and your class opens with progress tracking, practice, and live access.',
        eyebrow: 'Your Quizzi class invite',
        title: 'A new class is waiting for you',
        intro:
          'Your teacher added you to a class on Quizzi. Once you approve the invite, the class will appear in your student space with progress tracking, practice, and access to live activity.',
        primaryCta: 'Approve and enter class',
        secondaryLine: 'To make sure the class appears correctly, sign in or register with the same email address this invitation was sent to.',
        teacherLabel: 'Sent via',
        detailsLabel: 'Class details',
        teacherField: 'Teacher',
        unlockLabel: 'What you unlock after approval',
        unlockItems: [
          'A focused class page inside your student space',
          'Progress tracking over time',
          'Direct access to live sessions and practice',
        ],
        stepsLabel: 'What happens after you click',
        steps: [
          'Sign in or create your account with the same email.',
          'Approve the class invite.',
          'The class opens automatically inside your student space.',
        ],
        fallbackLabel: 'If the button does not open, copy this link into your browser:',
        footer:
          'If this invite reached the wrong address or you need help getting in, simply reply to this email and your teacher will receive it.',
      };
}

function buildBrandLogoHtml(baseUrl: string, locale: InviteLocale) {
  const alt = locale === 'he' ? 'הלוגו של Quizzi' : 'Quizzi logo';
  return `
    <img
      src="${escapeHtml(`${baseUrl}/quizzi-logo-email.svg`)}"
      alt="${escapeHtml(alt)}"
      width="180"
      style="display:block;width:180px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;"
    />
  `;
}

function buildMetaLine(parts: string[], locale: InviteLocale) {
  const filtered = parts.map((part) => String(part || '').trim()).filter(Boolean);
  if (!filtered.length) return '';
  return escapeHtml(filtered.join(locale === 'he' ? ' • ' : ' • '));
}

function buildInviteHtml({
  payload,
  inviteLink,
  locale,
}: {
  payload: StudentInvitePayload;
  inviteLink: string;
  locale: InviteLocale;
}) {
  const copy = getInviteCopy(locale, Boolean(payload.alreadyClaimed));
  const isRtl = locale === 'he';
  const dir = isRtl ? 'rtl' : 'ltr';
  const align = isRtl ? 'right' : 'left';
  const reverseAlign = isRtl ? 'left' : 'right';
  const safeStudentName = escapeHtml(payload.studentName || (locale === 'he' ? 'תלמיד/ה' : 'Student'));
  const safeClassName = escapeHtml(payload.className || (locale === 'he' ? 'הכיתה שלך' : 'Your class'));
  const safeTeacherName = escapeHtml(payload.teacherName || (locale === 'he' ? 'המורה שלך' : 'your teacher'));
  const safeTeacherEmail = escapeHtml(payload.teacherEmail || '');
  const baseUrl = getPublicAppUrl();
  const classMeta = buildMetaLine([payload.classSubject || '', payload.classGrade || ''], locale);
  const introLead =
    locale === 'he'
      ? `${safeStudentName}, ${copy.title}`
      : `${safeStudentName}, ${copy.title}`;

  const unlockCards = copy.unlockItems
    .map(
      (item) => `
        <tr>
          <td style="padding:0 0 10px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="18" valign="top" style="padding:${isRtl ? '2px 0 0 10px' : '2px 10px 0 0'};">
                  <div style="width:10px;height:10px;border-radius:999px;background:#FF5A36;border:2px solid #1A1A1A;"></div>
                </td>
                <td valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#F8F1E7;font-weight:700;text-align:${align};">
                  ${escapeHtml(item)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `,
    )
    .join('');

  const steps = copy.steps
    .map(
      (step, index) => `
        <tr>
          <td style="padding:0 0 14px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="42" valign="top" style="padding:${isRtl ? '0 0 0 12px' : '0 12px 0 0'};">
                  <div style="width:34px;height:34px;line-height:34px;text-align:center;border-radius:999px;background:#FFD13B;border:2px solid #1A1A1A;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:900;color:#1A1A1A;">
                    ${index + 1}
                  </div>
                </td>
                <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1A1A1A;font-weight:700;text-align:${align};">
                  ${escapeHtml(step)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `,
    )
    .join('');

  return `
    <!doctype html>
    <html lang="${locale}" dir="${dir}">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="x-apple-disable-message-reformatting" />
        <title>${escapeHtml(copy.subjectPrefix)}</title>
        <style>
          @media screen and (max-width: 640px) {
            .email-shell { width: 100% !important; }
            .email-card { border-radius: 24px !important; }
            .email-pad { padding: 24px 18px !important; }
            .hero-title { font-size: 30px !important; line-height: 1.15 !important; }
            .hero-copy { font-size: 16px !important; }
            .cta-button { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#F7F0E7;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
          ${escapeHtml(copy.preheader)}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F0E7;">
          <tr>
            <td align="center" style="padding:28px 14px 42px 14px;">
              <table role="presentation" width="680" class="email-shell" cellspacing="0" cellpadding="0" border="0" style="width:680px;max-width:680px;">
                <tr>
                  <td align="${align}" style="padding:0 0 14px 0;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="padding:${isRtl ? '0 0 0 12px' : '0 12px 0 0'};vertical-align:middle;">
                          ${buildBrandLogoHtml(baseUrl, locale)}
                        </td>
                        <td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;color:#FF5A36;text-align:${align};">
                          ${escapeHtml(copy.eyebrow)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="email-card" style="background:#FFFFFF;border:3px solid #1A1A1A;border-radius:32px;box-shadow:8px 8px 0 0 #1A1A1A;overflow:hidden;">
                      <tr>
                        <td style="background:linear-gradient(135deg,#FFF3D6 0%,#FFFFFF 55%,#F0E7FF 100%);padding:28px 30px 18px 30px;" class="email-pad">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td align="${align}" style="padding:0 0 14px 0;">
                                <span style="display:inline-block;padding:8px 14px;border-radius:999px;background:#FFD13B;border:2px solid #1A1A1A;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:#1A1A1A;">
                                  ${escapeHtml(copy.detailsLabel)}
                                </span>
                              </td>
                            </tr>
                            <tr>
                              <td align="${align}" style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:38px;line-height:1.05;font-weight:900;color:#1A1A1A;" class="hero-title">
                                ${introLead}
                              </td>
                            </tr>
                            <tr>
                              <td align="${align}" style="padding:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.75;color:#3A3A3A;font-weight:600;" class="hero-copy">
                                ${escapeHtml(copy.intro)}
                              </td>
                            </tr>
                            <tr>
                              <td align="${align}" style="padding:0 0 18px 0;">
                                <a
                                  href="${inviteLink}"
                                  class="cta-button"
                                  style="display:inline-block;padding:16px 24px;border-radius:999px;border:2px solid #1A1A1A;background:#FF5A36;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1;font-weight:900;box-shadow:4px 4px 0 0 #1A1A1A;"
                                >
                                  ${escapeHtml(copy.primaryCta)}
                                </a>
                              </td>
                            </tr>
                            <tr>
                              <td align="${align}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#4C4C4C;font-weight:700;">
                                ${escapeHtml(copy.secondaryLine)}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 30px 30px 30px;" class="email-pad">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:6px;">
                            <tr>
                              <td style="padding:0 0 18px 0;">
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFF8EA;border:2px solid #1A1A1A;border-radius:24px;">
                                  <tr>
                                    <td style="padding:22px 22px 18px 22px;">
                                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                        <tr>
                                          <td align="${align}" style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#FF5A36;">
                                            ${escapeHtml(copy.detailsLabel)}
                                          </td>
                                        </tr>
                                        <tr>
                                          <td align="${align}" style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.15;font-weight:900;color:#1A1A1A;">
                                            ${safeClassName}
                                          </td>
                                        </tr>
                                        ${
                                          classMeta
                                            ? `
                                              <tr>
                                                <td align="${align}" style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;font-weight:800;color:#5B5B5B;">
                                                  ${classMeta}
                                                </td>
                                              </tr>
                                            `
                                            : ''
                                        }
                                        <tr>
                                          <td align="${align}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;font-weight:800;color:#5B5B5B;">
                                            ${escapeHtml(copy.teacherField)}: ${safeTeacherName}
                                            ${safeTeacherEmail ? ` &lt;${safeTeacherEmail}&gt;` : ''}
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <tr>
                              <td style="padding:0 0 18px 0;">
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#1A1A1A;border:2px solid #1A1A1A;border-radius:24px;">
                                  <tr>
                                    <td style="padding:22px 22px 16px 22px;">
                                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                        <tr>
                                          <td align="${align}" style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#FFD13B;">
                                            ${escapeHtml(copy.unlockLabel)}
                                          </td>
                                        </tr>
                                        ${unlockCards}
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <tr>
                              <td style="padding:0 0 18px 0;">
                                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F6EEFF;border:2px solid #1A1A1A;border-radius:24px;">
                                  <tr>
                                    <td style="padding:22px 22px 10px 22px;">
                                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                        <tr>
                                          <td align="${align}" style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#1A1A1A;">
                                            ${escapeHtml(copy.stepsLabel)}
                                          </td>
                                        </tr>
                                        ${steps}
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>

                            <tr>
                              <td align="${align}" style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#5E5E5E;font-weight:700;">
                                ${escapeHtml(copy.fallbackLabel)}
                              </td>
                            </tr>
                            <tr>
                              <td align="${align}" style="padding:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#1A1A1A;font-weight:700;word-break:break-all;">
                                <a href="${inviteLink}" style="color:#1A1A1A;text-decoration:underline;">${escapeHtml(inviteLink)}</a>
                              </td>
                            </tr>
                            <tr>
                              <td align="${align}" style="padding:18px 0 0 0;border-top:1px solid #D7CCBF;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.8;color:#646464;font-weight:700;">
                                ${escapeHtml(copy.teacherLabel)} ${safeTeacherName} · Quizzi<br />
                                ${escapeHtml(copy.footer)}
                              </td>
                            </tr>
                          </table>
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

function buildInviteText({
  payload,
  inviteLink,
  locale,
}: {
  payload: StudentInvitePayload;
  inviteLink: string;
  locale: InviteLocale;
}) {
  const copy = getInviteCopy(locale, Boolean(payload.alreadyClaimed));
  const classMeta = [payload.classSubject, payload.classGrade].map((item) => String(item || '').trim()).filter(Boolean).join(' • ');

  if (locale === 'he') {
    return [
      `${payload.studentName || 'תלמיד/ה'},`,
      '',
      copy.title,
      copy.intro,
      '',
      `כיתה: ${payload.className}`,
      classMeta ? `פרטים: ${classMeta}` : '',
      `מורה: ${payload.teacherName || 'המורה שלך'}`,
      '',
      copy.unlockLabel,
      ...copy.unlockItems.map((item) => `- ${item}`),
      '',
      copy.stepsLabel,
      ...copy.steps.map((step, index) => `${index + 1}. ${step}`),
      '',
      `${copy.primaryCta}: ${inviteLink}`,
      '',
      copy.footer,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `${payload.studentName || 'Student'},`,
    '',
    copy.title,
    copy.intro,
    '',
    `Class: ${payload.className}`,
    classMeta ? `Details: ${classMeta}` : '',
    `Teacher: ${payload.teacherName || 'your teacher'}`,
    '',
    copy.unlockLabel,
    ...copy.unlockItems.map((item) => `- ${item}`),
    '',
    copy.stepsLabel,
    ...copy.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    `${copy.primaryCta}: ${inviteLink}`,
    '',
    copy.footer,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function sendStudentClassInviteEmail(payload: StudentInvitePayload): Promise<MailDeliveryResult> {
  const inviteLink = buildInviteLink({
    classId: payload.classId,
    studentEmail: payload.studentEmail,
    className: payload.className,
    alreadyClaimed: payload.alreadyClaimed,
  });
  const locale = resolveInviteLocale(payload);
  const copy = getInviteCopy(locale, Boolean(payload.alreadyClaimed));
  const className = String(payload.className || '').trim();
  const subject = locale === 'he'
    ? `${copy.subjectPrefix}: ${className || 'הכיתה שלך'}`
    : `${copy.subjectPrefix}: ${className || 'Your class'}`;

  return sendMail({
    to: payload.studentEmail,
    subject,
    html: buildInviteHtml({ payload, inviteLink, locale }),
    text: buildInviteText({ payload, inviteLink, locale }),
    replyTo: payload.teacherEmail || null,
  });
}
