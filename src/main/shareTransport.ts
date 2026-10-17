import crypto from 'node:crypto';
export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function tokenMatches(expected: string | null, provided: string | null | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function queryToken(url: string | undefined): string | null {
  try {
    return new URL(url ?? '/', 'http://localhost').searchParams.get('token');
  } catch {
    return null;
  }
}
