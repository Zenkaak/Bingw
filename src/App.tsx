import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock3, Menu, Search, ShieldCheck, Smartphone } from 'lucide-react';

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
const groupIcons: Record<string, string> = {
  bingwa: '📶',
  repeatable: '🔁',
  minutes: '📞',
  sms: '💬',
};

export default function App() {
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
      setNotice(result.message || 'STK Push sent. Check your phone to complete payment.');
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

  return <div className="app-shell">
    <div className="topline">
      <span><ShieldCheck size={14}/> BLACK HOLE DATA SERVICES</span>
      <span className="top-right"><Smartphone size={14}/> Kenya</span>
    </div>
    <header className="header">
      <a className="brand" href="#home"><span className="brand-mark">B</span><span>BLACK HOLE<small>DATA SERVICES</small></span></a>
      <nav><a href="#offers">Packages</a></nav>
      <button className="outline-btn" onClick={() => document.getElementById('offers')?.scrollIntoView({behavior:'smooth'})}><Smartphone size={17}/> Buy a bundle</button>
      <button className="mobile-menu" aria-label="Menu" onClick={() => setNotice('Choose a category below to browse the available bundles.')}><Menu/></button>
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
      <section className="offers-section" id="offers">
        <div className="section-heading"><div><div className="eyebrow">BLACK HOLE DATA SERVICES</div><h2>Available bundles<span>.</span></h2><p>Offers loaded from the live catalogue database.</p></div><a href="#categories" className="view-all" onClick={() => setGroup('all')}>All offers <ArrowUpRight size={17}/></a></div>
        <div className="hero-search catalog-search"><Search size={18}/><input aria-label="Filter offers" placeholder="Filter offers..." value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div id="categories" className="categories">{groups.map(item => <button key={item.key} className={group === item.key ? 'category active' : 'category'} onClick={() => setGroup(item.key)}>{item.label}</button>)}</div>
        {loading && <div className="empty-state">Loading live offers…</div>}
        {!loading && error && <div className="empty-state">{error} <button className="category active" onClick={() => void loadOffers()}>Retry</button></div>}
        {!loading && !error && <div className="deal-grid">{filtered.map((offer, index) => <article className="deal-card" key={offer.id}>
          <div className={`deal-image ${['sage','cream','peach','blue'][groups.findIndex(g => g.key === offer.group_key) % 4] ?? 'sage'}`}><span className="deal-badge">{groupLabels[offer.group_key] ?? 'Bundle'}</span><span className="product-emoji">{groupIcons[offer.group_key] ?? '📱'}</span><span className="image-index">{String(index + 1).padStart(2,'0')}</span></div>
          <div className="deal-details"><div className="shop-name">BLACK HOLE DATA SERVICES <span className="verified">✓</span></div><h3>{offer.title}</h3><div className="deal-location"><Clock3 size={13}/>{offer.validity}</div><div className="deal-bottom"><div><strong>KSh {Number(offer.price).toLocaleString('en-KE')}</strong><small className="offer-note">{offer.note ?? groupLabels[offer.group_key]}</small></div></div><button className="outline-btn" style={{display:"block",width:"100%",minHeight:48,background:"#111827",color:"#ffffff",border:"2px solid #111827",borderRadius:10,fontWeight:700,fontSize:16,cursor:"pointer",marginTop:14,position:"relative",zIndex:2,visibility:"visible",opacity:1}} onClick={() => { setCheckoutPhone(''); setNotice(''); setCheckoutOffer(offer); }} disabled={checkoutBusy}>Buy package</button></div>
        </article>)}</div>}
        {!loading && !error && filtered.length === 0 && <div className="empty-state">No offers match your search. Try another word or category.</div>}
      </section>
      <section className="bottom-cta" id="how" style={{display:"none"}}><div><div className="eyebrow">SIMPLE AND TRANSPARENT</div><h2>Pick the bundle you need.</h2><p>Review the price and validity before checkout. Choose an offer and enter your M-PESA number to request a payment prompt.</p></div><button onClick={() => {setGroup('all');setSearch('');document.getElementById('offers')?.scrollIntoView({behavior:'smooth'});}}>Browse all offers <ArrowUpRight size={17}/></button></section>
    </main>
    <footer className="footer"><span>BLACK HOLE DATA SERVICES</span></footer>
    {checkoutOffer && <div role="dialog" aria-modal="true" aria-labelledby="checkout-title" style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.58)",display:"grid",placeItems:"center",padding:20}}>
      <form onSubmit={(event) => { event.preventDefault(); void beginCheckout(checkoutOffer); }} style={{width:"100%",maxWidth:420,maxHeight:"82dvh",overflowY:"auto",boxSizing:"border-box",background:"white",color:"#171717",padding:24,borderRadius:16,boxShadow:"0 20px 70px rgba(0,0,0,.25)"}}>
        <button type="button" aria-label="Close" onClick={() => setCheckoutOffer(null)} style={{float:"right",border:0,background:"transparent",fontSize:24}}>×</button>
        <h2 id="checkout-title" style={{marginTop:0}}>Buy package</h2>
        <p>{checkoutOffer.title}</p><p style={{fontSize:22,fontWeight:700}}>KSh {Number(checkoutOffer.price).toLocaleString('en-KE')}</p>
        <label htmlFor="mpesa-phone" style={{display:"block",fontWeight:600,marginBottom:8}}>M-PESA phone number</label>
        <input id="mpesa-phone" type="tel" autoComplete="tel" placeholder="0712345678" value={checkoutPhone} onChange={event => setCheckoutPhone(event.target.value)} required style={{width:"100%",padding:12,border:"1px solid #ccc",borderRadius:8,boxSizing:"border-box",fontSize:16}} />
        <button type="submit" disabled={checkoutBusy} className="outline-btn" style={{display:"block",width:"100%",minHeight:52,marginTop:14,justifyContent:"center",background:"#111827",color:"#ffffff",border:"2px solid #111827",borderRadius:10,fontWeight:700,fontSize:16,cursor:"pointer"}}>{checkoutBusy ? "Requesting STK Push…" : "Buy package — initiate STK"}</button>
        <p style={{fontSize:13,color:"#555",marginBottom:0}}>An M-PESA prompt should appear on this phone.</p>
        {notice && <p role="status" style={{fontSize:14}}>{notice}</p>}
      </form>
    </div>}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
  </div>;
}
