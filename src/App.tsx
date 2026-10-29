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
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  async function beginCheckout(offer: Offer) {
    const phone = checkoutPhone.trim();
    if (!phone) { setNotice('Enter the M-PESA phone number to continue.'); return; }
    setCheckoutPhone(phone);
    setCheckoutOffer(offer);
    setCheckoutBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/mpesa/stkpush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offer.id, phone, receivingPhone: phone, forSelf: true })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start M-PESA checkout.');
      setNotice('Prompt has been sent to your phone. Check your phone to complete payment.');
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

  return <div className="app-shell"><style>{`@keyframes brandGlow{0%,100%{opacity:1;transform:translateY(0)}50%{opacity:.9;transform:translateY(-1px)}} .brand{animation:brandGlow 3s ease-in-out infinite}.header{position:sticky!important;top:0!important;z-index:30!important;background:rgba(255,255,255,.97)!important;backdrop-filter:blur(16px);border-bottom:1px solid #dce9df;box-shadow:0 7px 24px rgba(15,64,37,.075);isolation:isolate}.header>.brand{min-width:0;max-width:100%;align-items:center!important;flex:1 1 auto}.header>nav{justify-content:flex-end;flex:0 1 auto}.header>nav>a,.header>nav>span{min-height:38px;box-sizing:border-box;justify-content:center;transition:transform .16s ease,box-shadow .16s ease}.header>nav>a:hover{transform:translateY(-1px);box-shadow:0 5px 13px rgba(23,107,59,.22)!important}.deal-grid{align-items:start!important;grid-auto-rows:auto!important;gap:10px!important}.deal-card{height:auto!important;min-height:0!important;align-self:start!important;border:1px solid #b9dfc3!important;border-radius:13px!important;overflow:hidden!important;box-shadow:0 4px 14px rgba(17,80,43,.09)!important;background:linear-gradient(145deg,#f5fcf6 0%,#e4f4e8 100%)!important;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease!important}.deal-card:hover{transform:translateY(-2px);border-color:#83c49b!important;box-shadow:0 8px 22px rgba(17,80,43,.12)!important}.deal-details{display:block!important;padding:10px!important;background:linear-gradient(155deg,rgba(255,255,255,.35),rgba(220,243,226,.55))!important}.deal-bottom{margin-top:5px!important}.deal-details h3{font-size:14px!important;line-height:1.2!important;color:#163c27!important}.deal-location{margin-bottom:3px!important;line-height:1.2!important;color:#607c68!important}.deal-bottom strong{color:#176b3b!important}.deal-details .outline-btn{min-height:32px!important;margin-top:6px!important;padding:6px 8px!important;font-size:12px!important;background:linear-gradient(135deg,#16733d,#0e5d31)!important;color:#fff!important;border:1px solid #0e5d31!important;border-radius:9px!important;box-shadow:0 2px 5px rgba(17,80,43,.15)}.catalog-search{border:1px solid #d5e6d9!important;border-radius:12px!important;background:#fff!important;box-shadow:0 3px 12px rgba(15,64,37,.04)}.categories{display:flex!important;gap:7px!important;overflow-x:auto!important;padding:5px 1px 9px!important;scrollbar-width:thin}.categories .category{white-space:nowrap!important;border-radius:999px!important;border:1px solid #d8e6dc!important;background:#fff!important;color:#315741!important;padding:8px 13px!important;font-weight:750!important;transition:all .16s ease}.categories .category.active{background:#176b3b!important;color:#fff!important;border-color:#176b3b!important;box-shadow:0 3px 9px rgba(23,107,59,.2)}.categories .category:hover{border-color:#68ad7f!important;background:#eff8f1!important;color:#176b3b!important}.categories .category.active:hover{background:#0e5d31!important;color:#fff!important}@media(max-width:700px){.header{padding:10px 12px!important;gap:10px!important;align-items:center!important}.header>.brand{flex:1 1 100%;justify-content:center;white-space:normal!important;text-align:center;line-height:1.15!important;font-size:clamp(1rem,5vw,1.35rem)!important;letter-spacing:-.65px!important;gap:6px!important}.header>nav{width:100%;justify-content:center!important;gap:7px!important}.header>nav>a{flex:1 1 auto;padding:9px 11px!important}.header>nav>span{flex:0 0 auto;padding:8px 9px!important}}@media(max-width:380px){.header>.brand{font-size:1rem!important;gap:4px!important}.header>nav{gap:5px!important}.header>nav>a{font-size:11px!important;padding:8px 9px!important}.header>nav>span{font-size:9px!important}}@media(prefers-reduced-motion:reduce){.brand,.deal-card{animation:none!important;transition:none!important}}`}</style>
    <div className="topline" style={{display:"none"}}>
      <span>{businessName}</span>
      <span className="top-right">Kenya</span>
    </div>
    <header className="header" style={{padding:"10px clamp(12px,3vw,28px) 12px",minHeight:0,display:"flex",alignItems:"center",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}>
      <a className="brand" href="#home" aria-label={businessName} style={{display:"flex",alignItems:"center",gap:7,whiteSpace:"normal",textDecoration:"none",lineHeight:1.1,fontFamily:"inherit",fontWeight:950,fontSize:"clamp(1.05rem,3.7vw,1.8rem)",letterSpacing:"-.7px",color:"#124b2b"}}>{businessName}</a>
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
      <section className="trust-strip" style={{display:"none"}}><div><strong>One clear catalogue</strong><span>Browse all active offers</span></div><div><strong>Know the validity</strong><span>Details shown up front</span></div><div><strong>Choose your bundle</strong><span>M-PESA checkout</span></div></section>
      <section className="offers-section" id="offers" style={{paddingTop:2}}>
        
        <div className="hero-search catalog-search" style={{marginBottom:5,padding:"5px 8px",minHeight:34}}><input aria-label="Filter offers" placeholder="Filter offers..." value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div id="categories" className="categories" style={{marginBottom:5,gap:5}}>{groups.map(item => <button key={item.key} className={group === item.key ? 'category active' : 'category'} onClick={() => setGroup(item.key)}>{item.label}</button>)}</div>
        {loading && <div className="empty-state">Loading live offers…</div>}
        {!loading && error && <div className="empty-state">{error} <button className="category active" onClick={() => void loadOffers()}>Retry</button></div>}
        {!loading && !error && <div className="deal-grid">{filtered.map((offer, index) => <article className="deal-card" key={offer.id} style={{minHeight:0,height:"auto",alignSelf:"start"}}>
          <div className={`deal-image ${['sage','cream','peach','blue'][groups.findIndex(g => g.key === offer.group_key) % 4] ?? 'sage'}`} style={{height:0,minHeight:0,padding:0,display:"none"}}></div>
          <div className="deal-details" style={{padding:8}}><h3 style={{margin:"0 0 2px",fontSize:14,lineHeight:1.2}}>{offer.title}</h3><div className="deal-location" style={{marginBottom:2,fontSize:11,lineHeight:1.15}}>{offer.validity}</div><div className="deal-bottom"><div><strong>KSh {Number(offer.price).toLocaleString('en-KE')}</strong></div></div><button className="outline-btn" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7,width:"100%",minHeight:34,padding:"6px 8px",background:"linear-gradient(135deg,#f0faf2,#e1f4e6)",color:"#145c32",border:"1px solid #75bd8a",borderRadius:9,fontWeight:850,fontSize:12,cursor:"pointer",marginTop:6,boxShadow:"0 2px 6px rgba(17,80,43,.08)"}} onClick={() => { setCheckoutPhone(''); setNotice(''); setCheckoutOffer(offer); }} disabled={checkoutBusy}><span aria-hidden="true" style={{color:"#16803f",fontSize:15,lineHeight:1}}>▣</span>Buy package</button></div>
        </article>)}</div>}
        {!loading && !error && filtered.length === 0 && <div className="empty-state">No offers match your search. Try another word or category.</div>}
      </section>
      <section className="bottom-cta" id="how" style={{display:"none"}}><div><div className="eyebrow">SIMPLE AND TRANSPARENT</div><h2>Pick the bundle you need.</h2><p>Review the price and validity before checkout. Choose an offer and enter your M-PESA number to request a payment prompt.</p></div><button onClick={() => {setGroup('all');setSearch('');document.getElementById('offers')?.scrollIntoView({behavior:'smooth'});}}>Browse all offers <ArrowUpRight size={17}/></button></section>
    </main>
    <footer className="footer" style={{padding:"12px 0",marginTop:12}}><span>{businessName}</span></footer>
    <a href="https://wa.me/254769252572" target="_blank" rel="noreferrer" aria-label="Chat with BLACK HOLE DATA SERVICES on WhatsApp" style={{position:"fixed",right:16,bottom:24,zIndex:900,width:56,height:56,borderRadius:"50%",background:"#25D366",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 14px rgba(0,0,0,.25)",textDecoration:"none",fontSize:28,fontWeight:700}}><span aria-hidden="true">☎</span></a>
    {checkoutOffer && <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={(event) => { if (event.target === event.currentTarget && !checkoutBusy) setCheckoutOffer(null); }} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(10,18,16,.68)",backdropFilter:"blur(5px)",display:"grid",placeItems:"center",padding:16}}>
      <form onSubmit={(event) => { event.preventDefault(); void beginCheckout(checkoutOffer); }} style={{position:"relative",width:"100%",maxWidth:410,maxHeight:"88dvh",overflowY:"auto",boxSizing:"border-box",background:"#fff",color:"#14231d",padding:0,borderRadius:22,boxShadow:"0 28px 90px rgba(0,0,0,.32)"}}>
        <div style={{background:"linear-gradient(135deg,#102b20,#174d36)",color:"#fff",padding:"20px 22px",borderRadius:"21px 21px 0 0"}}>
          <button type="button" aria-label="Close checkout" disabled={checkoutBusy} onClick={() => setCheckoutOffer(null)} style={{position:"absolute",right:16,top:16,width:36,height:36,borderRadius:"50%",border:"1px solid rgba(255,255,255,.28)",background:"rgba(255,255,255,.1)",color:"#fff",fontSize:22}}>×</button>
          <div style={{fontSize:10,fontWeight:800,letterSpacing:2,marginBottom:10}}>{businessName}</div>
          <div style={{fontSize:13,opacity:.8,marginBottom:5}}>PACKAGE CHECKOUT</div>
          <h2 id="checkout-title" style={{fontSize:24,lineHeight:1.2,margin:"0 42px 10px 0"}}>{checkoutOffer.title}</h2>
          <div style={{fontSize:30,fontWeight:850}}>KSh {Number(checkoutOffer.price).toLocaleString('en-KE')}</div>
        </div>
        <div style={{padding:22}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,padding:12,background:"#f2f7f4",border:"1px solid #dcebe1",borderRadius:12}}>
            <span style={{display:"grid",placeItems:"center",width:38,height:38,flexShrink:0,borderRadius:10,background:"#d9f5e3",color:"#116b3b",fontSize:20}}>▣</span>
            <div><div style={{fontSize:14,fontWeight:750}}>Pay with M-PESA</div><div style={{fontSize:12,color:"#5d6b63",marginTop:3}}>We'll send a payment prompt to your phone.</div></div>
          </div>
          <label htmlFor="mpesa-phone" style={{display:"block",fontSize:13,fontWeight:750,marginBottom:8}}>M-PESA phone number</label>
          <input id="mpesa-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={checkoutPhone} onChange={event => setCheckoutPhone(event.target.value)} required style={{display:"block",width:"100%",minHeight:52,padding:"13px 14px",border:"1px solid #cbd6cf",borderRadius:11,boxSizing:"border-box",fontSize:17,background:"#fff",color:"#14231d"}} />
          <div style={{fontSize:12,color:"#64736a",marginTop:7}}>Enter your Kenyan number. Never share your M-PESA PIN.</div>
          <button type="submit" disabled={checkoutBusy} style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",minHeight:52,marginTop:18,background:checkoutBusy?"#7a8a80":"#116b3b",color:"#fff",border:0,borderRadius:11,fontWeight:800,fontSize:16,cursor:checkoutBusy?"wait":"pointer"}}>{checkoutBusy ? "Sending STK prompt…" : "Pay with M-PESA →"}</button>
          {notice && <p role="status" style={{fontSize:13,lineHeight:1.5,color:notice.startsWith("Prompt has been sent")?"#116b3b":"#a32929",background:notice.startsWith("Prompt has been sent")?"#edf9f0":"#fff3f2",borderRadius:9,padding:11,margin:"14px 0 0"}}>{notice}</p>}
          <div style={{textAlign:"center",fontSize:11,color:"#7a877f",marginTop:14}}>Secure payment request · KSh pricing</div>
        </div>
      </form>
    </div>}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
  </div>;
}
