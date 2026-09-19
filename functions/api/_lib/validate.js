// shared input validation + a generic error responder that never leaks internals

export const MAX_CONTENT_BYTES = 300 * 1024;
export const FILENAME_RE = /^[a-zA-Z0-9_\-.]{1,100}$/;

export function validateFilename(filename) {
  if (typeof filename !== 'string' || !FILENAME_RE.test(filename)) return null;
  const withExt = filename.endsWith('.lua') || filename.endsWith('.txt') ? filename : `${filename}.lua`;
  return withExt;
}

export function validateContent(content) {
  if (typeof content !== 'string' || content.length === 0) return false;
  return new TextEncoder().encode(content).byteLength <= MAX_CONTENT_BYTES;
}

export function requireJson(request) {
  const contentType = request.headers.get('content-type') || '';
  return contentType.includes('application/json');
}

export function badRequest(message) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
}

export function serverError(err, context) {
  console.error(`[${context}]`, err);
  return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  });
}

export function notFound(message = 'Not found') {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 404,
    headers: { 'content-type': 'application/json' }
  });
}
