import { requireAuth, unauthorized } from './_lib/auth.js';

const DEFAULT_NAMESPACE_ID = '0878b68840484ebd89332f9281fd0159';

const LIMITS = { read: 100000, write: 1000, delete: 1000, list: 1000 };

const QUERY = `
query KvUsage($accountTag: String!, $namespaceId: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      kvOperationsAdaptiveGroups(
        limit: 100
        filter: { namespaceId: $namespaceId, datetime_geq: $from, datetime_leq: $to }
      ) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestGet({ request, env }) {
  try {
    const email = await requireAuth(request, env);
    if (!email) return unauthorized();

    if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
      return json({ success: false, configured: false, error: 'Set CF_ACCOUNT_ID and CF_API_TOKEN in Cloudflare to enable usage stats' });
    }

    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.CF_API_TOKEN}` },
      body: JSON.stringify({
        query: QUERY,
        variables: {
          accountTag: env.CF_ACCOUNT_ID,
          namespaceId: env.KV_NAMESPACE_ID || DEFAULT_NAMESPACE_ID,
          from: dayStart.toISOString(),
          to: now.toISOString()
        }
      })
    });

    const data = await res.json();
    if (!res.ok || (data.errors && data.errors.length)) {
      const message = data.errors && data.errors[0] ? data.errors[0].message : res.statusText;
      return json({ success: false, configured: true, error: message }, 502);
    }

    const usage = { read: 0, write: 0, delete: 0, list: 0 };
    const groups = data.data.viewer.accounts[0]?.kvOperationsAdaptiveGroups || [];
    for (const group of groups) {
      const action = String(group.dimensions.actionType).toLowerCase();
      if (action in usage) usage[action] += group.sum.requests;
    }

    return json({
      success: true,
      configured: true,
      usage,
      limits: LIMITS,
      resetsAt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (err) {
    return json({ success: false, configured: true, error: err.message }, 500);
  }
}
