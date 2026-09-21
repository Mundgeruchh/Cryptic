// raw script server — returns plain text only, never HTML

// Cloudflare's free KV tier caps writes at 1000/day. Counting every single
// loadstring fetch burned through that quota on busy days and then blocked
// unrelated writes site-wide, including saving edits from the dashboard.
// Sample instead: only write on 1 in COUNT_SAMPLE_RATE hits, and credit the
// counter for the whole batch when it does.
const COUNT_SAMPLE_RATE = 20;

async function bumpCounter(kv, filename) {
  if (Math.random() >= 1 / COUNT_SAMPLE_RATE) return;
  try {
    const keys = [`__count__:${filename}`, '__count__:__total__'];
    for (const key of keys) {
      const current = parseInt((await kv.get(key)) || '0', 10) || 0;
      await kv.put(key, String(current + COUNT_SAMPLE_RATE));
    }
  } catch (e) {
    // counting is best-effort, never block script delivery over it
  }
}

export async function onRequest(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    const filename = url.searchParams.get('file') || url.searchParams.get('name');
    if (!filename) {
      return new Response('-- error: missing ?file= parameter', {
        status: 400,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'access-control-allow-origin': '*'
        }
      });
    }

    const clean = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    let code = null;

    // 1. Try KV store first
    if (env.SCRIPTS_KV) {
      code = await env.SCRIPTS_KV.get(clean);
    }

    // 2. Try static assets as fallback (but guard against SPA HTML fallback)
    if (!code) {
      const paths = [`/scripts/${clean}`, `/${clean}`];
      for (const path of paths) {
        try {
          const assetUrl = new URL(path, request.url);
          const res = await env.ASSETS.fetch(assetUrl);
          if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            // Cloudflare Pages returns index.html as SPA fallback — reject HTML responses
            if (contentType.includes('text/html')) {
              continue;
            }
            const text = await res.text();
            // Double-check: if the response starts with <!DOCTYPE or <html, it's the SPA fallback
            if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html')) {
              continue;
            }
            code = text;
            break;
          }
        } catch (e) {
          // asset fetch failed, continue to next path
        }
      }
    }

    if (!code) {
      return new Response(`-- error 404: script '${clean}' not found`, {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'access-control-allow-origin': '*'
        }
      });
    }

    // execution counter — every successful loadstring fetch counts as one run
    if (env.SCRIPTS_KV) {
      context.waitUntil(bumpCounter(env.SCRIPTS_KV, clean));
    }

    return new Response(code, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (err) {
    return new Response(`-- error: ${err.message}`, {
      status: 500,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    });
  }
}

export async function onRequestGet(context) {
  return onRequest(context);
}
