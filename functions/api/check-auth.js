// auth check — validates the signed session token on every load

import { requireAuth } from './_lib/auth.js';

export async function onRequestGet(context) {
  const email = await requireAuth(context.request, context.env);

  if (email) {
    return new Response(JSON.stringify({ authenticated: true, email }), { status: 200 });
  }

  return new Response(JSON.stringify({ authenticated: false }), { status: 401 });
}
