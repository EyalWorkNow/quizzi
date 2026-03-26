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

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

export async function sendStudentClassInviteEmail(payload: StudentInvitePayload): Promise<MailDeliveryResult> {
  const inviteLink = buildInviteLink({
    classId: payload.classId,
    studentEmail: payload.studentEmail,
    className: payload.className,
    alreadyClaimed: payload.alreadyClaimed,
  });
  const safeStudentName = escapeHtml(payload.studentName || 'Student');
  const safeClassName = escapeHtml(payload.className || 'Your class');
  const safeTeacherName = escapeHtml(payload.teacherName || 'your teacher');
  const classMeta = [payload.classSubject, payload.classGrade].filter(Boolean).join(' • ');
  const safeClassMeta = escapeHtml(classMeta);
  const alreadyClaimed = Boolean(payload.alreadyClaimed);
  const subject = alreadyClaimed
    ? `Quizzi: ${payload.className} is now in your student space`
    : `Quizzi: You were invited to join ${payload.className}`;
  const intro = alreadyClaimed
    ? 'A class was just linked to your student account in Quizzi.'
    : 'Your teacher added you to a Quizzi class. It is now waiting for your approval in your student space.';
  const action = alreadyClaimed
    ? 'Open your student space to see the class, your progress, and any live session that is ready for you.'
    : 'Sign in or create your student account with the same email address, then approve the class invite to unlock the class page, progress tracking, and live-room access.';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f7f0e7;padding:32px;color:#1a1a1a;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:3px solid #1a1a1a;border-radius:28px;padding:32px;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:#ff5a36;">Quizzi Student Invite</p>
        <h1 style="margin:0 0 16px;font-size:34px;line-height:1.1;">${safeStudentName}, a class is waiting for you</h1>
        <p style="margin:0 0 18px;font-size:17px;line-height:1.6;">${escapeHtml(intro)}</p>
        <div style="border:2px solid #1a1a1a;border-radius:22px;background:#fff7e8;padding:18px 20px;margin:0 0 18px;">
          <p style="margin:0 0 6px;font-size:24px;font-weight:800;">${safeClassName}</p>
          ${safeClassMeta ? `<p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#555;">${safeClassMeta}</p>` : ''}
          <p style="margin:0;font-size:14px;font-weight:700;color:#555;">Teacher: ${safeTeacherName}</p>
        </div>
        <p style="margin:0 0 22px;font-size:16px;line-height:1.6;">${escapeHtml(action)}</p>
        <a href="${inviteLink}" style="display:inline-block;padding:14px 22px;border:2px solid #1a1a1a;border-radius:999px;background:#ffd54a;color:#1a1a1a;text-decoration:none;font-weight:800;">Open student space</a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#666;">
          If the button does not open, copy this link into your browser:<br />
          <span style="word-break:break-all;">${escapeHtml(inviteLink)}</span>
        </p>
      </div>
    </div>
  `;
  const text = [
    `${payload.studentName || 'Student'},`,
    '',
    intro,
    '',
    `Class: ${payload.className}`,
    classMeta ? `Details: ${classMeta}` : '',
    `Teacher: ${payload.teacherName || 'your teacher'}`,
    '',
    action,
    '',
    `Open your student space: ${inviteLink}`,
  ]
    .filter(Boolean)
    .join('\n');

  return sendMail({
    to: payload.studentEmail,
    subject,
    html,
    text,
    replyTo: payload.teacherEmail || null,
  });
}
