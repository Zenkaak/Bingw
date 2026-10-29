import { neon } from '@neondatabase/serverless';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  POSTGRES_URL?: string;
  DATABASE_URL?: string;
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
  if (!databaseUrl) {
    return json({ error: 'Offers database is not configured on the Cloudflare Worker.' }, 503);
  }
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/deals' || url.pathname === '/api/deals/') {
      return offers(request, env);
    }
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'This API route has not yet been migrated to Cloudflare Workers.' }, 501);
    }
    return env.ASSETS.fetch(request);
  },
};
