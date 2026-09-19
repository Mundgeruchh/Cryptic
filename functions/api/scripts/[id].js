// single script — admin only. GET includes content (for the editor), PUT updates it, DELETE removes it.

import { requireAuth, unauthorized } from '../_lib/auth.js';
import { KEY, getJSON, putJSON } from '../_lib/kv.js';
import { validateFilename, validateContent, requireJson, badRequest, serverError, notFound } from '../_lib/validate.js';
import { logEvent } from '../_lib/log.js';

export async function onRequestGet(context) {
  try {
    const { request, env, params } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    if (!env.SCRIPTS_KV) return notFound();

    const meta = await getJSON(env.SCRIPTS_KV, KEY.meta(params.id));
    if (!meta) return notFound();

    const content = await env.SCRIPTS_KV.get(KEY.code(meta.scriptId));

    return new Response(JSON.stringify({ success: true, script: { ...meta, content: content || '' } }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return serverError(err, 'scripts.get');
  }
}

export async function onRequestPut(context) {
  try {
    const { request, env, params } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    if (!env.SCRIPTS_KV) return notFound();

    const meta = await getJSON(env.SCRIPTS_KV, KEY.meta(params.id));
    if (!meta) return notFound();

    if (!requireJson(request)) return badRequest('Content-Type must be application/json');

    const body = await request.json().catch(() => null);
    if (!body) return badRequest('Invalid JSON body');

    const filename = validateFilename(body.filename);
    if (!filename) return badRequest('Invalid filename');
    if (!validateContent(body.content)) return badRequest('Script content is missing or too large');

    meta.filename = filename;
    meta.updatedAt = Date.now();

    await putJSON(env.SCRIPTS_KV, KEY.meta(meta.scriptId), meta);
    await env.SCRIPTS_KV.put(KEY.code(meta.scriptId), body.content);

    await logEvent(env.SCRIPTS_KV, 'script_updated', { email, scriptId: meta.scriptId, filename });

    return new Response(JSON.stringify({ success: true, script: meta }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return serverError(err, 'scripts.update');
  }
}

export async function onRequestDelete(context) {
  try {
    const { request, env, params } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    if (!env.SCRIPTS_KV) return notFound();

    const meta = await getJSON(env.SCRIPTS_KV, KEY.meta(params.id));
    if (!meta) return notFound();

    await env.SCRIPTS_KV.delete(KEY.meta(meta.scriptId));
    await env.SCRIPTS_KV.delete(KEY.code(meta.scriptId));
    await env.SCRIPTS_KV.delete(KEY.publicId(meta.publicId));
    await env.SCRIPTS_KV.delete(KEY.count(meta.scriptId));

    await logEvent(env.SCRIPTS_KV, 'script_deleted', { email, scriptId: meta.scriptId, filename: meta.filename });

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return serverError(err, 'scripts.delete');
  }
}
