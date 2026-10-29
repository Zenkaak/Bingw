import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const env = (k: string) => (process.env[k] || '').trim();
const db = () => {
  const url = env('POSTGRES_URL') || env('DATABASE_URL');
  if (!url) throw new Error('Database is not configured.');
  return neon(url);
};
const send = (res: any, status: number, body: unknown) => res.status(status).json(body);
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const passwordHash = (password: string, salt: string) => crypto.scryptSync(password, salt, 64).toString('hex');
const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function encrypt(value: string) {
  const key = Buffer.from(env('ADMIN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('ADMIN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}
function tokenFrom(req: any) {
  const cookie = String(req.headers.cookie || '').split(';').map((x: string) => x.trim()).find((x: string) => x.startsWith('bh_admin='));
  return cookie ? decodeURIComponent(cookie.slice('bh_admin='.length)) : '';
}
function cookie(res: any, token: string, maxAge: number) {
  res.setHeader('Set-Cookie', `bh_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
}
async function setup(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS public.admin_users (id text PRIMARY KEY, password_hash text NOT NULL, password_salt text NOT NULL, must_change_password boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS public.admin_sessions (token_hash text PRIMARY KEY, admin_id text NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS public.admin_settings (key text PRIMARY KEY, value text NOT NULL, encrypted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now())`;
  const existing = await sql`SELECT id FROM public.admin_users WHERE id = 'primary' LIMIT 1`;
  if (!existing.length) {
    const salt = crypto.randomBytes(16).toString('hex');
    await sql`INSERT INTO public.admin_users (id,password_hash,password_salt,must_change_password) VALUES ('primary',${passwordHash('098098', salt)},${salt},true) ON CONFLICT (id) DO NOTHING`;
  }
}
async function authenticated(sql: any, req: any) {
  const token = tokenFrom(req);
  if (!token) return null;
  const rows = await sql`SELECT u.id,u.must_change_password FROM public.admin_sessions s JOIN public.admin_users u ON u.id=s.admin_id WHERE s.token_hash=${hash(token)} AND s.expires_at > now() LIMIT 1`;
  return rows[0] || null;
}
export default async function handler(req: any, res: any) {
  if (!['GET','POST','PATCH','DELETE'].includes(req.method)) { res.setHeader('Allow','GET, POST, PATCH, DELETE'); return send(res,405,{error:'Method not allowed'}); }
  try {
    const sql = db(); await setup(sql);
    const body = req.body || {}; const action = String(req.query?.action || body.action || '');
    if (action === 'login' && req.method === 'POST') {
      const username = String(body.username || 'admin').trim();
      const password = String(body.password || '');
      const rows = await sql`SELECT id,password_hash,password_salt,must_change_password FROM public.admin_users WHERE id='primary' LIMIT 1`;
      const user = rows[0];
      if (username.toLowerCase() !== 'admin' || !user || !safeEqual(passwordHash(password,user.password_salt),user.password_hash)) return send(res,401,{error:'Invalid admin credentials.'});
      const token = crypto.randomBytes(32).toString('base64url');
      await sql`INSERT INTO public.admin_sessions (token_hash,admin_id,expires_at) VALUES (${hash(token)},${user.id},now()+interval '12 hours')`;
      cookie(res,token,43200);
      return send(res,200,{ok:true,mustChangePassword:user.must_change_password});
    }
    if (action === 'logout' && req.method === 'POST') {
      const token=tokenFrom(req); if(token) await sql`DELETE FROM public.admin_sessions WHERE token_hash=${hash(token)}`;
      cookie(res,'',0); return send(res,200,{ok:true});
    }
    const user = await authenticated(sql,req);
    if (!user) return send(res,401,{error:'Admin login required.'});
    if (action === 'password' && req.method === 'POST') {
      const old = String(body.currentPassword || ''); const next = String(body.newPassword || '');
      if (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) return send(res,400,{error:'Use at least 10 characters with letters and numbers.'});
      const rows=await sql`SELECT password_hash,password_salt FROM public.admin_users WHERE id='primary'`;
      if (!safeEqual(passwordHash(old,rows[0].password_salt),rows[0].password_hash)) return send(res,403,{error:'Current password is incorrect.'});
      const salt=crypto.randomBytes(16).toString('hex');
      await sql`UPDATE public.admin_users SET password_hash=${passwordHash(next,salt)},password_salt=${salt},must_change_password=false,updated_at=now() WHERE id='primary'`;
      return send(res,200,{ok:true,mustChangePassword:false});
    }
    if (action === 'session' && req.method === 'GET') return send(res,200,{ok:true,mustChangePassword:user.must_change_password});
    if (user.must_change_password && action !== 'password') return send(res,403,{error:'Change the temporary password first.',mustChangePassword:true});
    if (action === 'dashboard' && req.method === 'GET') {
      const [summary, sales] = await Promise.all([
        sql`SELECT count(*)::int AS total_orders, count(*) FILTER (WHERE status IN ('completed','success','successful'))::int AS successful_orders, count(*) FILTER (WHERE status IN ('failed','cancelled','canceled','error'))::int AS failed_orders, COALESCE(sum(price) FILTER (WHERE status IN ('completed','success','successful')),0)::numeric AS sales_total FROM public.sales`,
        sql`SELECT id,offer_title,price,payment_phone,receiving_phone,service,destination,status,mpesa_receipt,result_desc,checkout_request_id,created_at,updated_at FROM public.sales ORDER BY created_at DESC LIMIT 200`
      ]);
      return send(res,200,{summary:summary[0],sales});
    }
    if (action === 'products' && req.method === 'GET') {
      const products=await sql`SELECT id,group_key,title,price::numeric AS price,validity,note,sort_order,active FROM public.deals ORDER BY sort_order,id`;
      return send(res,200,{products});
    }
    if (action === 'product' && req.method === 'POST') {
      const {id,group_key,title,price,validity,note,sort_order=0,active=true}=body;
      if (!title || !['bingwa','repeatable','minutes','sms'].includes(group_key) || !Number.isFinite(Number(price)) || Number(price)<=0 || !validity) return send(res,400,{error:'Provide a title, valid category, positive price, and validity.'});
      if (id) await sql`UPDATE public.deals SET group_key=${group_key},title=${String(title).slice(0,120)},price=${Number(price)},validity=${String(validity).slice(0,120)},note=${note ? String(note).slice(0,500) : null},sort_order=${Number(sort_order)||0},active=${Boolean(active)} WHERE id::text=${String(id)}`;
      else await sql`INSERT INTO public.deals (id,group_key,title,price,validity,note,sort_order,active) VALUES (${crypto.randomUUID()},${group_key},${String(title).slice(0,120)},${Number(price)},${String(validity).slice(0,120)},${note ? String(note).slice(0,500) : null},${Number(sort_order)||0},${Boolean(active)})`;
      return send(res,200,{ok:true});
    }
    if (action === 'product' && req.method === 'DELETE') {
      const id=String(req.query?.id || body.id || '');
      if (!id) return send(res,400,{error:'Product ID required.'});
      await sql`UPDATE public.deals SET active=false WHERE id::text=${id}`;
      return send(res,200,{ok:true});
    }
    if (action === 'settings' && req.method === 'GET') {
      const rows=await sql`SELECT key,value,encrypted,updated_at FROM public.admin_settings ORDER BY key`;
      const accountTypeRow=rows.find((r:any)=>r.key==='DARAJA_ACCOUNT_TYPE');
      const accountType=accountTypeRow && !accountTypeRow.encrypted ? String(accountTypeRow.value) : (env('DARAJA_ACCOUNT_TYPE') || env('MPESA_PAYBILL_ACCOUNT_TYPE') || 'CustomerPayBillOnline');
      return send(res,200,{settings:rows.map((r:any)=>({key:r.key,configured:true,updated_at:r.updated_at})),accountType});
    }
    if (action === 'settings' && req.method === 'POST') {
      const allowed = ['BUSINESS_NAME','DARAJA_ACCOUNT_TYPE','MPESA_SHORTCODE','PARTY_B','MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_PASSKEY','MERCHANT_NOTIFICATION_PHONE','MPESA_PAYBILL_SHORTCODE','MPESA_PAYBILL_PARTY_B','MPESA_PAYBILL_ACCOUNT_REFERENCE','MPESA_PAYBILL_CONSUMER_KEY','MPESA_PAYBILL_CONSUMER_SECRET','MPESA_PAYBILL_PASSKEY'];
      const values=body.values || {};
      for (const key of allowed) {
        if (values[key] === undefined || values[key] === '') continue;
        const value=String(values[key]).trim();
        if (key === 'DARAJA_ACCOUNT_TYPE' && !['CustomerBuyGoodsOnline','CustomerPayBillOnline'].includes(value)) return send(res,400,{error:'Select CustomerBuyGoodsOnline or CustomerPayBillOnline.'});
        if (key === 'BUSINESS_NAME' && (value.length < 2 || value.length > 100)) return send(res,400,{error:'Business name must be between 2 and 100 characters.'});
        if (key === 'MPESA_SHORTCODE' && !/^\d{5,7}$/.test(value)) return send(res,400,{error:'M-PESA shortcode must be 5–7 digits.'});
        if (['PARTY_B','MPESA_PAYBILL_SHORTCODE','MPESA_PAYBILL_PARTY_B'].includes(key) && !/^\d{5,7}$/.test(value)) return send(res,400,{error:'Till and PayBill shortcode fields must be 5–7 digits.'});
        if (key === 'MERCHANT_NOTIFICATION_PHONE' && !/^(?:0[17]\d{8}|254[17]\d{8})$/.test(value.replace(/[\s+()-]/g,''))) return send(res,400,{error:'Enter a valid Kenyan notification phone number.'});
        if (key === 'MPESA_PAYBILL_ACCOUNT_REFERENCE' && (value.length < 1 || value.length > 12 || !/^[A-Za-z0-9_-]+$/.test(value))) return send(res,400,{error:'Merchant account reference must be 1–12 letters, numbers, hyphens, or underscores.'});
        const secret=['MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_PASSKEY','MPESA_PAYBILL_CONSUMER_KEY','MPESA_PAYBILL_CONSUMER_SECRET','MPESA_PAYBILL_PASSKEY'].includes(key);
        const stored=secret ? encrypt(value) : value;
        await sql`INSERT INTO public.admin_settings (key,value,encrypted,updated_at) VALUES (${key},${stored},${secret},now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,encrypted=EXCLUDED.encrypted,updated_at=now()`;
      }
      return send(res,200,{ok:true,message:'Settings saved securely. Credential values cannot be viewed again.'});
    }
    if (action === 'test-sms' && req.method === 'POST') {
      const rows = await sql`SELECT value FROM public.admin_settings WHERE key='MERCHANT_NOTIFICATION_PHONE' LIMIT 1`;
      const rawPhone = String(rows[0]?.value || env('MERCHANT_NOTIFICATION_PHONE') || '').replace(/[\\s+()-]/g,'');
      const recipient = /^0[17]\\d{8}$/.test(rawPhone) ? '254' + rawPhone.slice(1) : /^254[17]\\d{8}$/.test(rawPhone) ? rawPhone : '';
      if (!recipient) return send(res,400,{error:'Save a valid Kenyan notification phone number before testing SMS.'});
      const username = env('AT_USERNAME');
      const apiKey = env('AT_API_KEY');
      const senderId = env('AT_SENDER_ID');
      if (!username || !apiKey) return send(res,503,{error:'SMS gateway is not configured. Add AT_USERNAME and AT_API_KEY to the Vercel production environment, then redeploy.'});
      const params = new URLSearchParams({username,to:'+' + recipient,message:'BLACKHOLE DATA SERVICES test SMS: your notification gateway is responding.'});
      if (senderId) params.set('from',senderId);
      const smsResponse = await fetch('https://api.africastalking.com/version1/messaging',{
        method:'POST',
        headers:{'apiKey':apiKey,'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'},
        body:params.toString()
      });
      const raw = await smsResponse.text();
      let result:any;
      try { result = JSON.parse(raw); } catch { result = null; }
      const recipientResult = result?.SMSMessageData?.Recipients?.find((item:any)=>String(item.number||'').replace(/^\\+/,'')===recipient);
      if (!smsResponse.ok || !recipientResult || !['Success','Sent'].includes(String(recipientResult.status||''))) {
        console.error('Test SMS gateway request failed',JSON.stringify({httpStatus:smsResponse.status,providerStatus:recipientResult?.status,providerCode:recipientResult?.statusCode}));
        return send(res,502,{error:'SMS provider did not confirm the test message. Check the Africa’s Talking account, sender ID, and message credits.'});
      }
      return send(res,200,{ok:true,message:'Test SMS accepted by the provider for +' + recipient + '. Delivery may take a short time.',providerStatus:recipientResult.status});
    }
    return send(res,404,{error:'Unknown admin action.'});
  } catch (error) {
    console.error('Admin API error',error);
    return send(res,500,{error:'Admin request failed. Check database and required server configuration.'});
  }
}
