// rotate a script's public loader id — instantly invalidates every loadstring built from the old one

import { requireAuth, unauthorized } from '../../_lib/auth.js';
import { newPublicId } from '../../_lib/ids.js';
import { KEY, getJSON, putJSON } from '../../_lib/kv.js';
import { serverError, notFound } from '../../_lib/validate.js';
import { logEvent } from '../../_lib/log.js';

export async function onRequestPost(context) {
  try {
    const { request, env, params } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    if (!env.SCRIPTS_KV) return notFound();

    const meta = await getJSON(env.SCRIPTS_KV, KEY.meta(params.id));
    if (!meta) return notFound();

    const oldPublicId = meta.publicId;
    const newId = newPublicId();

    meta.publicId = newId;
    meta.updatedAt = Date.now();

    await putJSON(env.SCRIPTS_KV, KEY.meta(meta.scriptId), meta);
    await env.SCRIPTS_KV.put(KEY.publicId(newId), meta.scriptId);
    await env.SCRIPTS_KV.delete(KEY.publicId(oldPublicId));

    await logEvent(env.SCRIPTS_KV, 'script_rotated', { email, scriptId: meta.scriptId });

    return new Response(JSON.stringify({ success: true, script: meta }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return serverError(err, 'scripts.rotate');
  }
}
