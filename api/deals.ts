import { neon } from '@neondatabase/serverless';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    return res.status(503).json({ error: 'Offers database is not configured on the server.' });
  }

  try {
    const sql = neon(databaseUrl);
    const offers = await sql`
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
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ offers });
  } catch (error) {
    console.error('GET /api/deals failed', error);
    return res.status(500).json({ error: 'Could not load offers. Please try again shortly.' });
  }
}
