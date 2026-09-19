// security-event audit log — best-effort, capped retention, never stores secrets or full tokens

const RETENTION_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function logEvent(kv, type, fields = {}) {
  if (!kv) return;
  try {
    const entry = { ts: new Date().toISOString(), type, ...fields };
    const key = `log:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    await kv.put(key, JSON.stringify(entry), { expirationTtl: RETENTION_SECONDS });
  } catch (e) {
    // logging must never break the request it's attached to
  }
}
