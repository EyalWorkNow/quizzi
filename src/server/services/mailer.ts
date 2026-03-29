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
    process.env.EMAIL_USER || process.env.SMTP_USER || process.env.EMAIL_FROM || process.env.SMTP_FROM || 'eyalatiyawork@gmail.com',
  );
  const pass = String(process.env.EMAIL_PASS || '').trim();
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
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;
  return {
    host,
    port: parseNumber(process.env.SMTP_PORT, 587),
    secure: parseBooleanFlag(process.env.SMTP_SECURE, false),
    auth: process.env.SMTP_USER
      ? {
          user: String(process.env.SMTP_USER || '').trim(),
          pass: String(process.env.SMTP_PASS || '').trim(),
        }
      : undefined,
  } as const;
}

function getTransportConfig() {
  return buildSmtpTransportConfig() || buildGmailTransportConfig();
}

function getFromAddress() {
  return String(
    process.env.SMTP_FROM ||
      process.env.EMAIL_FROM ||
      extractEmailAddress(process.env.EMAIL_USER || process.env.SMTP_USER) ||
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

  return 'http://127.0.0.1:5173';
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
  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || '').trim();
  const gmailUser = extractEmailAddress(
    process.env.EMAIL_USER || process.env.SMTP_USER || process.env.EMAIL_FROM || process.env.SMTP_FROM || 'eyalatiyawork@gmail.com',
  );
  const gmailPass = String(process.env.EMAIL_PASS || '').trim();

  if (smtpHost) {
    const missing: string[] = [];
    if (!String(process.env.SMTP_FROM || '').trim()) missing.push('SMTP_FROM');
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

export async function sendMail(payload: MailPayload): Promise<MailDeliveryResult> {
  const transporter = getTransporter();
  const from = getFromAddress();
  if (!transporter || !from) {
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
    return {
      ok: false,
      deliveryStatus: 'failed',
      sentAt: null,
      error: error?.message || 'Failed to send email.',
      messageId: null,
    };
  }
}
