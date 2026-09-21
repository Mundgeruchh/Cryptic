// google sign-in login — verifies the google id token and checks it against ADMIN_MAIL

import { createSession, parseAllowedEmails } from './_lib/session.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const { credential } = await request.json();

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
      return new Response(JSON.stringify({ success: false, error: 'This Google account has no access' }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      });
    }

    const token = await createSession(email, env.SESSION_SECRET);

    return new Response(JSON.stringify({ success: true, token, email }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }
}
