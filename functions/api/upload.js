// upload script

import { requireAuth, unauthorized } from './_lib/auth.js';

export async function onRequest(context) {
  try {
    const { request, env } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    const { filename, content } = await request.json();

    if (!filename || !content) {
      return new Response(JSON.stringify({ success: false, error: 'Filename and code are required' }), { status: 400 });
    }

    const clean = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const key = clean.endsWith('.lua') ? clean : clean + '.lua';

    if (env.SCRIPTS_KV) {
      await env.SCRIPTS_KV.put(key, content);
    }

    return new Response(JSON.stringify({ success: true, filename: key }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  return onRequest(context);
}
