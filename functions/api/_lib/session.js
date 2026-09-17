// signed session tokens (hmac-sha256, no external deps)

function b64urlEncode(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

const DEFAULT_TTL = 60 * 60 * 24 * 7 * 1000; // 7 days

export async function createSession(email, secret, ttlMs = DEFAULT_TTL) {
  const payload = { email: email.toLowerCase(), exp: Date.now() + ttlMs };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = b64urlEncode(payloadBytes);

  const key = await hmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = b64urlEncode(new Uint8Array(sigBuf));

  return `${payloadB64}.${sigB64}`;
}

// returns the email if the token is valid, not expired and (if allowedEmails given) still allowed
export async function verifySession(token, secret, allowedEmails) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;

  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    if (!payload.email || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;

    if (allowedEmails && !allowedEmails.includes(payload.email.toLowerCase())) return null;

    return payload.email;
  } catch (e) {
    return null;
  }
}

export function parseAllowedEmails(adminMailEnv) {
  if (!adminMailEnv) return [];
  return adminMailEnv
    .split(/[,;\s]+/)
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}
