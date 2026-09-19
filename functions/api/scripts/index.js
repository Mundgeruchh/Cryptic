// list + create scripts — admin only, never returns script content in bulk

import { requireAuth, unauthorized } from '../_lib/auth.js';
import { newScriptId, newPublicId } from '../_lib/ids.js';
import { KEY, getJSON, putJSON } from '../_lib/kv.js';
import { validateFilename, validateContent, requireJson, badRequest, serverError } from '../_lib/validate.js';
import { logEvent } from '../_lib/log.js';
import { isRateLimited, tooManyRequests } from '../_lib/ratelimit.js';

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    const scripts = [];
    if (env.SCRIPTS_KV) {
      const list = await env.SCRIPTS_KV.list({ prefix: 'script:' });
      for (const item of list.keys) {
        const meta = await getJSON(env.SCRIPTS_KV, item.name);
        if (!meta) continue;
        const count = parseInt((await env.SCRIPTS_KV.get(KEY.count(meta.scriptId))) || '0', 10) || 0;
        scripts.push({ ...meta, runs: count });
      }
    }

    scripts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return new Response(JSON.stringify({ success: true, scripts }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return serverError(err, 'scripts.list');
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    if (env.SCRIPTS_KV && await isRateLimited(env.SCRIPTS_KV, `create:${email}`, 30, 60)) {
      return tooManyRequests();
    }

    if (!requireJson(request)) return badRequest('Content-Type must be application/json');

    const body = await request.json().catch(() => null);
    if (!body) return badRequest('Invalid JSON body');

    const filename = validateFilename(body.filename);
    if (!filename) return badRequest('Invalid filename');
    if (!validateContent(body.content)) return badRequest('Script content is missing or too large');

    const scriptId = newScriptId();
    const publicId = newPublicId();
    const now = Date.now();

    const meta = {
      scriptId,
      publicId,
      filename,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      createdBy: email
    };

    if (env.SCRIPTS_KV) {
      await putJSON(env.SCRIPTS_KV, KEY.meta(scriptId), meta);
      await env.SCRIPTS_KV.put(KEY.code(scriptId), body.content);
      await env.SCRIPTS_KV.put(KEY.publicId(publicId), scriptId);
    }

    await logEvent(env.SCRIPTS_KV, 'script_created', { email, scriptId, filename });

    return new Response(JSON.stringify({ success: true, script: { ...meta, runs: 0 } }), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return serverError(err, 'scripts.create');
  }
}
