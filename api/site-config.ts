import { neon } from '@neondatabase/serverless';

const env = (key: string) => (process.env[key] || '').trim();
export default async function handler(_req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  const databaseUrl = env('POSTGRES_URL') || env('DATABASE_URL');
  if (!databaseUrl) return res.status(200).json({ businessName: 'BLACKHOLE DATA SERVICES' });
  try {
    const sql = neon(databaseUrl);
    const rows = await sql`SELECT value FROM public.admin_settings WHERE key = 'BUSINESS_NAME' LIMIT 1`;
    const value = String(rows[0]?.value || '').trim();
    return res.status(200).json({ businessName: value || 'BLACKHOLE DATA SERVICES' });
  } catch (error) {
    console.error('Public site config lookup failed', error);
    return res.status(200).json({ businessName: 'BLACKHOLE DATA SERVICES' });
  }
}
