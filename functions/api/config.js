// public runtime config for the frontend (no secrets)

export async function onRequestGet(context) {
  const { env } = context;

  return new Response(JSON.stringify({
    googleClientId: env.GOOGLE_CLIENT_ID || null,
    configured: Boolean(env.GOOGLE_CLIENT_ID && env.ADMIN_MAIL && env.SESSION_SECRET)
  }), {
    headers: { 'content-type': 'application/json' }
  });
}
