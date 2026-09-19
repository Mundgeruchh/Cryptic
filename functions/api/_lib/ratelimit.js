// best-effort fixed-window rate limiting on top of Cloudflare KV.
//
// KV is eventually consistent and writes aren't atomic, so under real concurrent
// bursts a handful of extra requests can slip through a shared window. That's an
// acceptable tradeoff for this project's scale (single/small admin group, free
// tier, no Redis/Durable Objects) — treat this as abuse deterrence, not a hard cap.

export async function isRateLimited(kv, bucket, limit, windowSeconds) {
  if (!kv) return false;

  const windowIndex = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${bucket}:${windowIndex}`;

  const current = parseInt((await kv.get(key)) || '0', 10) || 0;
  if (current >= limit) return true;

  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds * 2 });
  return false;
}

export function tooManyRequests() {
  return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '30' }
  });
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}
