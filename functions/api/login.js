// google sign-in login — verifies the google id token and checks it against ADMIN_MAIL

import { createSession, parseAllowedEmails } from './_lib/session.js';
import { isRateLimited, tooManyRequests, clientIp } from './_lib/ratelimit.js';
import { logEvent } from './_lib/log.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const ip = clientIp(request);

    if (env.SCRIPTS_KV && await isRateLimited(env.SCRIPTS_KV, `login:${ip}`, 10, 60)) {
      await logEvent(env.SCRIPTS_KV, 'login_rate_limited', { ip });
      return tooManyRequests();
    }

    const { credential } = await request.json().catch(() => ({}));

    if (!credential) {
      return new Response(JSON.stringify({ success: false, error: 'No Google token received' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (!env.GOOGLE_CLIENT_ID || !env.ADMIN_MAIL || !env.SESSION_SECRET) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server not configured: GOOGLE_CLIENT_ID, ADMIN_MAIL and SESSION_SECRET must be set in Cloudflare'
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }

    // google verifies the token signature for us — we only trust this because
    // the request came over https directly from google's own endpoint
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!verifyRes.ok) {
      return new Response(JSON.stringify({ success: false, error: 'Google token invalid or expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });
    }

    const payload = await verifyRes.json();

    if (payload.aud !== env.GOOGLE_CLIENT_ID) {
      return new Response(JSON.stringify({ success: false, error: 'Token does not belong to this app' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      return new Response(JSON.stringify({ success: false, error: 'Email not verified' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });
    }

    const email = String(payload.email || '').toLowerCase();
    const allowed = parseAllowedEmails(env.ADMIN_MAIL);

    if (!allowed.includes(email)) {
      await logEvent(env.SCRIPTS_KV, 'login_denied', { ip, email });
      return new Response(JSON.stringify({ success: false, error: 'This Google account has no access' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      });
    }

    const token = await createSession(email, env.SESSION_SECRET);
    await logEvent(env.SCRIPTS_KV, 'login_success', { ip, email });

    return new Response(JSON.stringify({ success: true, token, email }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    console.error('[login]', err);
    return new Response(JSON.stringify({ success: false, error: 'Invalid request' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }
}
