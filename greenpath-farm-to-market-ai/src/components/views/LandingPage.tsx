import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

/**
 * Landing page — 1:1 port of the Lovable design
 * (bright-persona-landing.lovable.app).
 * Tokens: Manrope + Fraunces, oklch palette (deep green / cream / accent),
 * captured from the published design's stylesheet.
 */

const heroImg = '/images/lovable-hero-farm.jpg';

export const LandingPage: React.FC = () => {
  const { platformConfig, setActiveView } = useApp();
  const navigate = useNavigate();
  const content = platformConfig?.websiteContent;
  const go = (view: 'login' | 'register') => {
    setActiveView(view);
    navigate(`/${view}`);
  };
  const goRegister = (e: React.MouseEvent) => { e.preventDefault(); go('register'); };
  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="lp-root min-h-screen bg-lp-background text-lp-foreground">
      <style>{`
        .lp-root { font-family: Manrope, system-ui, sans-serif; }
        .lp-display { font-family: Fraunces, Georgia, serif; }
        .lp-root .bg-lp-background { background-color: oklch(97.5% .012 95); }
        .lp-root .text-lp-foreground { color: oklch(22% .04 150); }
        .lp-bg-card { background-color: oklch(99% .008 95); }
        .lp-border { border-color: oklch(88% .02 110); }
        .lp-primary-bg { background-color: oklch(42% .11 150); }
        .lp-primary-text { color: oklch(42% .11 150); }
        .lp-primary-fg-text { color: oklch(98% .01 95); }
        .lp-deep-bg { background-color: oklch(20% .045 155); }
        .lp-deep-fg { color: oklch(96% .015 95); }
        .lp-accent-bg { background-color: oklch(78% .15 80); }
        .lp-accent-text { color: oklch(78% .15 80); }
        .lp-accent-fg { color: oklch(22% .04 150); }
        .lp-muted-text { color: oklch(48% .03 150); }
        .lp-secondary-bg { background-color: oklch(93% .03 110); }
        .lp-hero-overlay { background: linear-gradient(100deg, color-mix(in oklab, oklch(20% .045 155) 92%, transparent) 30%, color-mix(in oklab, oklch(20% .045 155) 35%, transparent)); }
        @keyframes lp-rise { 0% { opacity: 0; transform: translateY(18px); } 100% { opacity: 1; transform: translateY(0); } }
        .lp-rise { animation: .8s ease-out both lp-rise; }
        .lp-rise-2 { animation: .8s ease-out .15s both lp-rise; }
        .lp-rise-3 { animation: .8s ease-out .3s both lp-rise; }
        .lp-rise-4 { animation: .8s ease-out .45s both lp-rise; }
      `}</style>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700&display=swap" />

      {/* Header — absolute over the hero */}
      <header className="absolute inset-x-0 top-0 z-20">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lp-deep-fg">
          <a href="/" onClick={(e) => { e.preventDefault(); setActiveView('landing'); navigate('/'); }} className="lp-display text-2xl font-bold">
            Green Path<span className="lp-accent-text">.</span>
          </a>
          <div className="hidden gap-8 text-sm font-medium md:flex">
            <a href="#who" onClick={scrollTo('who')} className="opacity-80 hover:opacity-100">Who it's for</a>
            <a href="#how" onClick={scrollTo('how')} className="opacity-80 hover:opacity-100">How it works</a>
            <a href="#why" onClick={scrollTo('why')} className="opacity-80 hover:opacity-100">Why us</a>
          </div>
          <div className="flex items-center gap-2.5 text-[14px] font-bold">
            <button onClick={() => go('login')} className="rounded-full border border-white/40 px-[19px] py-3 transition hover:bg-white/10">Login</button>
            <button onClick={() => go('register')} className="rounded-full lp-accent-bg px-[19px] py-3 lp-accent-fg transition hover:brightness-105">Register</button>
          </div>
          <a href="#join" onClick={scrollTo('join')} className="hidden rounded-full border border-white/40 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10 md:block">Get started</a>
        </nav>
      </header>

      {/* Hero — full-frame truck through Ethiopian farmland */}
      <section className="relative flex min-h-[92vh] items-center overflow-hidden">
        <img src={heroImg} alt="Truck carrying fresh produce through Ethiopian farmland" width={1920} height={1088} className="absolute inset-0 h-full w-full object-cover" />
        <div className="lp-hero-overlay absolute inset-0" />
        <div className="relative mx-auto w-full max-w-7xl px-6 pt-24 lp-deep-fg">
          <p className="lp-rise mb-5 inline-block rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest">Farm-to-market · Ethiopia</p>
          <h1 className="lp-rise-2 lp-display max-w-3xl text-5xl font-bold leading-[1.05] md:text-7xl">
            From the field to every market, <em className="lp-accent-text">safely.</em>
          </h1>
          <p className="lp-rise-3 mt-6 max-w-xl text-lg opacity-85">
            Green Path connects farmers, wholesalers, retailers and drivers on one trusted platform — with escrow-protected payments and reliable freight.
          </p>
          <div className="lp-rise-4 mt-10 flex flex-wrap gap-4">
            <a href="/register" onClick={goRegister} className="rounded-full lp-accent-bg px-7 py-3.5 font-semibold lp-accent-fg transition hover:brightness-105">Register — join the marketplace</a>
            <a href="#how" onClick={scrollTo('how')} className="rounded-full border border-white/40 px-7 py-3.5 font-semibold transition hover:bg-white/10">See how it works</a>
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="border-b lp-border lp-bg-card">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 py-12 md:grid-cols-4">
          {[['4', 'Connected roles'], ['100%', 'Escrow-backed orders'], ['Every', 'Region covered'], ['24/7', 'Order tracking']].map(([n, label]) => (
            <div key={label}>
              <div className="lp-display text-4xl font-bold lp-primary-text">{n}</div>
              <div className="mt-1 text-sm lp-muted-text">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="mx-auto max-w-7xl px-6 py-24">
        <h2 className="max-w-2xl lp-display text-4xl font-bold md:text-5xl">One platform for the whole supply chain</h2>
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            ['Farmers & Cooperatives', 'List produce, reach wholesalers nationwide and get paid safely on delivery.'],
            ['Wholesalers', 'Buy direct from farms, manage stock bays and resell to retailers with full traceability.'],
            ['Retailers', 'Source reliable stock from accredited wholesalers at transparent, locked-in prices.'],
            ['Drivers', 'Pick up loads, confirm delivery with a PIN and earn through the dedicated Driver App.'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-2xl border lp-border lp-bg-card p-7 transition hover:-translate-y-1 hover:border-[oklch(42%_0.11_150)]">
              <div className="mb-5 h-1.5 w-10 rounded-full lp-accent-bg" />
              <h3 className="lp-display text-xl font-bold">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed lp-muted-text">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works — deep green band */}
      <section id="how" className="lp-deep-bg py-24 lp-deep-fg">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="lp-display text-4xl font-bold md:text-5xl">How it works</h2>
          <div className="mt-14 grid gap-10 md:grid-cols-4">
            {[
              ['01', 'Register & get accredited', 'Submit your business details and documents. Local administrators review and approve.'],
              ['02', 'List or order produce', 'Publish harvests or buy from verified sellers with prices frozen at order time.'],
              ['03', 'Pay into escrow', 'Funds are held safely via Chapa, Telebirr, CBE Birr or bank transfer.'],
              ['04', 'Deliver & settle', 'Driver delivers, buyer confirms quality, and the seller is paid instantly.'],
            ].map(([n, title, desc]) => (
              <div key={n} className="border-t border-white/20 pt-6">
                <div className="lp-display text-3xl lp-accent-text">{n}</div>
                <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm opacity-75">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why us */}
      <section id="why" className="mx-auto max-w-7xl px-6 py-24">
        <h2 className="max-w-2xl lp-display text-4xl font-bold md:text-5xl">Built on trust, from first harvest to final payment</h2>
        <div className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {[
            ['Escrow protection', "Buyer money is held until delivery is confirmed — no one gets left unpaid."],
            ['Nationwide coverage', "Built on Ethiopia's regions, zones and weredas, with local admins in every area."],
            ['Verified members', 'Every account is reviewed with licences and IDs kept on record.'],
            ['Clear accounting', 'Every birr is recorded in a balanced ledger, auditable at any time.'],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-5">
              <div className="mt-1 h-10 w-10 shrink-0 rounded-full lp-secondary-bg ring-4 ring-[oklch(93%_0.03_110_/_50%)]" />
              <div>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-1 lp-muted-text">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Join CTA */}
      <section id="join" className="px-6 pb-24">
        <div className="lp-primary-bg mx-auto max-w-7xl rounded-3xl px-8 py-16 text-center lp-primary-fg-text md:px-16">
          <h2 className="lp-display text-4xl font-bold md:text-5xl">Ready to grow with Green Path?</h2>
          <p className="mx-auto mt-4 max-w-xl opacity-85">Register today as a farmer, wholesaler, retailer or driver and start trading with confidence.</p>
          <a href="#register" onClick={goRegister} className="mt-8 inline-block rounded-full lp-accent-bg px-8 py-4 font-semibold lp-accent-fg transition hover:brightness-105">Create your account</a>
        </div>
      </section>

      {/* Footer — contacts + support links */}
      <footer className="border-t lp-border">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="grid gap-10 md:grid-cols-3">
            <div>
              <div className="flex items-center gap-3 text-[18px] font-extrabold tracking-[-.04em]">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#17633c] text-[18px] text-white">✦</span>
                <span>GreenPath</span>
              </div>
              <p className="mt-3 max-w-[300px] text-[13px] leading-[1.6] lp-muted-text">
                Farm-to-market, together — escrow-protected trading across Ethiopia.
              </p>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.14em] text-[#477c54]">Contact</div>
              <ul className="mt-3 space-y-2 text-[13px] lp-muted-text">
                <li>
                  <a href={`mailto:${content?.contactEmail || 'support@greenpath.et'}`} className="hover:underline">
                    {content?.contactEmail || 'support@greenpath.et'}
                  </a>
                </li>
                <li>
                  <a href={`tel:${String(content?.contactPhone || '+251900000000').replace(/\s/g, '')}`} className="hover:underline">
                    {content?.contactPhone || '+251 900 000 000'}
                  </a>
                </li>
                <li>{content?.contactOffice || 'Addis Ababa, Ethiopia'}</li>
              </ul>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.14em] text-[#477c54]">Support</div>
              <ul className="mt-3 space-y-2 text-[13px] lp-muted-text">
                <li>
                  <a href="/support" onClick={(e) => { e.preventDefault(); setActiveView('support_management'); navigate('/support'); }} className="hover:underline">
                    Get Help &amp; Support
                  </a>
                </li>
                <li>
                  <a href="/login" onClick={(e) => { e.preventDefault(); go('login'); }} className="hover:underline">
                    Login to your account
                  </a>
                </li>
                <li>
                  <a href="/register" onClick={(e) => { e.preventDefault(); go('register'); }} className="hover:underline">
                    Register as a member
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col justify-between gap-3 border-t pt-6 text-sm lp-muted-text md:flex-row">
            <span className="lp-display font-bold text-lp-foreground">Green Path Systems</span>
            <span>© {new Date().getFullYear()} Green Path Systems. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
