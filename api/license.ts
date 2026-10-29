import { neon } from '@neondatabase/serverless';

const env = (key: string) => (process.env[key] || '').trim();
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const url = env('POSTGRES_URL') || env('DATABASE_URL');
  if (!url) return res.status(503).json({ error: 'License status is unavailable.' });
  try {
    const sql = neon(url);
    await sql`CREATE TABLE IF NOT EXISTS public.site_license (id text PRIMARY KEY DEFAULT 'site', purchase_count integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`INSERT INTO public.site_license (id,purchase_count,is_active) VALUES ('site',0,true) ON CONFLICT (id) DO NOTHING`;
    const rows = await sql`SELECT purchase_count,is_active FROM public.site_license WHERE id='site' LIMIT 1` as any[];
    const count = Number(rows[0]?.purchase_count || 0);
    const active = Boolean(rows[0]?.is_active) && count < 3;
    return res.status(200).json({ active, locked: !active, successfulPurchases: count, trialLimit: 3, remaining: Math.max(0, 3-count), renewalPrice: 1000 });
  } catch (error) {
    console.error('License status lookup failed', error);
    return res.status(503).json({ error: 'License status is unavailable.' });
  }
}
