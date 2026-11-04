import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { setCurrentRole, setActiveView, setAiModalOpen, language, platformConfig } = useApp();
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const [publicStats, setPublicStats] = useState<null | { stats: { total_users: number; total_regions: number; total_drivers: number } }>(null);
  useEffect(() => {
    fetch("/api/v1/auth/public-stats/")
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
    heroHeadline: 'GreenPath Farm to Market AI',
    heroSubtitle: 'Intelligent agricultural marketplace connecting Ethiopian farmers, wholesalers, retailers, and drivers.',
    aboutDescription: '',
    contactEmail: 'support@greenpath.et',
    contactPhone: '+251 900 000 000',
    contactOffice: 'Addis Ababa, Ethiopia',
    faqItems: [],
  };

  return (
    <div className="space-y-16 pb-20">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>AI-Integrated Agricultural Marketplace for Ethiopia</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-[1.15]">
              {content.heroHeadline}
            </h1>

            <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
              {content.heroSubtitle}
            </p>

            {/* Part 23 — active promotional banners from the CMS */}
            {landingBanners.length > 0 && (
              <div className="space-y-2 pt-4 max-w-2xl">
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

            {/* CTAs */}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={() => {
                  setCurrentRole('wholesaler');
                  setActiveView('marketplace');
                }}
                className="flex items-center gap-2 px-6 py-3.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs rounded-xl transition-all shadow-md hover:scale-105"
              >
                <span>Explore Agricultural Marketplace</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => setActiveView('register')}
                className="flex items-center gap-2 px-6 py-3.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors shadow-xs"
              >
                <span>Create Accredited Account</span>
              </button>

              <button
                onClick={() => setActiveView('login')}
                className="px-5 py-3.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-semibold text-xs"
              >
                Sign In
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
                  {publicStats ? publicStats.stats.total_users : '—'}
                </div>
                <div className="text-slate-500 text-[11px]">Accredited Producers</div>
              </div>
              <div>
                <div className="font-bold text-base text-slate-900 dark:text-slate-100 font-mono">
                  {publicStats ? publicStats.stats.total_regions : '—'}
                </div>
                <div className="text-slate-500 text-[11px]">National Coverage</div>
              </div>
            </div>
          </div>

          {/* Hero Visual Card */}
          <div className="lg:col-span-5 relative">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
              <img
                src="https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=1000&q=80"
                alt="Ethiopian Farm Harvest"
                className="w-full h-80 sm:h-96 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex flex-col justify-end p-6 text-white">
                <span className="text-[10px] font-mono text-emerald-300 font-bold uppercase tracking-wider">
                  Direct Farm Gate · Meki, Oromia
                </span>
                <h3 className="text-lg font-bold">Grade 1 Highland Roma Tomatoes</h3>
                <p className="text-xs text-slate-200 mt-1">
                  1,800 ETB / 25kg crate · Harvested early morning with refrigerated corridor transit.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: How It Works (5-Step Process) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
            Seamless Agricultural Trade Protocol
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
            How GreenPath Unites the Value Chain
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-2">
            From rural Rift Valley farm gates to urban wholesale markets with end-to-end security.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[
            {
              step: '01',
              title: 'Farmers Register & List',
              desc: 'Highland growers upload MoA farm credentials and publish crop availability.',
            },
            {
              step: '02',
              title: 'Wholesalers Discover & Buy',
              desc: 'Urban trade buyers place orders and lock funds in secure Chapa Escrow.',
            },
            {
              step: '03',
              title: 'Retailers Restock',
              desc: 'City grocers purchase sorted produce allotments directly from wholesale depots.',
            },
            {
              step: '04',
              title: 'Drivers Dispatch',
              desc: 'Accredited haulage fleets verify farm pickup and deliver along express corridors.',
            },
            {
              step: '05',
              title: 'Escrow Disbursal',
              desc: 'Upon quality sign-off, funds are automatically released to the producer wallet.',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs relative"
            >
              <span className="font-mono text-2xl font-bold text-emerald-600/30 dark:text-emerald-400/20">
                {item.step}
              </span>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-2">
                {item.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION: Role Introduction Cards */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">
            Tailored Experiences for Every Agribusiness Role
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              role: 'farmer' as const,
              title: 'For Farmers & Unions',
              desc: 'Publish crop yields, upload up to 8 photos with camera capture, and approve wholesaler purchase orders.',
              cta: 'Explore Farmer Workspace',
            },
            {
              role: 'wholesaler' as const,
              title: 'For Wholesalers',
              desc: 'Discover certified farm commodities, manage inventory stock, and track freight logistics with Chapa Escrow.',
              cta: 'Explore Wholesaler Hub',
            },
            {
              role: 'retailer' as const,
              title: 'For Grocers & Retailers',
              desc: 'Restock fresh store supplies directly from municipal depots with guaranteed quality sign-off.',
              cta: 'Explore Retailer View',
            },
            {
              role: 'driver' as const,
              title: 'For Delivery Drivers',
              desc: 'Integrated with native DriverApp. Verify digital waybills with PIN handoffs across trade corridors.',
              cta: 'Explore Carrier Console',
            },
          ].map((card) => (
            <div
              key={card.role}
              className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between"
            >
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  {card.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                  {card.desc}
                </p>
              </div>

              <button
                onClick={() => {
                  setCurrentRole(card.role);
                  if (card.role === 'farmer') setActiveView('farmer_dashboard');
                  else if (card.role === 'wholesaler') setActiveView('wholesaler_dashboard');
                  else if (card.role === 'retailer') setActiveView('retailer_dashboard');
                  else setActiveView('driver_dashboard');
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

      {/* SECTION: Platform Features */}
      <div className="bg-slate-100 dark:bg-slate-900/50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">
              Enterprise Infrastructure
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2">
              Why Ethiopian Agribusinesses Choose GreenPath
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-[#15803D] dark:text-emerald-400 w-fit">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                100% Escrow Protection
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Funds are secured in our Chapa Escrow vault. Farmers are guaranteed payment upon delivery, and buyers never pay for sub-grade produce.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 w-fit">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Rigorous Location Privacy
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Exact farm plot GPS coordinates and home addresses are never exposed in public browsing. Only permitted general regional context is shown.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 w-fit">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Multilingual AI Advisory
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Consult real-time commodity pricing, crop grading guidelines, and haulage corridor rates in English, አማርኛ, or Afaan Oromoo.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: Frequently Asked Questions (Accordion) */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Frequently Asked Questions
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Learn about payments, verification, and driver logistics
          </p>
        </div>

        <div className="space-y-3">
          {(content.faqItems || []).map((faq, idx) => {
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

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 pt-12 text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#15803D] text-white flex items-center justify-center font-bold text-xs">
                GP
              </div>
              <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                {content.platformTitle}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Empowering Ethiopian agriculture through artificial intelligence, direct marketplace connections, and secure Chapa Escrow.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100 mb-2">Marketplace</h4>
            <ul className="space-y-1.5 text-[11px]">
              <li><button onClick={() => setActiveView('marketplace')} className="hover:underline">Browse Produce</button></li>
              <li><button onClick={() => setActiveView('reports_regional')} className="hover:underline">Regional Prices</button></li>
              <li><button onClick={() => setActiveView('register')} className="hover:underline">Farmer Registration</button></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100 mb-2">Governance & Bureau</h4>
            <ul className="space-y-1.5 text-[11px]">
              <li><button onClick={() => { setCurrentRole('user_admin'); setActiveView('user_admin_dashboard'); }} className="hover:underline">User Administrator</button></li>
              <li><button onClick={() => { setCurrentRole('financial_manager'); setActiveView('financial_dashboard'); }} className="hover:underline">Financial Manager</button></li>
              <li><button onClick={() => { setCurrentRole('super_admin'); setActiveView('super_admin_dashboard'); }} className="hover:underline">Super Administrator</button></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100 mb-2">Contact Headquarters</h4>
            <p className="text-[11px] leading-relaxed">
              {content.contactOffice}
            </p>
            <div className="text-[11px] mt-2 space-y-0.5">
              <div>Email: {content.contactEmail}</div>
              <div>Phone: {content.contactPhone}</div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 border-t border-slate-100 dark:border-slate-800 text-center text-[11px]">
          © 2026 GreenPath Farm to Market AI. All Rights Reserved. Secured by Chapa.
        </div>
      </footer>
    </div>
  );
};
