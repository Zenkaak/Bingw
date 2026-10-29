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
  const digits = String(value ?? '').replace(/[\\s+()-]/g, '');
  if (/^0[17]\\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^254[17]\\d{8}$/.test(digits)) return digits;
  return null;
}
async function readSettings(sql: any) {
  const values: Record<string, string> = {};
  try {
    const rows = await sql`SELECT key,value,encrypted FROM public.admin_settings WHERE key IN (
      'DARAJA_ACCOUNT_TYPE','MPESA_SHORTCODE','PARTY_B','MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_PASSKEY',
      'MPESA_PAYBILL_SHORTCODE','MPESA_PAYBILL_PARTY_B','MPESA_PAYBILL_ACCOUNT_REFERENCE',
      'MPESA_PAYBILL_CONSUMER_KEY','MPESA_PAYBILL_CONSUMER_SECRET','MPESA_PAYBILL_PASSKEY','MERCHANT_NOTIFICATION_PHONE'
    )` as any[];
    for (const row of rows) {
      try {
        const value = row.encrypted ? decrypt(String(row.value)) : String(row.value);
        if (value.trim()) values[row.key] = value.trim();
      } catch { console.warn('A stored M-PESA setting could not be decrypted; environment fallback retained.'); }
    }
  } catch { console.warn('Saved M-PESA settings are unavailable; environment configuration will be used.'); }
  return values;
}
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Method not allowed' }); }
  const dbUrl = env('POSTGRES_URL') || env('DATABASE_URL');
  if (!dbUrl) return json(res, 503, { error: 'Order database is not configured. No payment was initiated.', missingConfiguration: ['POSTGRES_URL'] });

  const sql = neon(dbUrl);
  const saved = await readSettings(sql);
  // Vercel environment variables take precedence for Daraja API credentials.
  // Database values are only a fallback for values already saved in admin settings.
  const accountType = (saved.DARAJA_ACCOUNT_TYPE || env('DARAJA_ACCOUNT_TYPE') || env('MPESA_PAYBILL_ACCOUNT_TYPE') || 'CustomerPayBillOnline').trim();
  const isPayBill = accountType === 'CustomerPayBillOnline';
  const consumerKey = (isPayBill ? env('MPESA_PAYBILL_CONSUMER_KEY') : '') || env('MPESA_CONSUMER_KEY') ||
    (isPayBill ? saved.MPESA_PAYBILL_CONSUMER_KEY : '') || saved.MPESA_CONSUMER_KEY;
  const consumerSecret = (isPayBill ? env('MPESA_PAYBILL_CONSUMER_SECRET') : '') || env('MPESA_CONSUMER_SECRET') ||
    (isPayBill ? saved.MPESA_PAYBILL_CONSUMER_SECRET : '') || saved.MPESA_CONSUMER_SECRET;
  const shortcode = (isPayBill
    ? saved.MPESA_PAYBILL_SHORTCODE || env('MPESA_PAYBILL_SHORTCODE') || env('MPESA_SHORTCODE')
    : saved.MPESA_SHORTCODE || env('MPESA_SHORTCODE'));
  const passkey = (isPayBill ? env('MPESA_PAYBILL_PASSKEY') : '') || env('MPESA_PASSKEY') ||
    (isPayBill ? saved.MPESA_PAYBILL_PASSKEY : '') || saved.MPESA_PASSKEY;
  const partyB = isPayBill
    ? (saved.MPESA_PAYBILL_PARTY_B || env('MPESA_PAYBILL_PARTY_B') || shortcode)
    : (saved.PARTY_B || env('PARTY_B') || shortcode);
  const accountReference = isPayBill
    ? (saved.MPESA_PAYBILL_ACCOUNT_REFERENCE || env('MPESA_PAYBILL_ACCOUNT_REFERENCE'))
    : (env('MPESA_ACCOUNT_REFERENCE') || 'BUNDLEBUY');
  const darajaEnv = (env('DARAJA_ENV') || env('MPESA_PAYBILL_ENV') || 'production').toLowerCase();
  const callbackUrl = env('DARAJA_CALLBACK_URL') || env('MPESA_CALLBACK_URL');

  const missing: string[] = [];
  if (!consumerKey) missing.push(isPayBill ? 'MPESA_PAYBILL_CONSUMER_KEY or MPESA_CONSUMER_KEY' : 'MPESA_CONSUMER_KEY');
  if (!consumerSecret) missing.push(isPayBill ? 'MPESA_PAYBILL_CONSUMER_SECRET or MPESA_CONSUMER_SECRET' : 'MPESA_CONSUMER_SECRET');
  if (!passkey) missing.push(isPayBill ? 'MPESA_PAYBILL_PASSKEY or MPESA_PASSKEY' : 'MPESA_PASSKEY');
  if (!shortcode) missing.push(isPayBill ? 'MPESA_PAYBILL_SHORTCODE' : 'MPESA_SHORTCODE');
  if (!partyB) missing.push(isPayBill ? 'MPESA_PAYBILL_PARTY_B' : 'PARTY_B');
  if (isPayBill && !accountReference) missing.push('MPESA_PAYBILL_ACCOUNT_REFERENCE');
  if (!callbackUrl) missing.push('DARAJA_CALLBACK_URL');
  if (missing.length) return json(res, 503, { error: 'Payment service is not fully configured. No payment was initiated.', missingConfiguration: missing });
  if (!/^https:\/\//i.test(callbackUrl)) return json(res, 503, { error: 'A public HTTPS Daraja callback URL is required.' });
  if (!['CustomerBuyGoodsOnline', 'CustomerPayBillOnline'].includes(accountType)) return json(res, 503, { error: 'Select CustomerBuyGoodsOnline or CustomerPayBillOnline in Admin → API credentials.' });
  if (!/^\\d{5,7}$/.test(shortcode) || !/^\\d{5,7}$/.test(partyB)) return json(res, 503, { error: 'The configured merchant shortcode or Party B is invalid.' });
  if (!['production', 'live', 'sandbox', 'development'].includes(darajaEnv)) return json(res, 503, { error: 'Invalid Daraja environment setting.' });

  const { offerId, phone, receivingPhone, forSelf = true } = req.body || {};
  const customerPhone = phoneNumber(phone);
  const destinationPhone = phoneNumber(receivingPhone || phone);
  if (!offerId || typeof offerId !== 'string' || offerId.length > 100 || !customerPhone || !destinationPhone) return json(res, 400, { error: 'Provide a valid offer and Kenyan phone number.' });

  try {
    const offers = await sql`SELECT id,title,price::numeric AS price FROM public.deals WHERE id::text=${offerId} AND active=true LIMIT 1` as any[];
    if (!offers.length) return json(res, 404, { error: 'This offer is unavailable.' });
    const offer = offers[0];
    const amount = Math.round(Number(offer.price));
    if (!Number.isFinite(amount) || amount < 1 || amount > 250000) return json(res, 400, { error: 'Offer price is not valid for M-PESA checkout.' });
    const baseUrl = darajaEnv === 'sandbox' || darajaEnv === 'development' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
    const authResponse = await fetch(baseUrl + '/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: 'Basic ' + Buffer.from(consumerKey + ':' + consumerSecret).toString('base64') }
    });
    if (!authResponse.ok) { console.error('Daraja OAuth failed with status', authResponse.status); return json(res, 502, { error: 'M-PESA authentication failed. No payment was initiated.' }); }
    const auth = await authResponse.json() as { access_token?: string };
    if (!auth.access_token) return json(res, 502, { error: 'M-PESA did not return an access token.' });
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');
    const saleId = crypto.randomUUID();
    await sql`INSERT INTO public.sales
      (id,offer_id,offer_title,service,price,commission,payment_phone,receiving_phone,for_self,gateway_enabled,destination,status,created_at,updated_at)
      VALUES (${saleId}::uuid,${String(offer.id)},${String(offer.title)},'mpesa',${amount},0,${customerPhone},${destinationPhone},${Boolean(forSelf)},true,${accountType},'initiating',NOW(),NOW())`;
    const payload = {
      BusinessShortCode: shortcode, Password: password, Timestamp: timestamp, TransactionType: accountType,
      Amount: amount, PartyA: customerPhone, PartyB: partyB, PhoneNumber: customerPhone, CallBackURL: callbackUrl,
      AccountReference: String(accountReference || 'BUNDLEBUY').slice(0, 12), TransactionDesc: 'BUNDLEBUY'
    };
    const stkResponse = await fetch(baseUrl + '/mpesa/stkpush/v1/processrequest', {
      method: 'POST', headers: { Authorization: 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const stk = await stkResponse.json() as { ResponseCode?: string; ResponseDescription?: string; CustomerMessage?: string; CheckoutRequestID?: string; MerchantRequestID?: string; errorMessage?: string };
    if (!stkResponse.ok || stk.ResponseCode !== '0' || !stk.CheckoutRequestID) {
      await sql`UPDATE public.sales SET status='failed',result_desc=${String(stk.errorMessage || stk.ResponseDescription || 'STK request failed').slice(0,500)},updated_at=NOW() WHERE id=${saleId}::uuid`;
      console.error('Daraja STK request failed', JSON.stringify({ httpStatus: stkResponse.status, responseCode: stk.ResponseCode, responseDescription: stk.ResponseDescription, errorMessage: stk.errorMessage }));
      return json(res, 502, { error: String(stk.errorMessage || stk.ResponseDescription || 'Daraja rejected the STK request. Check account type, shortcode, Party B, passkey, and production access.').slice(0,300), paymentInitiated: false });
    }
    await sql`UPDATE public.sales SET status='pending',checkout_request_id=${stk.CheckoutRequestID},result_desc=${String(stk.ResponseDescription || 'STK push sent').slice(0,500)},updated_at=NOW() WHERE id=${saleId}::uuid`;
    return json(res, 200, { saleId, status: 'pending', message: stk.CustomerMessage || 'Check your phone and enter your M-PESA PIN to complete payment.' });
  } catch (error) {
    console.error('POST /api/mpesa/stkpush failed', error);
    return json(res, 500, { error: 'Could not initiate payment. Please try again.' });
  }
}
