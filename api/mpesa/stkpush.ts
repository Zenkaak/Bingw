import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const json = (res: any, status: number, body: unknown) => res.status(status).json(body);
const env = (key: string) => (process.env[key] || '').trim();
function decrypt(value: string) {
  const key = Buffer.from(env('ADMIN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('Admin encryption key is not configured.');
  const [iv, tag, data] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

function phoneNumber(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[\s+()-]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const dbUrl = env('POSTGRES_URL') || env('DATABASE_URL');
  let consumerKey = env('MPESA_CONSUMER_KEY');
  let consumerSecret = env('MPESA_CONSUMER_SECRET');
  let passkey = env('MPESA_PASSKEY');
  let shortcode = env('MPESA_SHORTCODE');
  let partyB = env('PARTY_B') || shortcode;
  let sql: ReturnType<typeof neon> | null = dbUrl ? neon(dbUrl) : null;
  if (sql) {
    try {
      const saved = await sql`SELECT key,value,encrypted FROM public.admin_settings WHERE key IN ('MPESA_SHORTCODE','PARTY_B','MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_PASSKEY')` as any[];
      for (const row of saved as any[]) {
        const value = row.encrypted ? decrypt(String(row.value)) : String(row.value);
        if (row.key === 'MPESA_SHORTCODE') shortcode = value;
        if (row.key === 'PARTY_B') partyB = value;
        if (row.key === 'MPESA_CONSUMER_KEY') consumerKey = value;
        if (row.key === 'MPESA_CONSUMER_SECRET') consumerSecret = value;
        if (row.key === 'MPESA_PASSKEY') passkey = value;
      }
    } catch (error) { console.warn('Admin payment settings unavailable; using server environment configuration.'); }
  }
  const accountType = env('DARAJA_ACCOUNT_TYPE') || env('MPESA_ACCOUNT_TYPE') || 'CustomerBuyGoodsOnline';
  const darajaEnv = (env('DARAJA_ENV') || 'production').toLowerCase();
  const callbackUrl = env('DARAJA_CALLBACK_URL') || env('MPESA_CALLBACK_URL');

  if (!dbUrl || !consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl) {
    return json(res, 503, { error: 'Payment service is not fully configured. No payment was initiated.' });
  }
  if (!/^https:\/\//i.test(callbackUrl)) {
    return json(res, 503, { error: 'A public HTTPS Daraja callback URL is required.' });
  }
  if (!['CustomerBuyGoodsOnline', 'CustomerPayBillOnline'].includes(accountType)) {
    return json(res, 503, { error: 'Unsupported Daraja transaction type.' });
  }
  if (!/^\d{5,7}$/.test(shortcode)) {
    return json(res, 503, { error: 'The configured M-PESA shortcode is invalid.' });
  }
  if (!['production', 'live', 'sandbox', 'development'].includes(darajaEnv)) {
    return json(res, 503, { error: 'Invalid Daraja environment setting.' });
  }

  const { offerId, phone, receivingPhone, forSelf = true } = req.body || {};
  const customerPhone = phoneNumber(phone);
  const destinationPhone = phoneNumber(receivingPhone || phone);
  if (!offerId || typeof offerId !== 'string' || offerId.length > 100 || !customerPhone || !destinationPhone) {
    return json(res, 400, { error: 'Provide a valid offer and Kenyan phone number.' });
  }

  try {
    if (!sql) sql = neon(dbUrl);
    const offers = await sql`
      SELECT id, title, price::numeric AS price
      FROM public.deals
      WHERE id::text = ${offerId} AND active = true
      LIMIT 1
    ` as any[];
    if (!offers.length) return json(res, 404, { error: 'This offer is unavailable.' });
    const offer = offers[0];
    const amount = Math.round(Number(offer.price));
    if (!Number.isFinite(amount) || amount < 1 || amount > 250000) {
      return json(res, 400, { error: 'Offer price is not valid for M-PESA checkout.' });
    }

    const baseUrl = darajaEnv === 'sandbox' || darajaEnv === 'development'
      ? 'https://sandbox.safaricom.co.ke'
      : 'https://api.safaricom.co.ke';
    const authResponse = await fetch(baseUrl + '/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64') }
    });
    if (!authResponse.ok) {
      console.error('Daraja OAuth failed with status', authResponse.status);
      return json(res, 502, { error: 'M-PESA authentication failed. No payment was initiated.' });
    }
    const auth = await authResponse.json() as { access_token?: string };
    if (!auth.access_token) return json(res, 502, { error: 'M-PESA did not return an access token.' });

    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');
    const transactionType = accountType;
    const saleId = crypto.randomUUID();

    await sql`
      INSERT INTO public.sales
        (id, offer_id, offer_title, service, price, commission, payment_phone, receiving_phone,
         for_self, gateway_enabled, destination, status, created_at, updated_at)
      VALUES
        (${saleId}::uuid, ${String(offer.id)}, ${String(offer.title)}, 'mpesa',
         ${amount}, 0, ${customerPhone}, ${destinationPhone}, ${Boolean(forSelf)},
         true, ${transactionType}, 'initiating', NOW(), NOW())
    `;

    const payload: Record<string, unknown> = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: customerPhone,
      PartyB: partyB,
      PhoneNumber: customerPhone,
      CallBackURL: callbackUrl,
      AccountReference: 'BLACKHOLE',
      TransactionDesc: 'BUNDLEBUY'
    };

    // Buy Goods online uses the Till as PartyB; PayBill uses the configured PayBill.
    if (transactionType === 'CustomerBuyGoodsOnline') {
      payload.BusinessShortCode = shortcode;
      payload.PartyB = partyB;
    } else {
      payload.PartyB = partyB;
    }

    const stkResponse = await fetch(baseUrl + '/mpesa/stkpush/v1/processrequest', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const stk = await stkResponse.json() as {
      ResponseCode?: string; ResponseDescription?: string; CustomerMessage?: string;
      CheckoutRequestID?: string; MerchantRequestID?: string; errorMessage?: string;
    };

    if (!stkResponse.ok || stk.ResponseCode !== '0' || !stk.CheckoutRequestID) {
      await sql`
        UPDATE public.sales SET status = 'failed', result_desc = ${String(stk.errorMessage || stk.ResponseDescription || 'STK request failed').slice(0, 500)}, updated_at = NOW()
        WHERE id = ${saleId}::uuid
      `;
      console.error('Daraja STK request failed', JSON.stringify({ httpStatus: stkResponse.status, responseCode: stk.ResponseCode, responseDescription: stk.ResponseDescription, errorMessage: stk.errorMessage }));
      return json(res, 502, { error: String(stk.errorMessage || stk.ResponseDescription || 'Daraja rejected the STK request. Check shortcode, Party B, transaction type, passkey, and production access.').slice(0, 300), paymentInitiated: false });
    }

    await sql`
      UPDATE public.sales
      SET status = 'pending', checkout_request_id = ${stk.CheckoutRequestID},
          result_desc = ${String(stk.ResponseDescription || 'STK push sent').slice(0, 500)}, updated_at = NOW()
      WHERE id = ${saleId}::uuid
    `;
    return json(res, 200, {
      saleId,
      status: 'pending',
      message: stk.CustomerMessage || 'Check your phone and enter your M-PESA PIN to complete payment.'
    });
  } catch (error) {
    console.error('POST /api/mpesa/stkpush failed', error);
    return json(res, 500, { error: 'Could not initiate payment. Please try again.' });
  }
}
