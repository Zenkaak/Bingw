import { neon } from '@neondatabase/serverless';

const env = (key: string) => (process.env[key] || '').trim();

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const saleId = String(req.query?.saleId || '');
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) return res.status(400).json({ error: 'A valid order ID is required.' });
  const dbUrl = env('POSTGRES_URL') || env('DATABASE_URL');
  if (!dbUrl) return res.status(503).json({ error: 'Order database is not configured.' });
  try {
    const sql = neon(dbUrl);
    const rows = await sql`SELECT status, result_desc, mpesa_receipt FROM public.sales WHERE id=${saleId}::uuid LIMIT 1` as any[];
    if (!rows.length) return res.status(404).json({ error: 'Order not found.' });
    const status = String(rows[0].status || 'pending').toLowerCase();
    const normalized = ['completed','success','successful','paid'].includes(status) ? 'success'
      : ['failed','cancelled','canceled','error'].includes(status) ? 'failed'
      : ['pending','initiating','pending_verification','processing'].includes(status) ? 'pending' : 'pending';
    return res.status(200).json({ status: normalized, receipt: normalized === 'success' ? String(rows[0].mpesa_receipt || '') : '', message: normalized === 'success' ? 'Payment confirmed.' : normalized === 'failed' ? String(rows[0].result_desc || 'Payment was not completed.').slice(0,180) : 'Waiting for M-PESA confirmation.' });
  } catch (error) {
    console.error('GET /api/mpesa/order-status failed', error);
    return res.status(500).json({ error: 'Could not check payment status.' });
  }
}
