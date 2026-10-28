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
      <span><ShieldCheck size={14}/> BLACK HOLE BINGWA SERVICES</span>
      <span className="top-right"><Smartphone size={14}/> Kenya</span>
    </div>
    <header className="header">
      <a className="brand" href="#home"><span className="brand-mark">B</span><span>Bingwa<span className="brand-accent">Sokoni</span><small>DATA. MINUTES. SMS.</small></span></a>
      <nav><a href="#offers">Browse offers</a><a href="#how">How it works</a></nav>
      <button className="outline-btn" onClick={() => setNotice('Checkout is not connected yet. No payment has been initiated.')}><Smartphone size={17}/> Buy a bundle</button>
      <button className="mobile-menu" aria-label="Menu" onClick={() => setNotice('Choose a category below to browse the available bundles.')}><Menu/></button>
    </header>
    <main id="home">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot"/> BUNDLES FOR YOUR EVERYDAY</div>
          <h1>Your bundle.<br/><em>Your budget.</em><br/>Stay connected.</h1>
          <p>Browse the Bingwa Data, repeatable bundles, minutes and SMS offers you shared. Clear prices and validity, all in one place.</p>
          <div className="hero-search"><Search size={20}/><input aria-label="Search offers" placeholder="Search data, minutes, WhatsApp..." value={search} onChange={e => setSearch(e.target.value)}/><button onClick={() => document.getElementById('offers')?.scrollIntoView({behavior:'smooth'})}>Find offers <ArrowUpRight size={17}/></button></div>
          <div className="hero-foot"><span><ShieldCheck size={16}/> Prices shown in KSh</span><span><Clock3 size={16}/> Validity shown per offer</span><span><CheckCircle2 size={16}/> Live catalogue</span></div>
        </div>
        <div className="hero-art"><div className="sun-shape"/><div className="art-card art-card-one"><span>STAY CONNECTED</span><strong>Good bundles.<br/>Clear prices.</strong><div className="art-emoji">📱</div></div><div className="art-card art-card-two"><div className="mini-emoji">📶</div><div><strong>Data & more</strong><small>Choose what suits you</small></div><span className="sparkle">✳</span></div><div className="floating-stamp">BINGWA<br/>SMART</div><div className="hero-plant">✳</div></div>
      </section>
      <section className="trust-strip"><div><strong>One clear catalogue</strong><span>Browse all active offers</span></div><div><strong>Know the validity</strong><span>Details shown up front</span></div><div><strong>Choose your bundle</strong><span>Checkout connection pending</span></div></section>
      <section className="offers-section" id="offers">
        <div className="section-heading"><div><div className="eyebrow">BLACK HOLE BINGWA SERVICES</div><h2>Available bundles<span>.</span></h2><p>Offers loaded from the live catalogue database.</p></div><a href="#categories" className="view-all" onClick={() => setGroup('all')}>All offers <ArrowUpRight size={17}/></a></div>
        <div className="hero-search catalog-search"><Search size={18}/><input aria-label="Filter offers" placeholder="Filter offers..." value={search} onChange={e => setSearch(e.target.value)}/></div>
        <div id="categories" className="categories">{groups.map(item => <button key={item.key} className={group === item.key ? 'category active' : 'category'} onClick={() => setGroup(item.key)}>{item.label}</button>)}</div>
        {loading && <div className="empty-state">Loading live offers…</div>}
        {!loading && error && <div className="empty-state">{error} <button className="category active" onClick={() => void loadOffers()}>Retry</button></div>}
        {!loading && !error && <div className="deal-grid">{filtered.map((offer, index) => <article className="deal-card" key={offer.id}>
          <div className={`deal-image ${['sage','cream','peach','blue'][groups.findIndex(g => g.key === offer.group_key) % 4] ?? 'sage'}`}><span className="deal-badge">{groupLabels[offer.group_key] ?? 'Bundle'}</span><span className="product-emoji">{groupIcons[offer.group_key] ?? '📱'}</span><span className="image-index">{String(index + 1).padStart(2,'0')}</span></div>
          <div className="deal-details"><div className="shop-name">BLACK HOLE BINGWA SERVICES <span className="verified">✓</span></div><h3>{offer.title}</h3><div className="deal-location"><Clock3 size={13}/>{offer.validity}</div><div className="deal-bottom"><div><strong>KSh {Number(offer.price).toLocaleString('en-KE')}</strong><small className="offer-note">{offer.note ?? groupLabels[offer.group_key]}</small></div><button aria-label={`Buy ${offer.title}`} className="arrow-btn" onClick={() => setNotice('Checkout and payment are not connected yet. No payment has been initiated.')}><ArrowUpRight size={19}/></button></div></div>
        </article>)}</div>}
        {!loading && !error && filtered.length === 0 && <div className="empty-state">No offers match your search. Try another word or category.</div>}
      </section>
      <section className="bottom-cta" id="how"><div><div className="eyebrow">SIMPLE AND TRANSPARENT</div><h2>Pick the bundle you need.</h2><p>Review the price and validity before checkout. Purchasing and payment will be enabled only after the checkout and payment flow is verified.</p></div><button onClick={() => {setGroup('all');setSearch('');document.getElementById('offers')?.scrollIntoView({behavior:'smooth'});}}>Browse all offers <ArrowUpRight size={17}/></button></section>
    </main>
    <footer className="footer"><span>© {new Date().getFullYear()} Bingwa Sokoni</span><span>BLACK HOLE BINGWA SERVICES · Kenya</span></footer>
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
  </div>;
}
