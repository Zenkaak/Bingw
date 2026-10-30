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
  const digits = String(value ?? '').replace(/[\s+()-]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}
async function verifyDarajaPayment(sql: any, checkoutId: string, accountType: string): Promise<boolean> {
  const rows = await sql`SELECT key,value,encrypted FROM public.admin_settings WHERE key IN ('DARAJA_ACCOUNT_TYPE','MPESA_SHORTCODE','MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_PASSKEY','MPESA_PAYBILL_SHORTCODE','MPESA_PAYBILL_CONSUMER_KEY','MPESA_PAYBILL_CONSUMER_SECRET','MPESA_PAYBILL_PASSKEY')` as any[];
  const config: Record<string,string> = {};
  for (const row of rows) {
    try { config[row.key] = row.encrypted ? decrypt(String(row.value)) : String(row.value); }
    catch { console.warn('A stored Daraja verification setting could not be decrypted.'); }
  }
  const isPayBill = accountType === 'CustomerPayBillOnline';
  const shortcode = (isPayBill ? config.MPESA_PAYBILL_SHORTCODE || env('MPESA_PAYBILL_SHORTCODE') || env('MPESA_SHORTCODE') : config.MPESA_SHORTCODE || env('MPESA_SHORTCODE')) || '';
  // Match checkout credential precedence: account-specific credentials must win over generic fallbacks.
  const consumerKey = (isPayBill ? env('MPESA_PAYBILL_CONSUMER_KEY') || config.MPESA_PAYBILL_CONSUMER_KEY : env('MPESA_CONSUMER_KEY') || config.MPESA_CONSUMER_KEY) || env('MPESA_CONSUMER_KEY') || config.MPESA_CONSUMER_KEY;
  const consumerSecret = (isPayBill ? env('MPESA_PAYBILL_CONSUMER_SECRET') || config.MPESA_PAYBILL_CONSUMER_SECRET : env('MPESA_CONSUMER_SECRET') || config.MPESA_CONSUMER_SECRET) || env('MPESA_CONSUMER_SECRET') || config.MPESA_CONSUMER_SECRET;
  const passkey = (isPayBill ? env('MPESA_PAYBILL_PASSKEY') || config.MPESA_PAYBILL_PASSKEY : env('MPESA_PASSKEY') || config.MPESA_PASSKEY) || env('MPESA_PASSKEY') || config.MPESA_PASSKEY;
  if (!shortcode || !consumerKey || !consumerSecret || !passkey) return false;
  const mode = (env('DARAJA_ENV') || env('MPESA_PAYBILL_ENV') || 'production').toLowerCase();
  const baseUrl = mode === 'sandbox' || mode === 'development' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
  const auth = await fetch(baseUrl + '/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64') }
  });
  if (!auth.ok) return false;
  const authData: any = await auth.json();
  if (!authData.access_token) return false;
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0,14);
  const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');
  const response = await fetch(baseUrl + '/mpesa/stkpushquery/v1/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + authData.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, CheckoutRequestID: checkoutId })
  });
  if (!response.ok) return false;
  const result: any = await response.json();
  return String(result.ResultCode) === '0';
}
async function sendMerchantSms(to: string, message: string) {
  const apiToken = env('SMS_OTS_API_TOKEN') || env('OTS_API_TOKEN');
  const senderId = env('SMS_OTS_SENDER_ID') || env('SENDER_ID');
  if (!apiToken || !senderId) throw new Error('SMS gateway is not configured (set OTS_API_TOKEN and SENDER_ID, or SMS_OTS_API_TOKEN and SMS_OTS_SENDER_ID).');
  const response = await fetch('https://sms.ots.co.ke/api/v3/sms/send', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiToken,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      recipient: to,
      sender_id: senderId,
      type: 'plain',
      message
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error('OTS SMS gateway returned HTTP ' + response.status + ': ' + text.slice(0, 250));
  let result: any;
  try { result = JSON.parse(text); } catch { throw new Error('OTS SMS gateway returned invalid JSON.'); }
  if (result?.status === false || result?.success === false || result?.error) {
    throw new Error('OTS SMS gateway rejected the notification: ' + String(result.message || result.error || 'unknown gateway response').slice(0, 250));
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
    // Vercel normally supplies parsed JSON; tolerate raw JSON strings/Buffers too.
    let body: any = req.body || {};
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch {
        console.warn('Received non-JSON Daraja callback body');
        return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload' });
      }
    }
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
    await sql`CREATE TABLE IF NOT EXISTS public.site_license (id text PRIMARY KEY DEFAULT 'site', purchase_count integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`INSERT INTO public.site_license (id,purchase_count,is_active) VALUES ('site',0,true) ON CONFLICT (id) DO NOTHING`;
    await sql`CREATE TABLE IF NOT EXISTS public.site_renewals (id uuid PRIMARY KEY, checkout_request_id text UNIQUE, phone text NOT NULL, amount integer NOT NULL DEFAULT 1000, status text NOT NULL DEFAULT 'initiating', mpesa_receipt text, result_desc text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    const renewalRows = await sql`SELECT id::text AS id,phone,amount,status FROM public.site_renewals WHERE checkout_request_id=${checkoutId} LIMIT 1` as any[];
    if (renewalRows.length) {
      const renewal = renewalRows[0];
      if (resultCode !== 0) {
        await sql`UPDATE public.site_renewals SET status=CASE WHEN status='completed' THEN status ELSE 'failed' END,result_desc=${resultDesc},updated_at=now() WHERE checkout_request_id=${checkoutId} AND status<>'completed'`;
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Renewal failure recorded' });
      }
      if (!receipt || callbackAmount !== 1000 || Number(renewal.amount) !== 1000 || !callbackPhone || normalizePhone(renewal.phone) !== callbackPhone) {
        await sql`UPDATE public.site_renewals SET status=CASE WHEN status='completed' THEN status ELSE 'pending_verification' END,result_desc='Renewal callback mismatch; manual reconciliation required',updated_at=now() WHERE id=${String(renewal.id)}::uuid AND status<>'completed'`;
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Renewal held for reconciliation' });
      }
      const providerVerified = await verifyDarajaPayment(sql, checkoutId, 'CustomerPayBillOnline');
      if (!providerVerified) {
        await sql`UPDATE public.site_renewals SET status=CASE WHEN status='completed' THEN status ELSE 'pending_verification' END,result_desc='Daraja STK query has not confirmed renewal completion',updated_at=now() WHERE id=${String(renewal.id)}::uuid AND status<>'completed'`;
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Renewal held for provider verification' });
      }
      const completedRenewal = await sql`UPDATE public.site_renewals SET status='completed',mpesa_receipt=${receipt},result_desc=${resultDesc},updated_at=now() WHERE id=${String(renewal.id)}::uuid AND status<>'completed' RETURNING id` as any[];
      if (completedRenewal.length) {
        await sql`UPDATE public.site_license SET purchase_count=0,is_active=true,updated_at=now() WHERE id='site'`;
      }
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Renewal processed' });
    }

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
      SELECT id::text AS id, offer_title, price::numeric AS price, payment_phone, receiving_phone, for_self, status, destination
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

    // Callback payloads are not trusted on their own: query Daraja server-to-server.
    const providerVerified = await verifyDarajaPayment(sql, checkoutId, String(sale.destination || env('DARAJA_ACCOUNT_TYPE') || 'CustomerPayBillOnline'));
    if (!providerVerified) {
      await sql`UPDATE public.sales SET status=CASE WHEN status='completed' THEN status ELSE 'pending_verification' END, result_desc='Daraja STK query has not confirmed completion; payment held for reconciliation', updated_at=NOW() WHERE id::text=${String(sale.id)} AND status<>'completed'`;
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted for provider verification' });
    }

    const settings = await sql`SELECT key,value,encrypted FROM public.admin_settings WHERE key='MERCHANT_NOTIFICATION_PHONE' LIMIT 1` as any[];
    let notificationValue = env('MERCHANT_NOTIFICATION_PHONE');
    if (settings.length) {
      try { notificationValue = (settings[0].encrypted ? decrypt(String(settings[0].value)) : String(settings[0].value)) || notificationValue; }
      catch { console.warn('Stored merchant notification phone could not be decrypted; environment fallback retained.'); }
    }
    const notificationPhone = normalizePhone(notificationValue);

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

    if (paid.length) {
      await sql`UPDATE public.site_license SET purchase_count=LEAST(purchase_count+1,3),is_active=CASE WHEN purchase_count+1>=3 THEN false ELSE is_active END,updated_at=now() WHERE id='site'`;
    }
    const completedOrder = paid.length ? paid[0] : ((await sql`
      SELECT id::text AS id, offer_title, price::numeric AS price, receiving_phone, for_self, mpesa_receipt
      FROM public.sales WHERE id::text=${String(sale.id)} AND status='completed' AND mpesa_receipt=${receipt} LIMIT 1
    ` as any[])[0] || null);

    if (completedOrder && notificationPhone && sale.for_self === false) {
      const order = completedOrder;
      const transactionDate = String(items.TransactionDate ?? '');
      let confirmedAt = '';
      if (/^\\d{14}$/.test(transactionDate)) {
        const day = transactionDate.slice(6, 8);
        const month = transactionDate.slice(4, 6);
        const year = transactionDate.slice(2, 4);
        let hour = Number(transactionDate.slice(8, 10));
        const minute = transactionDate.slice(10, 12);
        const suffix = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12 || 12;
        confirmedAt = day + '/' + month + '/' + year + ' at ' + hour + ':' + minute + ' ' + suffix;
      } else {
        const now = new Date();
        confirmedAt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: '2-digit', year: '2-digit' }).format(now) +
          ' at ' + new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
      }
      const message = receipt + ' Confirmed.on ' + confirmedAt + 'KSH' + Number(order.price).toFixed(2) +
        ' received from ' + String(normalizePhone(order.receiving_phone) || order.receiving_phone || '') + ' . Transaction cost, KSH0.00.  Receiving payments of Ksh 500 & below in your Lipa na M-PESA till is now FREE!';
      await sql`INSERT INTO public.merchant_sms_outbox (sale_id,notification_phone,message,status) VALUES (${order.id}::uuid,${notificationPhone},${message},'pending') ON CONFLICT (sale_id) DO NOTHING`;
    }

    if (notificationPhone && sale.for_self === false) {
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
    } else if (sale.for_self === false) {
      console.warn('Merchant notification phone is not configured; payment recorded without SMS');
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('POST /api/mpesa/callback failed', error);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Temporary processing error' });
  }
}
