// retired — filenames were never meant to be a secret. Loadstrings now point at
// /api/loader/<public-id>, which is server-authorized, rate-limited and rotatable.

export async function onRequestGet() {
  return new Response(
    '-- this endpoint has been retired. Generate a new loadstring from the dashboard (/api/loader/<id>).',
    {
      status: 410,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store'
      }
    }
  );
}
