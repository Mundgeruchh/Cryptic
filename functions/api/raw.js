const CACHE_SECONDS = 60;

const textHeaders = {
  'content-type': 'text/plain; charset=utf-8',
  'access-control-allow-origin': '*'
};

const plain = (body, status) => new Response(body, { status, headers: textHeaders });

async function notifyExecution(env, loadstring, name) {
  const hook = env.DISCORD_WEBHOOK_URL;
  if (!hook || !hook.startsWith('https://')) return;
  await fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'Cryptic',
      embeds: [{
        title: 'Script executed',
        description: '```lua\n' + loadstring + '\n```',
        color: 0x2f81f7,
        fields: [{ name: 'Script', value: name.slice(0, 200), inline: true }],
        timestamp: new Date().toISOString()
      }],
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

    const loadstring = `loadstring(game:HttpGet("${url.origin}/api/raw?file=${encodeURIComponent(slug)}"))()`;
    const cacheKey = new Request(`${url.origin}/__raw_cache/${slug}`);
    let cache = null;
    try {
      cache = caches.default;
    } catch (e) {}

    const cached = cache ? await cache.match(cacheKey).catch(() => null) : null;
    if (cached) {
      const cachedName = cached.headers.get('x-cryptic-name');
      if (cachedName) waitUntil(notifyExecution(env, loadstring, decodeURIComponent(cachedName)).catch(() => {}));
      return new Response(cached.body, {
        status: 200,
        headers: { ...textHeaders, 'cache-control': 'no-cache, no-store, must-revalidate' }
      });
    }

    const entry = await env.SCRIPTS_KV.get('__l:' + slug);
    const meta = entry && entry.startsWith('{') ? JSON.parse(entry) : null;
    const id = meta ? meta.id : entry;
    let code = id ? await env.SCRIPTS_KV.get('__f:' + id, 'arrayBuffer') : null;

    if (code === null) code = await env.SCRIPTS_KV.get(slug, 'arrayBuffer');

    if (code === null) return plain(`-- error 404: script '${slug}' not found`, 404);

    if (cache) {
      const headers = { ...textHeaders, 'cache-control': `public, max-age=${CACHE_SECONDS}` };
      if (meta && meta.name) headers['x-cryptic-name'] = encodeURIComponent(meta.name);
      waitUntil(cache.put(cacheKey, new Response(code, { headers })).catch(() => {}));
    }

    if (meta && meta.name) waitUntil(notifyExecution(env, loadstring, meta.name).catch(() => {}));

    return new Response(code, {
      status: 200,
      headers: { ...textHeaders, 'cache-control': 'no-cache, no-store, must-revalidate' }
    });
  } catch (err) {
    return plain(`-- error: ${err.message}`, 500);
  }
}
