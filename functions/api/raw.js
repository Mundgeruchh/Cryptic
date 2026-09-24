const textHeaders = {
  'content-type': 'text/plain; charset=utf-8',
  'access-control-allow-origin': '*'
};

const plain = (body, status) => new Response(body, { status, headers: textHeaders });

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const requested = url.searchParams.get('file') || url.searchParams.get('name');
    if (!requested) return plain('-- error: missing ?file= parameter', 400);

    const slug = requested.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    if (slug.startsWith('__') || !env.SCRIPTS_KV) return plain(`-- error 404: script '${slug}' not found`, 404);

    const id = await env.SCRIPTS_KV.get('__l:' + slug);
    let code = id ? await env.SCRIPTS_KV.get('__f:' + id, 'arrayBuffer') : null;

    if (code === null) code = await env.SCRIPTS_KV.get(slug, 'arrayBuffer');

    if (code === null) return plain(`-- error 404: script '${slug}' not found`, 404);

    return new Response(code, {
      status: 200,
      headers: { ...textHeaders, 'cache-control': 'no-cache, no-store, must-revalidate' }
    });
  } catch (err) {
    return plain(`-- error: ${err.message}`, 500);
  }
}
