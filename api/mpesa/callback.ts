import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const env = (key: string) => (process.env[key] || '').trim();
function decrypt(value: string) {
  const key = Buffer.from(env('ADMIN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('Admin encryption key is not configured.');
  const [iv, tag, data] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[\\s+()-]/g, '');
  if (/^0[17]\\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^254[17]\\d{8}$/.test(digits)) return digits;
  return null;
}
async function sendMerchantSms(to: string, message: string) {
  const apiKey = env('AT_API_KEY');
  const username = env('AT_USERNAME');
  if (!apiKey || !username) throw new Error('SMS gateway is not configured (AT_API_KEY / AT_USERNAME).');
  const body = new URLSearchParams({ username, to, message });
  const sender = env('AT_SENDER_ID');
  if (sender) body.set('from', sender);
  const response = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const text = await response.text();
  if (!response.ok) throw new Error('SMS gateway returned HTTP ' + response.status + ': ' + text.slice(0, 250));
  const result = JSON.parse(text);
  const recipients = result?.SMSMessageData?.Recipients;
  if (!Array.isArray(recipients) || !recipients.some((item: any) => Number(item.statusCode) === 101 || Number(item.statusCode) === 102 || Number(item.statusCode) === 100)) {
    throw new Error('SMS gateway did not accept the notification: ' + String(result?.SMSMessageData?.Message || 'unknown gateway response').slice(0, 250));
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ResultCode: 1, ResultDesc: 'Method not allowed' });
  }
  const dbUrl = env('POSTGRES_URL') || env('DATABASE_URL');
  if (!dbUrl) return res.status(503).json({ ResultCode: 1, ResultDesc: 'Database unavailable' });

  try {
    const body = req.body || {};
    const callback = body.Body?.stkCallback || body.body?.stkCallback;
    const checkoutId = callback?.CheckoutRequestID;
    const resultCode = Number(callback?.ResultCode);
    if (typeof checkoutId !== 'string' || !checkoutId || !Number.isInteger(resultCode)) {
      console.warn('Received malformed Daraja callback');
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const metadata = callback.CallbackMetadata?.Item;
    const items: Record<string, unknown> = {};
    if (Array.isArray(metadata)) {
      for (const item of metadata) if (item && typeof item.Name === 'string') items[item.Name] = item.Value;
    }
    const receipt = typeof items.MpesaReceiptNumber === 'string' ? items.MpesaReceiptNumber.slice(0, 32) : null;
    const callbackAmount = Number(items.Amount);
    const callbackPhone = normalizePhone(items.PhoneNumber);
    const resultDesc = String(callback.ResultDesc || (resultCode === 0 ? 'Payment confirmed' : 'Payment failed')).slice(0, 500);
    const sql = neon(dbUrl);

    if (resultCode !== 0) {
      await sql`UPDATE public.sales SET status=CASE WHEN status='completed' THEN status ELSE 'failed' END, result_desc=${resultDesc}, updated_at=NOW() WHERE checkout_request_id=${checkoutId} AND status<>'completed'`;
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    if (!receipt || !Number.isFinite(callbackAmount) || !callbackPhone) {
      await sql`UPDATE public.sales SET status=CASE WHEN status='completed' THEN status ELSE 'pending_verification' END, result_desc='Success callback incomplete; requires payment verification', updated_at=NOW() WHERE checkout_request_id=${checkoutId} AND status<>'completed'`;
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted for verification' });
    }

    // Match the provider callback to the exact pending order before recording it as paid.
    const matched = await sql`
      SELECT id::text AS id, offer_title, price::numeric AS price, payment_phone, receiving_phone, status
      FROM public.sales
      WHERE checkout_request_id=${checkoutId}
      LIMIT 1
    ` as any[];
    if (!matched.length) {
      console.warn('Daraja callback did not match an order');
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    const sale = matched[0];
    if (Number(sale.price) !== callbackAmount || normalizePhone(sale.payment_phone) !== callbackPhone) {
      await sql`UPDATE public.sales SET status=CASE WHEN status='completed' THEN status ELSE 'pending_verification' END, result_desc='Callback amount or payer phone did not match the order; manual reconciliation required', updated_at=NOW() WHERE id::text=${String(sale.id)} AND status<>'completed'`;
      console.error('Daraja callback order mismatch', { saleId: sale.id, checkoutId });
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted for reconciliation' });
    }

    const settings = await sql`SELECT key,value,encrypted FROM public.admin_settings WHERE key='MERCHANT_NOTIFICATION_PHONE' LIMIT 1` as any[];
    const notificationPhone = settings.length ? normalizePhone(settings[0].encrypted ? decrypt(String(settings[0].value)) : String(settings[0].value)) : null;

    // One unique outbox row per order prevents repeated callbacks sending duplicate order alerts.
    await sql`CREATE TABLE IF NOT EXISTS public.merchant_sms_outbox (
      sale_id uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
      notification_phone text NOT NULL,
      message text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    const paid = await sql`
      UPDATE public.sales
      SET status='completed', mpesa_receipt=${receipt}, result_desc=${resultDesc}, updated_at=NOW()
      WHERE id::text=${String(sale.id)} AND status<>'completed'
      RETURNING id::text AS id, offer_title, price::numeric AS price, receiving_phone
    ` as any[];

    if (paid.length && notificationPhone) {
      const order = paid[0];
      const message = [
        'BLACKHOLE DATA SERVICES - ORDER PAYMENT VERIFIED',
        'Order: ' + String(order.id).slice(0, 12),
        'Bundle: ' + String(order.offer_title || 'Data/SMS bundle').slice(0, 80),
        'Amount: KES ' + Number(order.price).toFixed(0),
        'Recipient: ' + String(normalizePhone(order.receiving_phone) || order.receiving_phone || 'Not recorded'),
        'M-PESA receipt: ' + receipt
      ].join(' | ').slice(0, 480);
      await sql`INSERT INTO public.merchant_sms_outbox (sale_id,notification_phone,message,status) VALUES (${order.id}::uuid,${notificationPhone},${message},'pending') ON CONFLICT (sale_id) DO NOTHING`;
    }

    if (notificationPhone) {
      const queued = await sql`SELECT sale_id::text AS sale_id,notification_phone,message,status FROM public.merchant_sms_outbox WHERE sale_id=${String(sale.id)}::uuid LIMIT 1` as any[];
      if (queued.length && queued[0].status !== 'sent') {
        const claim = await sql`UPDATE public.merchant_sms_outbox SET status='sending',attempts=attempts+1,updated_at=NOW(),last_error=NULL WHERE sale_id=${String(sale.id)}::uuid AND status IN ('pending','failed','pending_configuration') RETURNING sale_id::text AS sale_id,notification_phone,message` as any[];
        if (claim.length) {
          try {
            await sendMerchantSms(String(claim[0].notification_phone), String(claim[0].message));
            await sql`UPDATE public.merchant_sms_outbox SET status='sent',last_error=NULL,updated_at=NOW() WHERE sale_id=${String(sale.id)}::uuid`;
          } catch (smsError) {
            const detail = String((smsError as any)?.message || 'SMS delivery failed').slice(0, 500);
            const status = detail.includes('not configured') ? 'pending_configuration' : 'failed';
            await sql`UPDATE public.merchant_sms_outbox SET status=${status},last_error=${detail},updated_at=NOW() WHERE sale_id=${String(sale.id)}::uuid`;
            console.error('Merchant order SMS not sent', { saleId: sale.id, error: detail });
          }
        }
      }
    } else {
      console.warn('Merchant notification phone is not configured; payment recorded without SMS');
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('POST /api/mpesa/callback failed', error);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Temporary processing error' });
  }
}
