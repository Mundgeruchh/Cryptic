// public loader — the only endpoint Roblox ever talks to.
// Serves plain-text Lua for a valid, enabled, non-rate-limited public id.
// Never exposes the internal scriptId, filename, or any other script's existence.

import { KEY, getJSON } from '../_lib/kv.js';
import { isRateLimited, tooManyRequests, clientIp } from '../_lib/ratelimit.js';
import { logEvent } from '../_lib/log.js';

const LOADER_IP_LIMIT = 60;
const LOADER_IP_WINDOW = 60;
const LOADER_SCRIPT_LIMIT = 120;
const LOADER_SCRIPT_WINDOW = 60;

function looksLikeBrowserNavigation(request) {
  const secFetchMode = request.headers.get('sec-fetch-mode');
  const accept = request.headers.get('accept') || '';
  return secFetchMode === 'navigate' && accept.includes('text/html');
}

function plainText(body, status, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

async function bumpCounter(kv, scriptId) {
  try {
    for (const key of [KEY.count(scriptId), KEY.countTotal]) {
      const current = parseInt((await kv.get(key)) || '0', 10) || 0;
      await kv.put(key, String(current + 1));
    }
  } catch (e) {
    // counting is best-effort, never block script delivery over it
  }
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const publicId = params.id;
  const ip = clientIp(request);
  const kv = env.SCRIPTS_KV;

  try {
    if (looksLikeBrowserNavigation(request)) {
      return plainText('This endpoint is not intended for direct viewing in a browser.', 200);
    }

    if (!kv) {
      return plainText('-- error: storage not configured', 500);
    }

    if (await isRateLimited(kv, `loader:ip:${ip}`, LOADER_IP_LIMIT, LOADER_IP_WINDOW)) {
      await logEvent(kv, 'loader_rate_limited', { ip, scope: 'ip' });
      return tooManyRequests();
    }

    if (await isRateLimited(kv, `loader:id:${publicId}`, LOADER_SCRIPT_LIMIT, LOADER_SCRIPT_WINDOW)) {
      await logEvent(kv, 'loader_rate_limited', { ip, publicId, scope: 'script' });
      return tooManyRequests();
    }

    const scriptId = await kv.get(KEY.publicId(publicId));
    if (!scriptId) {
      await logEvent(kv, 'loader_not_found', { ip, publicId });
      return plainText('-- error 404: not found', 404);
    }

    const meta = await getJSON(kv, KEY.meta(scriptId));
    if (!meta || !meta.enabled) {
      await logEvent(kv, 'loader_not_found', { ip, publicId });
      return plainText('-- error 404: not found', 404);
    }

    const code = await kv.get(KEY.code(scriptId));
    if (!code) {
      await logEvent(kv, 'loader_not_found', { ip, publicId });
      return plainText('-- error 404: not found', 404);
    }

    context.waitUntil(bumpCounter(kv, scriptId));
    context.waitUntil(logEvent(kv, 'loader_served', { ip, publicId }));

    return plainText(code, 200);
  } catch (err) {
    console.error('[loader]', err);
    return plainText('-- error: internal server error', 500);
  }
}
