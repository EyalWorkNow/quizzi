const SESSION_PIN_LENGTH = 6;
const SESSION_PIN_PATTERN = /^\d{6}$/;

export function sanitizeSessionPin(value: string): string {
  return value.replace(/\D/g, '').slice(0, SESSION_PIN_LENGTH);
}

export function isValidSessionPin(value: string): boolean {
  return SESSION_PIN_PATTERN.test(sanitizeSessionPin(value));
}

export function extractSessionPin(value: string): string | null {
  const input = value.trim();
  if (!input) {
    return null;
  }

  const directPin = sanitizeSessionPin(input);
  if (SESSION_PIN_PATTERN.test(directPin) && input.replace(/\D/g, '').length === SESSION_PIN_LENGTH) {
    return directPin;
  }

  try {
    const url = new URL(input);
    const urlPin = extractSessionPinFromPath(url.pathname) || sanitizeSessionPin(url.searchParams.get('pin') || '');
    return SESSION_PIN_PATTERN.test(urlPin) ? urlPin : null;
  } catch {
    const pathPin = extractSessionPinFromPath(input);
    if (pathPin) {
      return pathPin;
    }
  }

  const fallbackMatch = input.match(/(?:^|[^\d])(\d{6})(?:[^\d]|$)/);
  return fallbackMatch?.[1] || null;
}

export function buildSessionJoinPath(pin: string): string {
  return `/join/${sanitizeSessionPin(pin)}`;
}

export function buildSessionJoinUrl(pin: string, origin: string): string {
  return new URL(buildSessionJoinPath(pin), origin).toString();
}

function extractSessionPinFromPath(pathname: string): string | null {
  const match = pathname.match(/\/(?:join|sessions?)\/(\d{6})(?:\/play)?(?:\/)?$/i);
  return match?.[1] || null;
}

