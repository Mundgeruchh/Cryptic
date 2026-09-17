// delete script

import { requireAuth, unauthorized } from './_lib/auth.js';

export async function onRequest(context) {
  try {
    const { request, env } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    const url = new URL(request.url);
    const filename = url.searchParams.get('file');

    if (!filename) {
      return new Response(JSON.stringify({ success: false, error: 'Filename missing' }), { status: 400 });
    }

    const clean = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

    if (env.SCRIPTS_KV) {
      await env.SCRIPTS_KV.delete(clean);
      await env.SCRIPTS_KV.delete(`__count__:${clean}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}

export async function onRequestDelete(context) {
  return onRequest(context);
}
