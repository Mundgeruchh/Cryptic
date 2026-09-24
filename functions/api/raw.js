const textHeaders = {
  'content-type': 'text/plain; charset=utf-8',
  'access-control-allow-origin': '*'
};

const plain = (body, status) => new Response(body, { status, headers: textHeaders });

async function notifyExecution(env, request, name, slug) {
  const hook = env.DISCORD_WEBHOOK_URL;
  if (!hook || !hook.startsWith('https://')) return;
  const country = (request.cf && request.cf.country) || 'unknown';
  await fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'Cryptic',
      content: `Script **${name}** was loaded (link \`${slug}\`, country: ${country}, <t:${Math.floor(Date.now() / 1000)}:T>)`,
      allowed_mentions: { parse: [] }
    })
  });
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const url = new URL(request.url);
    const requested = url.searchParams.get('file') || url.searchParams.get('name');
    if (!requested) return plain('-- error: missing ?file= parameter', 400);

    const slug = requested.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    if (slug.startsWith('__') || !env.SCRIPTS_KV) return plain(`-- error 404: script '${slug}' not found`, 404);

    const entry = await env.SCRIPTS_KV.get('__l:' + slug);
    const meta = entry && entry.startsWith('{') ? JSON.parse(entry) : null;
    const id = meta ? meta.id : entry;
    let code = id ? await env.SCRIPTS_KV.get('__f:' + id, 'arrayBuffer') : null;

    if (code === null) code = await env.SCRIPTS_KV.get(slug, 'arrayBuffer');

    if (code === null) return plain(`-- error 404: script '${slug}' not found`, 404);

    if (meta && meta.name) waitUntil(notifyExecution(env, request, meta.name, slug).catch(() => {}));

    return new Response(code, {
      status: 200,
      headers: { ...textHeaders, 'cache-control': 'no-cache, no-store, must-revalidate' }
    });
  } catch (err) {
    return plain(`-- error: ${err.message}`, 500);
  }
}
