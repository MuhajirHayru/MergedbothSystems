import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/apiClient';
import {
  TrendingUp,
  ShieldCheck,
  Truck,
  Leaf,
  Users,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  MapPin,
  Building2,
  DollarSign,
  ChevronDown,
  Lock,
  Phone,
  Mail,
  HelpCircle,
  Store,
  Star,
  ChevronRight,
  Search,
  Package,
  Layers,
  Award,
  Zap,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { setActiveView, setAiModalOpen, language, platformConfig, isAuthenticated } = useApp();
  const navigate = useNavigate();
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [heroSearch, setHeroSearch] = useState('');

  const [publicStats, setPublicStats] = useState<null | { stats: { total_users: number; total_regions: number; total_drivers: number } }>(null);
  useEffect(() => {
    fetch('/api/v1/auth/public-stats/')
      .then((r) => r.json())
      .then((d) => { if (d.success) setPublicStats(d); })
      .catch(() => undefined);
  }, []);

  const [landingBanners, setLandingBanners] = useState<{ id: number; title: string; description: string; image_url: string | null; destination_url: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/auth/banners/')
      .then((res) => { if (!cancelled) setLandingBanners(res.data?.banners ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const content = platformConfig?.websiteContent || {
    platformTitle: 'GreenPath Farm to Market AI',
    amharicTitle: 'ግሪንፓዝ የግብርና ገበያ AI',
    oromoTitle: 'GreenPath Gabaa Qonnaa AI',
    heroHeadline: 'Direct Farm-to-Market Exchange for Ethiopia',
    heroSubtitle: 'Trade fresh farm produce directly with accredited farming cooperatives, schedule refrigerated freight, and settle securely through Chapa Escrow.',
    aboutDescription: '',
    contactEmail: 'support@greenpath.et',
    contactPhone: '+251 900 000 000',
    contactOffice: 'Addis Ababa, Ethiopia',
    faqItems: [],
  };

  const handleHeroSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (heroSearch.trim()) {
      setActiveView('marketplace');
      navigate(`/marketplace?search=${encodeURIComponent(heroSearch.trim())}`);
    } else {
      setActiveView('marketplace');
      navigate('/marketplace');
    }
  };

  const commodityTickers = [
    { name: 'Red Shallots (Meki)', price: '4,200 ETB/qt', change: '+8.4%', up: true },
    { name: 'Export Avocado (Sidama)', price: '95 ETB/kg', change: '+12.1%', up: true },
    { name: 'Highland Tomatoes (Mojo)', price: '1,850 ETB/crate', change: '+3.2%', up: true },
    { name: 'White Teff (Debre Markos)', price: '8,400 ETB/qt', change: '+1.5%', up: true },
    { name: 'Yirgacheffe Coffee G1', price: '380 ETB/kg', change: '+5.0%', up: true },
    { name: 'Table Potatoes (Shashemene)', price: '2,600 ETB/qt', change: '-2.1%', up: false },
  ];

  return (
    <div className="space-y-16 pb-20">
      {/* Live Agricultural Commodity Ticker */}
      <div className="bg-[#0F172A] text-white py-2 px-4 border-b border-emerald-900/60 overflow-x-auto scrollbar-none">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 text-xs whitespace-nowrap min-w-max">
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold uppercase tracking-wider text-[10px] shrink-0">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Ethiopian Commodity Ticker</span>
          </div>
          <div className="flex items-center gap-6 divide-x divide-slate-800 text-xs">
            {commodityTickers.map((ticker, idx) => (
              <div key={idx} className="flex items-center gap-2 pl-4 first:pl-0">
                <span className="text-slate-300 font-medium">{ticker.name}</span>
                <span className="font-mono font-bold text-white">{ticker.price}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ticker.up ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                  {ticker.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Verified Ethiopian Agricultural E-Commerce & Freight Rail</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 leading-[1.12]">
              Direct Farm-to-Market Exchange for <span className="text-[#15803D] dark:text-emerald-400">Ethiopian Producers</span>
            </h1>

            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
              Connect directly with verified agricultural cooperatives in Meki, Hawassa, Mojo, and Ambo. Procure farm-gate harvests, schedule refrigerated Isuzu/Sino truck haulage, and settle safely via Chapa Escrow.
            </p>

            {/* Part 23 — active promotional banners from the CMS */}
            {landingBanners.length > 0 && (
              <div className="space-y-2 pt-2 max-w-2xl">
                {landingBanners.map((b) => (
                  <a
                    key={b.id}
                    href={b.destination_url || '#'}
                    className="block p-3 rounded-xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30 hover:border-[#15803D] transition-colors"
                  >
                    <div className="text-sm font-bold text-emerald-800 dark:text-emerald-300">{b.title}</div>
                    {b.description && <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{b.description}</div>}
                  </a>
                ))}
              </div>
            )}

            {/* Instant Search Bar with Commodity Chips */}
            <form onSubmit={handleHeroSearchSubmit} className="pt-2 max-w-xl space-y-2.5">
              <div className="relative flex items-center">
                <Search className="w-5 h-5 text-slate-400 absolute left-4 pointer-events-none" />
                <input
                  type="text"
                  value={heroSearch}
                  onChange={(e) => setHeroSearch(e.target.value)}
                  placeholder="Search produce (e.g. Avocado, Tomatoes, Teff, Shallots)..."
                  className="w-full pl-12 pr-28 py-3.5 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl shadow-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                />
                <button
                  type="submit"
                  className="absolute right-2 px-5 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-xl shadow-xs transition-all"
                >
                  Search
                </button>
              </div>

              {/* Popular quick-chips */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-[11px] text-slate-400 font-semibold mr-1">Trending:</span>
                {[
                  { label: '🥑 Hass Avocado', q: 'Avocado' },
                  { label: '🍅 Meki Tomatoes', q: 'Tomato' },
                  { label: '🧅 Red Shallots', q: 'Onion' },
                  { label: '🌾 Yirgacheffe Coffee', q: 'Coffee' },
                  { label: '🥔 Highland Potatoes', q: 'Potato' },
                ].map((chip) => (
                  <button
                    key={chip.q}
                    type="button"
                    onClick={() => {
                      setActiveView('marketplace');
                      navigate(`/marketplace?search=${encodeURIComponent(chip.q)}`);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700 dark:hover:text-emerald-300 text-slate-700 dark:text-slate-300 text-[11px] font-medium transition-colors"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </form>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => {
                  setActiveView('marketplace');
                  navigate('/marketplace');
                }}
                className="flex items-center gap-2 px-6 py-3.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs rounded-xl transition-all shadow-md hover:scale-105"
              >
                <span>Browse Produce Catalog</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setActiveView('register');
                  navigate('/register');
                }}
                className="flex items-center gap-2 px-6 py-3.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors shadow-xs"
              >
                <span>Register Cooperative / Business</span>
              </button>
            </div>

            {/* Trust Highlights */}
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <div className="font-bold text-base text-slate-900 dark:text-slate-100 font-mono">
                  100%
                </div>
                <div className="text-slate-500 text-[11px]">Chapa Escrow Protected</div>
              </div>
              <div>
                <div className="font-bold text-base text-slate-900 dark:text-slate-100 font-mono">
                  {publicStats ? publicStats.stats.total_users : '1,200+'}
                </div>
                <div className="text-slate-500 text-[11px]">Accredited Producers</div>
              </div>
              <div>
                <div className="font-bold text-base text-slate-900 dark:text-slate-100 font-mono">
                  {publicStats ? publicStats.stats.total_regions : '15'}
                </div>
                <div className="text-slate-500 text-[11px]">Ethiopian Trade Corridors</div>
              </div>
            </div>
          </div>

          {/* Hero Visual Card Showcase */}
          <div className="lg:col-span-5 space-y-4">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                    Live Farm Gate Listings
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  Escrow Verified
                </span>
              </div>

              {/* Sample Produce Cards */}
              <div className="space-y-3">
                <div
                  onClick={() => {
                    setActiveView('marketplace');
                    navigate('/marketplace?search=Avocado');
                  }}
                  className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-emerald-500 cursor-pointer transition-all flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-bold flex items-center justify-center text-lg shrink-0">
                      🥑
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 transition-colors">
                        Export Hass Avocado (አቮካዶ)
                      </div>
                      <div className="text-[11px] text-slate-500">Sidama Cooperative · Grade 1 Export</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">95 ETB/kg</div>
                    <div className="text-[10px] text-slate-400">Available: 40 crates</div>
                  </div>
                </div>

                <div
                  onClick={() => {
                    setActiveView('marketplace');
                    navigate('/marketplace?search=Tomato');
                  }}
                  className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-emerald-500 cursor-pointer transition-all flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 font-bold flex items-center justify-center text-lg shrink-0">
                      🍅
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 transition-colors">
                        Highland Red Tomatoes (ቲማቲም)
                      </div>
                      <div className="text-[11px] text-slate-500">Meki Farming Union · Grade 1 Domestic</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">1,850 ETB/crate</div>
                    <div className="text-[10px] text-slate-400">Available: 60 crates</div>
                  </div>
                </div>

                <div
                  onClick={() => {
                    setActiveView('marketplace');
                    navigate('/marketplace?search=Onion');
                  }}
                  className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-emerald-500 cursor-pointer transition-all flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 font-bold flex items-center justify-center text-lg shrink-0">
                      🧅
                    </div>
                    <div>
                      <div className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 transition-colors">
                        Cured Red Shallot Onions (ሽንኩርት)
                      </div>
                      <div className="text-[11px] text-slate-500">Ziway Agricultural Union · Grade 2</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">4,200 ETB/qt</div>
                    <div className="text-[10px] text-slate-400">Available: 40 quintals</div>
                  </div>
                </div>
              </div>

              {/* Express Delivery Integration Note */}
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 font-medium">
                  <Truck className="w-4 h-4 text-emerald-600" />
                  <span>Freight fleet ready for Mojo-Addis Expressway dispatch</span>
                </div>
                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">~3.5h ETA</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: Featured Produce Categories */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
            Agricultural Commodities
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
            Browse Ethiopia's Key Produce Categories
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Certified varieties inspected for post-harvest moisture, size, and shelf stability
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { name: 'Vegetables', am: 'አትክልት', icon: '🥕', count: '48 Listings' },
            { name: 'Fruits', am: 'ፍራፍሬ', icon: '🥑', count: '32 Listings' },
            { name: 'Grains', am: 'እህል / ጥራጥሬ', icon: '🌾', count: '64 Listings' },
            { name: 'Pulses', am: 'የጥራጥሬ ሰብሎች', icon: '🫘', count: '28 Listings' },
            { name: 'Spices', am: 'ቅመማ ቅመም', icon: '🌶️', count: '19 Listings' },
            { name: 'Root Crops', am: 'ስራስር', icon: '🥔', count: '24 Listings' },
          ].map((cat) => (
            <button
              key={cat.name}
              onClick={() => {
                setActiveView('marketplace');
                navigate(`/marketplace?search=${encodeURIComponent(cat.name)}`);
              }}
              className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#15803D] hover:shadow-lg transition-all text-center space-y-2 group"
            >
              <div className="text-3xl group-hover:scale-110 transition-transform">{cat.icon}</div>
              <div className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-[#15803D] transition-colors">
                {cat.name}
              </div>
              <div className="text-[10px] text-slate-400 font-medium">{cat.am}</div>
              <div className="text-[10px] text-emerald-600 font-semibold">{cat.count}</div>
            </button>
          ))}
        </div>
      </div>

      {/* SECTION: 4-Step Escrow Secured Workflow */}
      <div className="bg-slate-100 dark:bg-slate-900/60 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
              End-to-End Escrow Protection
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
              How GreenPath Protects Every Cargo Transaction
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              {
                step: '01',
                title: 'Farm Gate Listing',
                desc: 'Cooperative verifies harvest volume, grade specifications, and transport corridor.',
                icon: Leaf,
              },
              {
                step: '02',
                title: 'Escrow Commitment',
                desc: 'Wholesaler secures payment into Chapa Escrow. Funds are safely locked prior to dispatch.',
                icon: ShieldCheck,
              },
              {
                step: '03',
                title: 'Carrier Telemetry',
                desc: 'Accredited Isuzu/Sino driver confirms pickup via 4-digit PIN and shares live GPS transit.',
                icon: Truck,
              },
              {
                step: '04',
                title: 'Quality Sign-Off',
                desc: 'Upon depot inspection and delivery PIN verification, funds instantly disburse to the farmer wallet.',
                icon: Award,
              },
            ].map((st) => (
              <div
                key={st.step}
                className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 relative overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xl font-black text-emerald-600/30 dark:text-emerald-400/20">
                    {st.step}
                  </span>
                  <st.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{st.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{st.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION: Role Workspaces Showcase */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
            Dedicated Workspaces
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 mt-1">
            Built Specifically for Every Agribusiness Actor
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              role: 'farmer' as const,
              title: 'Farmers & Cooperatives',
              desc: 'Publish harvests, manage wholesale purchase commitments, and withdraw directly to CBE or Telebirr.',
              cta: 'Farmer Portal',
              badge: 'Farm Gate',
            },
            {
              role: 'wholesaler' as const,
              title: 'Commercial Wholesalers',
              desc: 'Procure bulk produce with escrow protection, manage central warehouse bays, and calculate corridor freight.',
              cta: 'Wholesaler Console',
              badge: 'Bulk Trading',
            },
            {
              role: 'retailer' as const,
              title: 'Municipal Grocers',
              desc: 'Restock fresh store supplies directly from terminal depots with mandatory delivery quality inspection sign-off.',
              cta: 'Retail Restock Hub',
              badge: 'Urban Grocers',
            },
            {
              role: 'driver' as const,
              title: 'Freight Carrier Fleet',
              desc: 'Bid on cargo hauls, verify pickup & delivery with 4-digit PINs, and receive instant freight payouts.',
              cta: 'Carrier Console',
              badge: 'Expressway Haulage',
            },
          ].map((card) => (
            <div
              key={card.role}
              className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between"
            >
              <div className="space-y-3">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  {card.badge}
                </span>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  {card.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {card.desc}
                </p>
              </div>

              <button
                onClick={() => {
                  if (isAuthenticated) {
                    if (card.role === 'farmer') setActiveView('farmer_dashboard');
                    else if (card.role === 'wholesaler') setActiveView('wholesaler_dashboard');
                    else if (card.role === 'retailer') setActiveView('retailer_dashboard');
                    else setActiveView('driver_dashboard');
                  } else {
                    setActiveView('login');
                    navigate('/login');
                  }
                }}
                className="mt-6 flex items-center gap-1.5 text-xs font-bold text-[#15803D] dark:text-emerald-400 hover:underline"
              >
                <span>{card.cta}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION: Frequently Asked Questions */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Frequently Asked Questions
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Common questions regarding Chapa Escrow, driver accreditation, and produce inspection
          </p>
        </div>

        <div className="space-y-3">
          {[
            {
              q: 'How does Chapa Escrow guarantee payment for farmers?',
              a: 'When a wholesaler or retailer places an order, the purchase funds are deposited into a secure Chapa Escrow vault. The funds cannot be withdrawn by the buyer. Once the cargo arrives and the delivery PIN is authenticated after quality inspection, the funds are automatically released to the farmer wallet.',
            },
            {
              q: 'How are commercial truck drivers accredited on GreenPath?',
              a: 'All carriers submit commercial driving licenses, vehicle plate registrations (Isuzu FSR, Sino Truck, Reefer), and undergo regional Ministry of Agriculture logistics clearance. Drivers must share live corridor telemetry during active shipments.',
            },
            {
              q: 'How is farm location privacy protected?',
              a: 'Exact GPS farm plot boundaries and private farm gate coordinates remain hidden on public search pages. Only the general administrative zone (e.g., East Shewa, Sidama) and recommended transport corridor are displayed.',
            },
            {
              q: 'What languages does the platform support?',
              a: 'GreenPath is fully localized in English, Amharic (አማርኛ), and Afaan Oromoo, including the AI Agricultural Advisor modal for voice and text commodity inquiries.',
            },
          ].map((faq, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                  className="w-full p-4 text-left font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 flex items-center justify-between gap-4"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      isOpen ? 'rotate-180 text-emerald-600' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 text-xs text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modern Agri-Tech Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 pt-12 text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#15803D] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                GP
              </div>
              <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                {content.platformTitle}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Empowering Ethiopian agriculture through artificial intelligence, direct cooperative connections, and guaranteed Chapa Escrow settlement.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100 mb-2">Marketplace & Corridors</h4>
            <ul className="space-y-1.5 text-[11px]">
              <li><button onClick={() => { setActiveView('marketplace'); navigate('/marketplace'); }} className="hover:underline">Browse Produce Listings</button></li>
              <li><button onClick={() => { setActiveView('reports_regional'); navigate('/reports/regional'); }} className="hover:underline">Regional Commodity Prices</button></li>
              <li><button onClick={() => { setActiveView('register'); navigate('/register'); }} className="hover:underline">Cooperative Accreditation</button></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100 mb-2">Carrier & Logistics</h4>
            <ul className="space-y-1.5 text-[11px]">
              <li><button onClick={() => { setActiveView('driver_dashboard'); navigate('/driver'); }} className="hover:underline">Freight Carrier Hub</button></li>
              <li><button onClick={() => { setActiveView('freight_bids'); navigate('/freight-bids'); }} className="hover:underline">Delivery Job Board</button></li>
              <li><button onClick={() => { setActiveView('logistics_dashboard'); navigate('/logistics-dashboard'); }} className="hover:underline">Corridor Tracking</button></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100 mb-2">Contact & Operations</h4>
            <p className="text-[11px] leading-relaxed">
              Addis Ababa Central Freight & Agriculture Terminal
            </p>
            <div className="text-[11px] mt-2 space-y-0.5">
              <div>Email: support@greenpath.et</div>
              <div>Hotline: +251 900 000 000</div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 border-t border-slate-100 dark:border-slate-800 text-center text-[11px]">
          © 2026 GreenPath Farm to Market AI. All Rights Reserved. Escrow Secured by Chapa.
        </div>
      </footer>
    </div>
  );
};
