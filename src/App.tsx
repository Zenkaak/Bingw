import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock3, Search, ShieldCheck, Smartphone } from 'lucide-react';
import Admin from './Admin';

type Offer = {
  id: string;
  group_key: string;
  title: string;
  price: number | string;
  validity: string;
  note: string | null;
  sort_order: number;
};

const groups = [
  { key: 'all', label: 'All offers' },
  { key: 'bingwa', label: 'Bingwa Data' },
  { key: 'repeatable', label: 'Repeatable Data' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'sms', label: 'SMS' },
];
const groupLabels: Record<string, string> = {
  bingwa: 'Bingwa Data',
  repeatable: 'Repeatable Data',
  minutes: 'Minutes',
  sms: 'SMS',
};

export default function App() {
  if (typeof window !== 'undefined' && (window.location.pathname === '/adm' || window.location.pathname === '/adm/')) return <Admin />;
  const [offers, setOffers] = useState<Offer[]>([]);
  const [businessName, setBusinessName] = useState('BLACKHOLE DATA SERVICES');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checkoutOffer, setCheckoutOffer] = useState<Offer | null>(null);
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [checkoutRecipientPhone, setCheckoutRecipientPhone] = useState('');
  const [forAnother, setForAnother] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<{ saleId: string; status: 'pending' | 'success' | 'failed' | 'timeout'; message: string } | null>(null);

  async function beginCheckout(offer: Offer) {
    const phone = checkoutPhone.trim();
    const recipientPhone = forAnother ? checkoutRecipientPhone.trim() : phone;
    if (!phone) { setNotice('Enter the M-PESA phone number to continue.'); return; }
    if (!recipientPhone) { setNotice('Enter the recipient phone number to continue.'); return; }
    setCheckoutPhone(phone);
    if (forAnother) setCheckoutRecipientPhone(recipientPhone);
    setCheckoutOffer(offer);
    setPaymentStatus(null);
    setCheckoutBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/mpesa/stkpush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offer.id, phone, receivingPhone: recipientPhone, forSelf: !forAnother })
      });
      const raw = await response.text();
      let result: any;
      try { result = JSON.parse(raw); }
      catch {
        const detail = raw.trim().slice(0, 180);
        throw new Error(raw.trim().startsWith('<') || raw.startsWith('A server error') || raw.startsWith('An error')
          ? 'The payment API returned a server error instead of JSON. No payment confirmation was received. Please try again later or check the deployment logs.'
          : 'Invalid response from payment service (' + response.status + '): ' + detail);
      }
      if (!response.ok) throw new Error(result.error || 'Could not start payment.');
      if (!result.saleId) throw new Error('The payment prompt was requested, but no order reference was returned. Contact support before trying again.');
      setCheckoutOffer(null);
      setPaymentStatus({ saleId: result.saleId, status: 'pending', message: 'M-PESA prompt sent. Complete the payment on the payment phone; we are checking the result automatically.' });
      setNotice('');
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 3000));
        try {
          const statusResponse = await fetch('/api/mpesa/order-status?saleId=' + encodeURIComponent(result.saleId), { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
          if (!statusResponse.ok) continue;
          const payment = await statusResponse.json();
          if (payment.status === 'success') {
            setPaymentStatus({ saleId: result.saleId, status: 'success', message: 'Your purchase is successful!' });
            return;
          }
          if (payment.status === 'failed') {
            setPaymentStatus({ saleId: result.saleId, status: 'failed', message: payment.message || 'Payment was not completed. You can start a new purchase.' });
            return;
          }
        } catch { /* Keep polling through temporary network errors. */ }
      }
      setPaymentStatus(current => current?.saleId === result.saleId && current.status === 'pending'
        ? { ...current, status: 'timeout', message: 'We are still waiting for M-PESA confirmation. This is not yet a successful payment; you can check again shortly.' }
        : current);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Payment could not be started.');
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function loadOffers() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/deals');
      if (!response.ok) throw new Error('Offers service is unavailable.');
      const data = await response.json();
      if (!Array.isArray(data.offers)) throw new Error('The offers response was invalid.');
      setOffers(data.offers);
    } catch {
      setError('We could not connect to the live offers catalogue. Please refresh in a moment.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOffers();
    fetch('/api/site-config').then(r => r.ok ? r.json() : null).then(data => {
      if (typeof data?.businessName === 'string' && data.businessName.trim()) setBusinessName(data.businessName.trim());
    }).catch(() => {});
  }, []);

  const filtered = useMemo(() => offers.filter((offer) => {
    const matchesGroup = group === 'all' || offer.group_key === group;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${offer.title} ${offer.validity} ${offer.note ?? ''} ${groupLabels[offer.group_key] ?? ''}`.toLowerCase().includes(query);
    return matchesGroup && matchesSearch;
  }), [offers, group, search]);

  return <div className="app-shell"><style>{`@keyframes brandGlow{0%,100%{opacity:1;transform:translateY(0)}50%{opacity:.9;transform:translateY(-1px)}} .brand{position:relative;isolation:isolate;animation:brandGlow 3s ease-in-out infinite;text-shadow:0 0 7px rgba(255,120,24,.16),0 0 16px rgba(255,65,0,.12)} .brand-fire{display:inline-block;position:relative;color:#123f25;background:linear-gradient(180deg,#fff2a1 0%,#ffad42 28%,#ff572e 58%,#b91c1c 100%);background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 1px 0 rgba(140,35,0,.22));animation:fireFlicker .9s ease-in-out infinite alternate} .brand-fire::after{content:"";position:absolute;inset:-5px -3px;z-index:-1;background:radial-gradient(ellipse at 50% 85%,rgba(255,95,20,.25),transparent 68%);filter:blur(7px);animation:fireGlow 1.4s ease-in-out infinite alternate;pointer-events:none} @keyframes fireFlicker{0%{transform:translateY(0) skewX(-1deg);filter:brightness(1)}35%{transform:translateY(-1px) skewX(1deg);filter:brightness(1.12)}70%{transform:translateY(0) skewX(-.5deg);filter:brightness(.98)}100%{transform:translateY(-1.5px) skewX(.5deg);filter:brightness(1.16)}} @keyframes fireGlow{from{opacity:.55;transform:scale(.94)}to{opacity:1;transform:scale(1.06)}} .header{position:sticky!important;top:0!important;z-index:30!important;background:rgba(255,255,255,.97)!important;backdrop-filter:blur(16px);border-bottom:1px solid #dce9df;box-shadow:0 7px 24px rgba(15,64,37,.075);isolation:isolate}.header>.brand{min-width:0;max-width:100%;align-items:center!important;flex:1 1 auto}.header>nav{justify-content:flex-end;flex:0 1 auto}.header>nav>a,.header>nav>span{min-height:38px;box-sizing:border-box;justify-content:center;transition:transform .16s ease,box-shadow .16s ease}.header>nav>a:hover{transform:translateY(-1px);box-shadow:0 5px 13px rgba(23,107,59,.22)!important}.deal-grid{align-items:start!important;grid-auto-rows:auto!important;gap:10px!important}.deal-card{height:auto!important;min-height:0!important;align-self:start!important;border:1px solid #b9dfc3!important;border-radius:13px!important;overflow:hidden!important;box-shadow:0 4px 14px rgba(17,80,43,.09)!important;background:linear-gradient(145deg,#f5fcf6 0%,#e4f4e8 100%)!important;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease!important}.deal-card:hover{transform:translateY(-2px);border-color:#83c49b!important;box-shadow:0 8px 22px rgba(17,80,43,.12)!important}.deal-details{display:block!important;padding:10px!important;background:linear-gradient(155deg,rgba(255,255,255,.35),rgba(220,243,226,.55))!important}.deal-bottom{margin-top:5px!important}.deal-details h3{font-size:14px!important;line-height:1.2!important;color:#163c27!important}.deal-location{margin-bottom:3px!important;line-height:1.2!important;color:#607c68!important}.deal-bottom strong{color:#176b3b!important}.deal-details .outline-btn{min-height:32px!important;margin-top:6px!important;padding:6px 8px!important;font-size:12px!important;background:linear-gradient(135deg,#16733d,#0e5d31)!important;color:#fff!important;border:1px solid #0e5d31!important;border-radius:9px!important;box-shadow:0 2px 5px rgba(17,80,43,.15)}.catalog-search{border:1px solid #d5e6d9!important;border-radius:12px!important;background:#fff!important;box-shadow:0 3px 12px rgba(15,64,37,.04)}.categories{display:flex!important;gap:7px!important;overflow-x:auto!important;padding:5px 1px 9px!important;scrollbar-width:thin}.categories .category{white-space:nowrap!important;border-radius:999px!important;border:1px solid #d8e6dc!important;background:#fff!important;color:#315741!important;padding:8px 13px!important;font-weight:750!important;transition:all .16s ease}.categories .category.active{background:#176b3b!important;color:#fff!important;border-color:#176b3b!important;box-shadow:0 3px 9px rgba(23,107,59,.2)}.categories .category:hover{border-color:#68ad7f!important;background:#eff8f1!important;color:#176b3b!important}.categories .category.active:hover{background:#0e5d31!important;color:#fff!important}@media(max-width:700px){.header{padding:10px 12px!important;gap:10px!important;align-items:center!important}.header>.brand{flex:1 1 100%;justify-content:center;white-space:normal!important;text-align:center;line-height:1.15!important;font-size:clamp(1rem,5vw,1.35rem)!important;letter-spacing:-.65px!important;gap:6px!important}.header>nav{width:100%;justify-content:center!important;gap:7px!important}.header>nav>a{flex:1 1 auto;padding:9px 11px!important}.header>nav>span{flex:0 0 auto;padding:8px 9px!important}}@media(max-width:380px){.header>.brand{font-size:1rem!important;gap:4px!important}.header>nav{gap:5px!important}.header>nav>a{font-size:11px!important;padding:8px 9px!important}.header>nav>span{font-size:9px!important}}@media(prefers-reduced-motion:reduce){.brand,.brand-fire,.brand-fire::after,.deal-card{animation:none!important;transition:none!important}}`}</style>
    <div className="topline" style={{display:"none"}}>
      <span>{businessName}</span>
      <span className="top-right">Kenya</span>
    </div>
    <header className="header" style={{padding:"10px clamp(12px,3vw,28px) 12px",minHeight:0,display:"flex",alignItems:"center",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}>
      <a className="brand" href="#home" aria-label={businessName} style={{display:"flex",alignItems:"center",gap:7,whiteSpace:"normal",textDecoration:"none",lineHeight:1.1,fontFamily:"inherit",fontWeight:950,fontSize:"clamp(1.05rem,3.7vw,1.8rem)",letterSpacing:"-.7px",color:"#124b2b"}}>{businessName.split(/(BLACKHOLE|DATA|SERVICES)/gi).map((part,index) => /^(BLACKHOLE|DATA|SERVICES)$/i.test(part) ? <span key={index} className="brand-fire">{part}</span> : part)}</a>
    </header>
    <main id="home">
      <section className="hero" style={{display:"none"}}>
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot"/> BUNDLES FOR YOUR EVERYDAY</div>
          <h1>Your bundle.<br/><em>Your budget.</em><br/>Stay connected.</h1>
          <p>Browse the Bingwa Data, repeatable bundles, minutes and SMS offers you shared. Clear prices and validity, all in one place.</p>
          <div className="hero-search"><Search size={20}/><input aria-label="Search offers" placeholder="Search data, minutes, WhatsApp..." value={search} onChange={e => setSearch(e.target.value)}/><button onClick={() => document.getElementById('offers')?.scrollIntoView({behavior:'smooth'})}>Find offers <ArrowUpRight size={17}/></button></div>
          <div className="hero-foot"><span><ShieldCheck size={16}/> Prices shown in KSh</span><span><Clock3 size={16}/> Validity shown per offer</span><span><CheckCircle2 size={16}/> Live catalogue</span></div>
        </div>
        <div className="hero-art"><div className="sun-shape"/><div className="art-card art-card-one"><span>STAY CONNECTED</span><strong>Good bundles.<br/>Clear prices.</strong><div className="art-emoji">📱</div></div><div className="art-card art-card-two"><div className="mini-emoji">📶</div><div><strong>Data & more</strong><small>Choose what suits you</small></div><span className="sparkle">✳</span></div><div className="floating-stamp">BINGWA<br/>SMART</div><div className="hero-plant">✳</div></div>
      </section>
      <section className="trust-strip" style={{display:"none"}}><div><strong>One clear catalogue</strong><span>Browse all active offers</span></div><div><strong>Know the validity</strong><span>Details shown up front</span></div><div><strong>Choose your bundle</strong><span>Simple payment</span></div></section>
      <section className="offers-section" id="offers" style={{paddingTop:2}}>
        
        <div className="hero-search catalog-search" style={{marginBottom:5,padding:"5px 8px",minHeight:34}}><input aria-label="Filter offers" placeholder="Filter offers..." value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div id="categories" className="categories" style={{marginBottom:5,gap:5}}>{groups.map(item => <button key={item.key} className={group === item.key ? 'category active' : 'category'} onClick={() => setGroup(item.key)}>{item.label}</button>)}</div>
        {loading && <div className="empty-state">Loading live offers…</div>}
        {!loading && error && <div className="empty-state">{error} <button className="category active" onClick={() => void loadOffers()}>Retry</button></div>}
        {!loading && !error && <div className="deal-grid">{filtered.map((offer, index) => <article className="deal-card" key={offer.id} style={{minHeight:0,height:"auto",alignSelf:"start"}}>
          <div className={`deal-image ${['sage','cream','peach','blue'][groups.findIndex(g => g.key === offer.group_key) % 4] ?? 'sage'}`} style={{height:0,minHeight:0,padding:0,display:"none"}}></div>
          <div className="deal-details" style={{padding:8}}><h3 style={{margin:"0 0 2px",fontSize:14,lineHeight:1.2}}>{offer.title}</h3><div className="deal-location" style={{marginBottom:2,fontSize:11,lineHeight:1.15}}>{offer.validity}</div><div className="deal-bottom"><div><strong>KSh {Number(offer.price).toLocaleString('en-KE')}</strong></div></div><button className="outline-btn" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7,width:"100%",minHeight:34,padding:"6px 8px",background:"linear-gradient(135deg,#f0faf2,#e1f4e6)",color:"#145c32",border:"1px solid #75bd8a",borderRadius:9,fontWeight:850,fontSize:12,cursor:"pointer",marginTop:6,boxShadow:"0 2px 6px rgba(17,80,43,.08)"}} onClick={() => { setCheckoutPhone(''); setCheckoutRecipientPhone(''); setForAnother(false); setNotice(''); setCheckoutOffer(offer); }} disabled={checkoutBusy}><span aria-hidden="true" style={{color:"#16803f",fontSize:15,lineHeight:1}}>▣</span>Buy package</button></div>
        </article>)}</div>}
        {!loading && !error && filtered.length === 0 && <div className="empty-state">No offers match your search. Try another word or category.</div>}
      </section>
      <section className="bottom-cta" id="how" style={{display:"none"}}><div><div className="eyebrow">SIMPLE AND TRANSPARENT</div><h2>Pick the bundle you need.</h2><p>Review the price and validity before checkout. Choose an offer and enter your M-PESA number to request a payment prompt.</p></div><button onClick={() => {setGroup('all');setSearch('');document.getElementById('offers')?.scrollIntoView({behavior:'smooth'});}}>Browse all offers <ArrowUpRight size={17}/></button></section>
    </main>
    <footer className="footer" style={{padding:"12px 0",marginTop:12}}><span>{businessName}</span></footer>
    <a href="https://wa.me/254769252572" target="_blank" rel="noreferrer" aria-label="Chat with BLACK HOLE DATA SERVICES on WhatsApp" style={{position:"fixed",right:16,bottom:24,zIndex:900,width:56,height:56,borderRadius:"50%",background:"#25D366",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 14px rgba(0,0,0,.25)",textDecoration:"none",fontSize:28,fontWeight:700}}><span aria-hidden="true">☎</span></a>
    {checkoutOffer && <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={(event) => { if (event.target === event.currentTarget && !checkoutBusy) setCheckoutOffer(null); }} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(10,18,16,.68)",backdropFilter:"blur(5px)",display:"grid",placeItems:"center",padding:"max(8px, env(safe-area-inset-top)) 10px max(8px, env(safe-area-inset-bottom))"}}>
      <form onSubmit={(event) => { event.preventDefault(); void beginCheckout(checkoutOffer); }} style={{position:"relative",width:"100%",maxWidth:390,maxHeight:"min(90dvh, 760px)",overflowY:"auto",overscrollBehavior:"contain",boxSizing:"border-box",background:"#fff",color:"#14231d",padding:0,borderRadius:18,boxShadow:"0 24px 70px rgba(0,0,0,.32)"}}>
        <div style={{background:"linear-gradient(135deg,#102b20,#174d36)",color:"#fff",padding:"16px 18px",borderRadius:"17px 17px 0 0"}}>
          <button type="button" aria-label="Close checkout" disabled={checkoutBusy} onClick={() => setCheckoutOffer(null)} style={{position:"absolute",right:16,top:16,width:36,height:36,borderRadius:"50%",border:"1px solid rgba(255,255,255,.28)",background:"rgba(255,255,255,.1)",color:"#fff",fontSize:22}}>×</button>
          <div style={{fontSize:10,fontWeight:800,letterSpacing:2,marginBottom:10}}>{businessName}</div>
          <div style={{fontSize:13,opacity:.8,marginBottom:5}}>PACKAGE CHECKOUT</div>
          <h2 id="checkout-title" style={{fontSize:21,lineHeight:1.2,margin:"0 42px 8px 0"}}>{checkoutOffer.title}</h2>
          <div style={{fontSize:27,fontWeight:850}}>KSh {Number(checkoutOffer.price).toLocaleString('en-KE')}</div>
        </div>
        <div style={{padding:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,padding:12,background:"#f2f7f4",border:"1px solid #dcebe1",borderRadius:12}}>
            <span style={{display:"grid",placeItems:"center",width:38,height:38,flexShrink:0,borderRadius:10,background:"#d9f5e3",color:"#116b3b",fontSize:20}}>▣</span>
            <div><div style={{fontSize:14,fontWeight:750}}>Pay with M-PESA</div><div style={{fontSize:12,color:"#5d6b63",marginTop:3}}>We'll send a payment prompt to your phone.</div></div>
          </div>
          <label htmlFor="mpesa-phone" style={{display:"block",fontSize:13,fontWeight:750,marginBottom:8}}>Your M-PESA phone number (payment)</label>
          <input id="mpesa-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={checkoutPhone} onChange={event => setCheckoutPhone(event.target.value)} required style={{display:"block",width:"100%",minHeight:46,padding:"11px 12px",border:"1px solid #cbd6cf",borderRadius:11,boxSizing:"border-box",fontSize:17,background:"#fff",color:"#14231d"}} />
          <div style={{fontSize:12,color:"#64736a",marginTop:7}}>Enter the number that should receive the M-PESA payment prompt. Never share your M-PESA PIN.</div>
          <button type="button" onClick={() => { setForAnother(v => !v); setCheckoutRecipientPhone(''); setNotice(''); }} disabled={checkoutBusy} style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",minHeight:38,marginTop:10,background:forAnother?"#edf8f0":"#fff",color:"#116b3b",border:"1px solid #8dc5a0",borderRadius:11,fontWeight:800,fontSize:14,cursor:"pointer"}}>{forAnother ? "Buying for another person ✓" : "Buy for another person"}</button>
          {forAnother && <div style={{marginTop:14}}>
            <label htmlFor="recipient-phone" style={{display:"block",fontSize:13,fontWeight:750,marginBottom:8}}>Recipient phone number</label>
            <input id="recipient-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={checkoutRecipientPhone} onChange={event => setCheckoutRecipientPhone(event.target.value)} required style={{display:"block",width:"100%",minHeight:52,padding:"13px 14px",border:"1px solid #cbd6cf",borderRadius:11,boxSizing:"border-box",fontSize:17,background:"#fff",color:"#14231d"}} />
            <div style={{fontSize:12,color:"#64736a",marginTop:7}}>The bundle will be sent to this number after payment is verified.</div>
          </div>}
          <button type="submit" disabled={checkoutBusy} style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",minHeight:46,marginTop:14,background:checkoutBusy?"#7a8a80":"#116b3b",color:"#fff",border:0,borderRadius:11,fontWeight:800,fontSize:16,cursor:checkoutBusy?"wait":"pointer"}}>{checkoutBusy ? "Sending STK prompt…" : "Pay with M-PESA →"}</button>
          {notice && <p role="status" style={{fontSize:13,lineHeight:1.5,color:notice.startsWith("Prompt has been sent")?"#116b3b":"#a32929",background:notice.startsWith("Prompt has been sent")?"#edf9f0":"#fff3f2",borderRadius:9,padding:11,margin:"14px 0 0"}}>{notice}</p>}
          <div style={{textAlign:"center",fontSize:11,color:"#7a877f",marginTop:14}}>Secure payment request · KSh pricing</div>
        </div>
      </form>
    </div>}
    {paymentStatus && <div role="dialog" aria-modal="true" aria-live="polite" style={{position:"fixed",inset:0,zIndex:1200,background:"rgba(7,20,13,.88)",backdropFilter:"blur(8px)",display:"grid",placeItems:"center",padding:20,color:"#fff",textAlign:"center"}}>
      {paymentStatus.status === 'success' && <div aria-hidden="true" style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none"}}>{Array.from({length:90},(_,i)=><span key={i} style={{position:"absolute",left:((i*37)%100)+"%",top:-24,width:7+(i%5),height:10+(i%7),borderRadius:i%3===0?"50%":"2px",background:["#ffd166","#06d6a0","#ef476f","#fff","#118ab2","#f78c6b"][i%6],transform:"rotate("+((i*47)%360)+"deg)",animation:"purchaseBurst "+(1.6+(i%8)*.22)+"s cubic-bezier(.1,.7,.3,1) "+((i%12)*.08)+"s forwards"}} />)}</div>}
      <div style={{position:"relative",maxWidth:420,width:"100%",padding:"30px 22px",borderRadius:24,background:paymentStatus.status==='success'?"linear-gradient(145deg,#14532d,#166534)":"#fff",color:paymentStatus.status==='success'?"#fff":"#14231d",boxShadow:"0 25px 80px rgba(0,0,0,.35)"}}>
        <style>{'@keyframes purchaseBurst{0%{transform:translateY(0) rotate(0) scale(.5);opacity:1}100%{transform:translateY(85vh) rotate(720deg) scale(1);opacity:0}}'}</style>
        <div style={{fontSize:48,marginBottom:12}}>{paymentStatus.status==='success'?'🎉':paymentStatus.status==='failed'?'⚠️':'📲'}</div>
        <h2 style={{fontSize:25,margin:"0 0 12px"}}>{paymentStatus.status==='success'?'Your purchase is successful!':paymentStatus.status==='failed'?'Payment not completed':paymentStatus.status==='timeout'?'Still confirming payment':'Waiting for payment'}</h2>
        <p style={{fontSize:15,lineHeight:1.6,margin:"0 0 20px"}}>{paymentStatus.message}</p>
        {paymentStatus.status==='pending' && <div style={{display:"flex",justifyContent:"center",gap:8,alignItems:"center",fontSize:13,opacity:.9}}><span style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",animation:"brandGlow 1s infinite"}}/>Checking M-PESA status…</div>}
        {paymentStatus.status==='timeout' && <button onClick={async()=>{const id=paymentStatus.saleId;setPaymentStatus({...paymentStatus,status:'pending',message:'Checking the latest M-PESA status…'});try{const r=await fetch('/api/mpesa/order-status?saleId='+encodeURIComponent(id),{cache:'no-store'});const d=await r.json();if(d.status==='success')setPaymentStatus({saleId:id,status:'success',message:'Your purchase is successful!'});else if(d.status==='failed')setPaymentStatus({saleId:id,status:'failed',message:d.message||'Payment was not completed.'});else setPaymentStatus({saleId:id,status:'timeout',message:'Still waiting for confirmation from M-PESA.'});}catch{setPaymentStatus({...paymentStatus,status:'timeout',message:'Could not reach the status service. Please try again.'});}}} style={{padding:"12px 18px",border:0,borderRadius:12,background:"#176b3b",color:"#fff",fontWeight:800}}>Check payment again</button>}
        {(paymentStatus.status==='success'||paymentStatus.status==='failed') && <button onClick={()=>setPaymentStatus(null)} style={{marginTop:8,padding:"12px 18px",border:0,borderRadius:12,background:paymentStatus.status==='success'?"#fff":"#176b3b",color:paymentStatus.status==='success'?"#14532d":"#fff",fontWeight:800}}>{paymentStatus.status==='success'?'Continue shopping':'Close'}</button>}
      </div>
    </div>}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
  </div>;
}
