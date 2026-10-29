import { neon } from '@neondatabase/serverless';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  POSTGRES_URL?: string;
  DATABASE_URL?: string;
  ADMIN_API_ORIGIN?: string;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

async function offers(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  const databaseUrl = (env.POSTGRES_URL || env.DATABASE_URL || '').trim();
  if (!databaseUrl) return json({ error: 'Offers database is not configured on the Cloudflare Worker.' }, 503);
  try {
    const sql = neon(databaseUrl);
    const rows = await sql`
      SELECT id, group_key, title, price::numeric AS price, validity, note, sort_order
      FROM public.deals
      WHERE active = true
      ORDER BY
        CASE group_key
          WHEN 'bingwa' THEN 1
          WHEN 'repeatable' THEN 2
          WHEN 'minutes' THEN 3
          WHEN 'sms' THEN 4
          ELSE 5
        END,
        sort_order ASC
    `;
    return json({ offers: rows }, 200, { 'cache-control': 'public, max-age=30, s-maxage=60' });
  } catch (error) {
    console.error('GET /api/deals failed', error);
    return json({ error: 'Could not load offers. Please check the database configuration and schema.' }, 500);
  }
}

// Keep the existing admin authentication, session cookie, and encrypted settings
// implementation authoritative while the Cloudflare-native admin API is prepared.
async function adminProxy(request: Request, env: Env): Promise<Response> {
  const origin = (env.ADMIN_API_ORIGIN || 'https://bingwakk.vercel.app').replace(/\/+$/, '');
  const incoming = new URL(request.url);
  const upstream = new URL(origin + incoming.pathname + incoming.search);
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1));
  headers.set('cache-control', 'no-store');
  try {
    const upstreamResponse = await fetch(new Request(upstream.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    }));
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set('cache-control', 'no-store');
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Admin API proxy failed', error);
    return json({ error: 'Admin service is temporarily unavailable.' }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/deals' || url.pathname === '/api/deals/') return offers(request, env);
    if (url.pathname === '/api/admin' || url.pathname === '/api/admin/') return adminProxy(request, env);
    if (url.pathname === '/api/mpesa/stkpush' || url.pathname === '/api/mpesa/stkpush/') {
      return json({ error: 'M-PESA checkout is disabled on this Cloudflare test site. No payment was initiated.' }, 503);
    }
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'This API route is not enabled on the Cloudflare test site.' }, 501);
    }
    return env.ASSETS.fetch(request);
  },
};
