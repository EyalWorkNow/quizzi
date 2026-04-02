import 'dotenv/config';
import type { Request } from 'express';
import nodemailer from 'nodemailer';

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
};

export type MailDeliveryResult = {
  ok: boolean;
  deliveryStatus: 'sent' | 'failed' | 'not_configured';
  sentAt: string | null;
  error: string | null;
  messageId?: string | null;
};

export type MailHealth = {
  configured: boolean;
  mode: 'smtp' | 'gmail' | 'none';
  from_address: string;
  missing: string[];
  hint: string | null;
};

function parseBooleanFlag(value: unknown, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvValue(key: string) {
  const raw = String(process.env[key] || '').trim();
  if (!raw) return '';
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).trim();
  }
  return raw;
}

function readSecretValue(key: string, { collapseWhitespace = false }: { collapseWhitespace?: boolean } = {}) {
  const raw = readEnvValue(key);
  if (!raw) return '';
  return collapseWhitespace ? raw.replace(/\s+/g, '') : raw;
}

function extractEmailAddress(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const bracketMatch = raw.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) {
    return String(bracketMatch[1] || '').trim();
  }
  return raw;
}

function buildGmailTransportConfig() {
  const user = extractEmailAddress(
    readEnvValue('EMAIL_USER') || readEnvValue('SMTP_USER') || readEnvValue('EMAIL_FROM') || readEnvValue('SMTP_FROM') || 'eyalatiyawork@gmail.com',
  );
  const pass = readSecretValue('EMAIL_PASS', { collapseWhitespace: true });
  if (!user || !pass) return null;
  return {
    service: 'gmail',
    auth: {
      user,
      pass,
    },
  } as const;
}

function buildSmtpTransportConfig() {
  const host = readEnvValue('SMTP_HOST');
  if (!host) return null;
  const smtpUser = readEnvValue('SMTP_USER');
  return {
    host,
    port: parseNumber(readEnvValue('SMTP_PORT'), 587),
    secure: parseBooleanFlag(readEnvValue('SMTP_SECURE'), false),
    auth: smtpUser
      ? {
          user: smtpUser,
          pass: readSecretValue('SMTP_PASS'),
        }
      : undefined,
  } as const;
}

function getTransportConfig() {
  return buildSmtpTransportConfig() || buildGmailTransportConfig();
}

function getFromAddress() {
  return String(
    readEnvValue('SMTP_FROM') ||
      readEnvValue('EMAIL_FROM') ||
      extractEmailAddress(readEnvValue('EMAIL_USER') || readEnvValue('SMTP_USER')) ||
      'eyalatiyawork@gmail.com',
  ).trim();
}

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedTransportKey = '';

function getTransporter() {
  const config = getTransportConfig();
  if (!config) return null;
  const cacheKey = JSON.stringify(config);
  if (!cachedTransporter || cachedTransportKey !== cacheKey) {
    cachedTransporter = nodemailer.createTransport(config as any);
    cachedTransportKey = cacheKey;
  }
  return cachedTransporter;
}

export function getPublicAppUrl() {
  const normalizeUrl = (value: unknown) => String(value || '').trim().replace(/\/+$/, '');
  const isLocalUrl = (value: string) => /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test(value);
  const configuredCandidates = [
    process.env.PUBLIC_APP_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.APP_URL,
    process.env.VITE_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]
    .map(normalizeUrl)
    .filter(Boolean);

  const configured =
    (process.env.NODE_ENV === 'production'
      ? configuredCandidates.find((value) => !isLocalUrl(value))
      : null) || configuredCandidates[0];

  if (configured) {
    return configured;
  }

  return 'http://127.0.0.1:3000';
}

export function resolvePublicAppUrlFromRequest(req?: Pick<Request, 'headers' | 'protocol'> | null) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || '')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
    .split(',')[0]
    .trim();

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');
  }

  const origin = String(req?.headers?.origin || '')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
  if (origin) return origin;

  return getPublicAppUrl();
}

export function isMailConfigured() {
  return Boolean(getTransportConfig());
}

export function getMailHealth(): MailHealth {
  const smtpHost = readEnvValue('SMTP_HOST');
  const smtpUser = readEnvValue('SMTP_USER');
  const smtpPass = readSecretValue('SMTP_PASS');
  const gmailUser = extractEmailAddress(
    readEnvValue('EMAIL_USER') || readEnvValue('SMTP_USER') || readEnvValue('EMAIL_FROM') || readEnvValue('SMTP_FROM') || 'eyalatiyawork@gmail.com',
  );
  const gmailPass = readSecretValue('EMAIL_PASS', { collapseWhitespace: true });

  if (smtpHost) {
    const missing: string[] = [];
    if (!readEnvValue('SMTP_FROM')) missing.push('SMTP_FROM');
    if (smtpUser && !smtpPass) missing.push('SMTP_PASS');
    return {
      configured: missing.length === 0,
      mode: 'smtp',
      from_address: getFromAddress(),
      missing,
      hint:
        missing.length > 0
          ? `Add ${missing.join(' and ')} to enable invite delivery.`
          : null,
    };
  }

  const gmailMissing: string[] = [];
  if (!gmailUser) gmailMissing.push('EMAIL_USER');
  if (!gmailPass) gmailMissing.push('EMAIL_PASS');
  const gmailConfigured = gmailMissing.length === 0;

  return {
    configured: gmailConfigured,
    mode: gmailConfigured || gmailMissing.length > 0 ? 'gmail' : 'none',
    from_address: getFromAddress(),
    missing: gmailConfigured ? [] : gmailMissing,
    hint: gmailConfigured ? null : 'Add EMAIL_PASS (or full SMTP credentials) to send class invites.',
  };
}

export function logMailHealth(context = 'mailer') {
  const health = getMailHealth();
  console.log(
    `[${context}] Mail health: ${JSON.stringify({
      configured: health.configured,
      mode: health.mode,
      from_address: health.from_address,
      missing: health.missing,
      hint: health.hint,
    })}`,
  );
  return health;
}

export async function sendMail(payload: MailPayload): Promise<MailDeliveryResult> {
  const transporter = getTransporter();
  const from = getFromAddress();
  if (!transporter || !from) {
    console.warn(
      `[mailer] Mail send skipped: ${JSON.stringify({
        reason: 'not_configured',
        to: payload.to,
        subject: payload.subject,
        mailHealth: getMailHealth(),
      })}`,
    );
    return {
      ok: false,
      deliveryStatus: 'not_configured',
      sentAt: null,
      error: 'SMTP is not configured yet.',
      messageId: null,
    };
  }

  try {
    const result = await transporter.sendMail({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      replyTo: payload.replyTo || undefined,
    });
    return {
      ok: true,
      deliveryStatus: 'sent',
      sentAt: new Date().toISOString(),
      error: null,
      messageId: result.messageId || null,
    };
  } catch (error: any) {
    console.error(
      `[mailer] Mail send failed: ${JSON.stringify({
        to: payload.to,
        subject: payload.subject,
        message: error?.message || 'Failed to send email.',
        code: error?.code || null,
        command: error?.command || null,
        response: error?.response || null,
        responseCode: error?.responseCode || null,
      })}`,
    );
    return {
      ok: false,
      deliveryStatus: 'failed',
      sentAt: null,
      error: error?.message || 'Failed to send email.',
      messageId: null,
    };
  }
}
