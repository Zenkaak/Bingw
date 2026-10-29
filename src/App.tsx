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
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === '/adm') return <Admin />;
  const [offers, setOffers] = useState<Offer[]>([]);
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

  useEffect(() => { void loadOffers(); }, []);

  const filtered = useMemo(() => offers.filter((offer) => {
    const matchesGroup = group === 'all' || offer.group_key === group;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${offer.title} ${offer.validity} ${offer.note ?? ''} ${groupLabels[offer.group_key] ?? ''}`.toLowerCase().includes(query);
    return matchesGroup && matchesSearch;
  }), [offers, group, search]);

  return <div className="app-shell"><style>{`@keyframes brandGlow{0%,100%{opacity:1;transform:translateY(0)}50%{opacity:.82;transform:translateY(-1px)}} .brand{animation:brandGlow 3s ease-in-out infinite} .deal-grid{align-items:start!important;grid-auto-rows:auto!important;gap:8px!important}.deal-card{height:auto!important;min-height:0!important;align-self:start!important}.deal-details{display:block!important;padding:8px!important}.deal-bottom{margin-top:3px!important}.deal-details h3{font-size:14px!important;line-height:1.15!important}.deal-location{margin-bottom:2px!important;line-height:1.15!important}.deal-details .outline-btn{min-height:30px!important;margin-top:4px!important;padding:5px 6px!important;font-size:12px!important}@media(prefers-reduced-motion:reduce){.brand{animation:none}}`}</style>
    <div className="topline" style={{display:"none"}}>
      <span>BLACK HOLE DATA SERVICES</span>
      <span className="top-right">Kenya</span>
    </div>
    <header className="header" style={{padding:"10px 0 12px",minHeight:0,display:"block"}}>
      <a className="brand" href="#home" style={{display:"flex",alignItems:"baseline",gap:8,width:"100%",whiteSpace:"nowrap",textDecoration:"none",lineHeight:1.1,fontFamily:"inherit",fontWeight:900,fontSize:"clamp(1.1rem,5.7vw,2.5rem)",letterSpacing:"-1.2px"}}><span style={{font: "inherit",letterSpacing:"inherit"}}>BLACKHOLE</span><span style={{font:"inherit",letterSpacing:"inherit"}}>DATA SERVICES</span></a>
      <nav style={{display:"none"}}><a href="#offers">Packages</a></nav>
      
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
          <div className="deal-details" style={{padding:8}}><h3 style={{margin:"0 0 2px",fontSize:14,lineHeight:1.2}}>{offer.title}</h3><div className="deal-location" style={{marginBottom:2,fontSize:11,lineHeight:1.15}}>{offer.validity}</div><div className="deal-bottom"><div><strong>KSh {Number(offer.price).toLocaleString('en-KE')}</strong></div></div><button className="outline-btn" style={{display:"block",width:"100%",minHeight:30,padding:"5px 6px",background:"#111827",color:"#ffffff",border:"1px solid #111827",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer",marginTop:4}} onClick={() => { setCheckoutPhone(''); setNotice(''); setCheckoutOffer(offer); }} disabled={checkoutBusy}>Buy package</button></div>
        </article>)}</div>}
        {!loading && !error && filtered.length === 0 && <div className="empty-state">No offers match your search. Try another word or category.</div>}
      </section>
      <section className="bottom-cta" id="how" style={{display:"none"}}><div><div className="eyebrow">SIMPLE AND TRANSPARENT</div><h2>Pick the bundle you need.</h2><p>Review the price and validity before checkout. Choose an offer and enter your M-PESA number to request a payment prompt.</p></div><button onClick={() => {setGroup('all');setSearch('');document.getElementById('offers')?.scrollIntoView({behavior:'smooth'});}}>Browse all offers <ArrowUpRight size={17}/></button></section>
    </main>
    <footer className="footer" style={{padding:"12px 0",marginTop:12}}><span>BLACK HOLE DATA SERVICES</span></footer>
    <a href="https://wa.me/254769252572" target="_blank" rel="noreferrer" aria-label="Chat with BLACK HOLE DATA SERVICES on WhatsApp" style={{position:"fixed",right:16,bottom:24,zIndex:900,width:56,height:56,borderRadius:"50%",background:"#25D366",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 14px rgba(0,0,0,.25)",textDecoration:"none",fontSize:28,fontWeight:700}}><span aria-hidden="true">☎</span></a>
    {checkoutOffer && <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" onClick={(event) => { if (event.target === event.currentTarget && !checkoutBusy) setCheckoutOffer(null); }} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(10,18,16,.68)",backdropFilter:"blur(5px)",display:"grid",placeItems:"center",padding:16}}>
      <form onSubmit={(event) => { event.preventDefault(); void beginCheckout(checkoutOffer); }} style={{position:"relative",width:"100%",maxWidth:410,maxHeight:"88dvh",overflowY:"auto",boxSizing:"border-box",background:"#fff",color:"#14231d",padding:0,borderRadius:22,boxShadow:"0 28px 90px rgba(0,0,0,.32)"}}>
        <div style={{background:"linear-gradient(135deg,#102b20,#174d36)",color:"#fff",padding:"20px 22px",borderRadius:"21px 21px 0 0"}}>
          <button type="button" aria-label="Close checkout" disabled={checkoutBusy} onClick={() => setCheckoutOffer(null)} style={{position:"absolute",right:16,top:16,width:36,height:36,borderRadius:"50%",border:"1px solid rgba(255,255,255,.28)",background:"rgba(255,255,255,.1)",color:"#fff",fontSize:22}}>×</button>
          <div style={{fontSize:10,fontWeight:800,letterSpacing:2,marginBottom:10}}>BLACK HOLE DATA SERVICES</div>
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
