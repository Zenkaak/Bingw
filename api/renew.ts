import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const env = (key: string) => (process.env[key] || '').trim();
const json = (res: any, status: number, body: unknown) => res.status(status).json(body);
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
function phoneNumber(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[\s+()-]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res,405,{error:'Method not allowed'}); }
  const dbUrl = env('POSTGRES_URL') || env('DATABASE_URL');
  if (!dbUrl) return json(res,503,{error:'Database is not configured.'});
  try {
    const sql = neon(dbUrl);
    const token = String(req.headers.cookie || '').split(';').map((x:string)=>x.trim()).find((x:string)=>x.startsWith('bh_admin='));
    const sessionToken = token ? decodeURIComponent(token.slice('bh_admin='.length)) : '';
    if (!sessionToken) return json(res,401,{error:'Admin login required.'});
    const sessions = await sql`SELECT u.must_change_password FROM public.admin_sessions s JOIN public.admin_users u ON u.id=s.admin_id WHERE s.token_hash=${hash(sessionToken)} AND s.expires_at>now() LIMIT 1` as any[];
    if (!sessions.length) return json(res,401,{error:'Admin login required.'});
    if (sessions[0].must_change_password) return json(res,403,{error:'Change the temporary admin password first.'});
    const phone = phoneNumber(req.body?.phone);
    if (!phone) return json(res,400,{error:'Enter a valid Kenyan M-PESA phone number.'});
    const shortcode = env('MPESA_PAYBILL_SHORTCODE') || env('MPESA_SHORTCODE');
    const consumerKey = env('MPESA_PAYBILL_CONSUMER_KEY') || env('MPESA_CONSUMER_KEY');
    const consumerSecret = env('MPESA_PAYBILL_CONSUMER_SECRET') || env('MPESA_CONSUMER_SECRET');
    const passkey = env('MPESA_PAYBILL_PASSKEY') || env('MPESA_PASSKEY');
    const callbackUrl = env('DARAJA_CALLBACK_URL') || env('MPESA_CALLBACK_URL');
    const mode = (env('DARAJA_ENV') || env('MPESA_PAYBILL_ENV') || 'production').toLowerCase();
    if (!shortcode || !/^\d{5,7}$/.test(shortcode) || !consumerKey || !consumerSecret || !passkey || !callbackUrl || !/^https:\/\//i.test(callbackUrl)) {
      return json(res,503,{error:'Renewal requires production PayBill credentials and a public HTTPS callback in Vercel environment variables.'});
    }
    const baseUrl = mode === 'sandbox' || mode === 'development' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
    const authResponse = await fetch(baseUrl + '/oauth/v1/generate?grant_type=client_credentials',{headers:{Authorization:'Basic '+Buffer.from(consumerKey+':'+consumerSecret).toString('base64')}});
    if (!authResponse.ok) return json(res,502,{error:'M-PESA authentication failed; no renewal prompt was sent.'});
    const auth = await authResponse.json() as {access_token?:string};
    if (!auth.access_token) return json(res,502,{error:'M-PESA did not return an access token.'});
    await sql`CREATE TABLE IF NOT EXISTS public.site_license (id text PRIMARY KEY DEFAULT 'site', purchase_count integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now())`;
    await sql`INSERT INTO public.site_license (id,purchase_count,is_active) VALUES ('site',0,true) ON CONFLICT (id) DO NOTHING`;
    // Renewal is intentionally available at any time, including before the three trial purchases are used.
    await sql`CREATE TABLE IF NOT EXISTS public.site_renewals (id uuid PRIMARY KEY, checkout_request_id text UNIQUE, phone text NOT NULL, amount integer NOT NULL DEFAULT 1000, status text NOT NULL DEFAULT 'initiating', mpesa_receipt text, result_desc text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    const renewalId = crypto.randomUUID();
    await sql`INSERT INTO public.site_renewals (id,phone,amount,status) VALUES (${renewalId}::uuid,${phone},1000,'initiating')`;
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
    const password = Buffer.from(shortcode+passkey+timestamp).toString('base64');
    const response = await fetch(baseUrl+'/mpesa/stkpush/v1/processrequest',{
      method:'POST',headers:{Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,TransactionType:'CustomerPayBillOnline',Amount:1000,PartyA:phone,PartyB:shortcode,PhoneNumber:phone,CallBackURL:callbackUrl,AccountReference:'SITE-RENEWAL',TransactionDesc:'SITE RENEWAL'})
    });
    const raw = await response.text(); let result:any; try { result=JSON.parse(raw); } catch { result=null; }
    if (!response.ok || result?.ResponseCode!=='0' || !result?.CheckoutRequestID) {
      await sql`UPDATE public.site_renewals SET status='failed',result_desc=${String(result?.errorMessage || result?.ResponseDescription || 'M-PESA rejected renewal prompt').slice(0,500)},updated_at=now() WHERE id=${renewalId}::uuid`;
      return json(res,502,{error:'M-PESA rejected the renewal request. No renewal was confirmed.'});
    }
    await sql`UPDATE public.site_renewals SET status='pending',checkout_request_id=${result.CheckoutRequestID},result_desc='Renewal STK prompt sent',updated_at=now() WHERE id=${renewalId}::uuid`;
    return json(res,200,{ok:true,renewalId,status:'pending',message:'Renewal prompt sent. Complete KES 1,000 payment on your phone.'});
  } catch (error) {
    console.error('Site renewal initiation failed',error);
    return json(res,500,{error:'Could not initiate site renewal.'});
  }
}
