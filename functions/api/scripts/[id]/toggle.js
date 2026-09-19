// flip a script's enabled flag — disabled scripts are treated as not-found by the public loader

import { requireAuth, unauthorized } from '../../_lib/auth.js';
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

    meta.enabled = !meta.enabled;
    meta.updatedAt = Date.now();
    await putJSON(env.SCRIPTS_KV, KEY.meta(meta.scriptId), meta);

    await logEvent(env.SCRIPTS_KV, 'script_toggled', { email, scriptId: meta.scriptId, enabled: meta.enabled });

    return new Response(JSON.stringify({ success: true, script: meta }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return serverError(err, 'scripts.toggle');
  }
}
