// legacy raw file endpoint — kept alive so existing loadstrings (?file=Name.lua)
// never need to change, but backed by the current script:/scriptcode: KV schema
// instead of the old filename-keyed storage. Disabled scripts are 404, same as
// the opaque /api/loader/<id> endpoint.

import { KEY, getJSON } from './_lib/kv.js';
import { isRateLimited, tooManyRequests, clientIp } from './_lib/ratelimit.js';
import { logEvent } from './_lib/log.js';

const RAW_IP_LIMIT = 60;
const RAW_IP_WINDOW = 60;

function plainText(body, status) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache, no-store, must-revalidate'
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

async function findMetaByFilename(kv, filename) {
  const list = await kv.list({ prefix: 'script:' });
  let match = null;
  for (const item of list.keys) {
    const meta = await getJSON(kv, item.name);
    if (!meta || meta.filename !== filename) continue;
    if (!match || (meta.updatedAt || 0) > (match.updatedAt || 0)) {
      match = meta;
    }
  }
  return match;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const kv = env.SCRIPTS_KV;
  const ip = clientIp(request);

  try {
    const filename = url.searchParams.get('file') || url.searchParams.get('name');
    if (!filename) {
      return plainText('-- error: missing ?file= parameter', 400);
    }

    if (!kv) {
      return plainText('-- error: storage not configured', 500);
    }

    if (await isRateLimited(kv, `raw:ip:${ip}`, RAW_IP_LIMIT, RAW_IP_WINDOW)) {
      await logEvent(kv, 'raw_rate_limited', { ip, filename });
      return tooManyRequests();
    }

    const meta = await findMetaByFilename(kv, filename);
    if (!meta || !meta.enabled) {
      await logEvent(kv, 'raw_not_found', { ip, filename });
      return plainText(`-- error 404: script '${filename}' not found`, 404);
    }

    const code = await kv.get(KEY.code(meta.scriptId));
    if (!code) {
      await logEvent(kv, 'raw_not_found', { ip, filename });
      return plainText(`-- error 404: script '${filename}' not found`, 404);
    }

    context.waitUntil(bumpCounter(kv, meta.scriptId));
    context.waitUntil(logEvent(kv, 'raw_served', { ip, filename }));

    return plainText(code, 200);
  } catch (err) {
    console.error('[raw]', err);
    return plainText(`-- error: ${err.message}`, 500);
  }
}
