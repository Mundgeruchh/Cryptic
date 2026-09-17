// execution stats — how often each script (and the whole site) got loadstring'd

import { requireAuth, unauthorized } from './_lib/auth.js';

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    const counts = {};
    let total = 0;

    if (env.SCRIPTS_KV) {
      const kvList = await env.SCRIPTS_KV.list({ prefix: '__count__:' });
      for (const item of kvList.keys) {
        const value = parseInt((await env.SCRIPTS_KV.get(item.name)) || '0', 10) || 0;
        if (item.name === '__count__:__total__') {
          total = value;
        } else {
          counts[item.name.slice('__count__:'.length)] = value;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, total, counts }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, total: 0, counts: {} }), { status: 500 });
  }
}
