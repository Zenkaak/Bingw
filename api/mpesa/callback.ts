import { neon } from '@neondatabase/serverless';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ResultCode: 1, ResultDesc: 'Method not allowed' });
  }

  const dbUrl = (process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim();
  if (!dbUrl) return res.status(503).json({ ResultCode: 1, ResultDesc: 'Database unavailable' });

  try {
    const body = req.body || {};
    const callback = body.Body?.stkCallback || body.body?.stkCallback;
    const checkoutId = callback?.CheckoutRequestID;
    const resultCode = Number(callback?.ResultCode);
    if (typeof checkoutId !== 'string' || !checkoutId || !Number.isInteger(resultCode)) {
      // Acknowledge malformed/unmatched callbacks without leaking internal details.
      console.warn('Received malformed Daraja callback');
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const metadata = callback.CallbackMetadata?.Item;
    const items: Record<string, unknown> = {};
    if (Array.isArray(metadata)) {
      for (const item of metadata) {
        if (item && typeof item.Name === 'string') items[item.Name] = item.Value;
      }
    }

    const receipt = typeof items.MpesaReceiptNumber === 'string'
      ? items.MpesaReceiptNumber.slice(0, 32)
      : null;
    const resultDesc = String(callback.ResultDesc || (resultCode === 0 ? 'Payment confirmed' : 'Payment failed')).slice(0, 500);
    const sql = neon(dbUrl);

    // Idempotent update: a repeated callback cannot reverse a completed sale.
    if (resultCode === 0 && receipt) {
      await sql`
        UPDATE public.sales
        SET status = 'completed',
            mpesa_receipt = ${receipt},
            result_desc = ${resultDesc},
            updated_at = NOW()
        WHERE checkout_request_id = ${checkoutId}
          AND status <> 'completed'
      `;
    } else if (resultCode !== 0) {
      await sql`
        UPDATE public.sales
        SET status = CASE WHEN status = 'completed' THEN status ELSE 'failed' END,
            result_desc = ${resultDesc},
            updated_at = NOW()
        WHERE checkout_request_id = ${checkoutId}
          AND status <> 'completed'
      `;
    } else {
      await sql`
        UPDATE public.sales
        SET status = CASE WHEN status = 'completed' THEN status ELSE 'pending_verification' END,
            result_desc = 'Success callback missing receipt; requires reconciliation',
            updated_at = NOW()
        WHERE checkout_request_id = ${checkoutId}
          AND status <> 'completed'
      `;
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('POST /api/mpesa/callback failed', error);
    // Return non-2xx so Safaricom may retry transient database failures.
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Temporary processing error' });
  }
}
