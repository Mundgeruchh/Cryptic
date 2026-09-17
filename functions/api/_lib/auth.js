// shared bearer-token check for protected api routes

import { verifySession, parseAllowedEmails } from './session.js';

export async function requireAuth(request, env) {
  if (!env.SESSION_SECRET) return null;

  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;

  const token = auth.substring(7);
  const allowed = parseAllowedEmails(env.ADMIN_MAIL);
  const email = await verifySession(token, env.SESSION_SECRET, allowed);
  return email;
}

export function unauthorized() {
  return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), {
    status: 401,
    headers: { 'content-type': 'application/json' }
  });
}
