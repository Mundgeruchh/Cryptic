// script list

import { requireAuth, unauthorized } from './_lib/auth.js';

export async function onRequest(context) {
  try {
    const { request, env } = context;

    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    const filesMap = new Map();

    if (env.SCRIPTS_KV) {
      const kvList = await env.SCRIPTS_KV.list();
      for (const item of kvList.keys) {
        if (item.name.startsWith('__count__:')) continue;
        filesMap.set(item.name, { name: item.name });
      }
    }

    try {
      const staticRes = await env.ASSETS.fetch(new URL('/scripts/index.json', request.url));
      if (staticRes.ok) {
        const staticList = await staticRes.json();
        for (const s of staticList) {
          if (!filesMap.has(s.name)) filesMap.set(s.name, s);
        }
      }
    } catch (e) {}

    return new Response(JSON.stringify({ success: true, files: Array.from(filesMap.values()) }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, files: [] }), { status: 500 });
  }
}

export async function onRequestGet(context) {
  return onRequest(context);
}
