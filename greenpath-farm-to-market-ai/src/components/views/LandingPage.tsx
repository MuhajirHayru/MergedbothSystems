import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Mail, MapPin, Phone, Sprout } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const photos = {
  farmer: '/images/landing-hero-farmer.png',
  vegetables: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=1000&q=85',
  fruits: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=1000&q=85',
  grains: 'https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?auto=format&fit=crop&w=1000&q=85',
};

export const LandingPage: React.FC = () => {
  const { platformConfig, setActiveView } = useApp();
  const navigate = useNavigate();
  const content = platformConfig?.websiteContent;
  const brand = 'GreenPath';
  const shortBrand = 'greenpath';
  const go = (view: 'login' | 'register') => {
    setActiveView(view);
    navigate(`/${view}`);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#fbfaf6] font-sans text-[#163c2c] selection:bg-[#cde7bd]">
      <header className="relative z-20 border-b border-[#163c2c]/10 bg-[#fbfaf6]">
        <div className="mx-auto flex h-[76px] max-w-[1320px] items-center justify-between px-5 sm:px-9 lg:px-14">
          <a href="/" onClick={(e) => { e.preventDefault(); setActiveView('landing'); navigate('/'); }} aria-label={`${brand} home`} className="flex items-center">
            <span className="text-[19px] font-extrabold tracking-[-.06em]">{shortBrand}</span>
          </a>
          <div className="flex items-center gap-2.5 sm:gap-4">
            <button onClick={() => go('login')} className="rounded-[4px] px-4 py-2.5 text-[12px] font-semibold hover:bg-[#edf2e9]">Login</button>
            <button onClick={() => go('register')} className="rounded-[4px] bg-[#1e6848] px-4 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#17553a]">Register</button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid min-h-[620px] max-w-[1320px] items-center gap-10 px-5 py-12 sm:px-9 sm:py-16 lg:min-h-[680px] lg:grid-cols-[.95fr_1.05fr] lg:gap-16 lg:px-14 lg:py-20">
          <div className="relative z-10 max-w-[570px]">
            <h1 className="text-[clamp(3rem,6vw,5.2rem)] font-semibold leading-[1.04] tracking-[-.07em]">Increase farmers’ wealth by connecting directly to buyers.</h1>
            <p className="mt-6 max-w-[495px] text-[15px] leading-7 text-[#65766b] sm:text-[17px] sm:leading-8">GreenPath brings farmers and buyers together directly, helping farmers reach better markets and grow their income.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button onClick={() => go('register')} className="rounded-[4px] bg-[#1e6848] px-5 py-3 text-[12px] font-bold text-white shadow-sm transition hover:bg-[#17553a]">Register <ArrowRight className="ml-1 inline" size={13} /></button>
            </div>
          </div>
          <div className="relative min-h-[390px] overflow-hidden rounded-[6px] bg-[#dae5d3] sm:min-h-[490px] lg:min-h-[520px]">
            <img src={photos.farmer} alt="Farmer harvesting fresh produce in the field" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover object-center saturate-[1.24] contrast-[1.04]" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#163c2c]/25 via-transparent to-transparent" />
            <div className="absolute bottom-5 left-5 flex items-center gap-3 rounded-[4px] border border-white/60 bg-[#fbfaf6]/95 px-4 py-3 shadow-lg backdrop-blur sm:bottom-7 sm:left-7">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e4efdc] text-[#32734d]"><Sprout size={17} /></span>
              <span><span className="block text-[9px] font-bold uppercase tracking-[.13em] text-[#7d8a7d]">Freshly connected</span><span className="mt-0.5 block text-[13px] font-semibold">Closer to the source</span></span>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-[1320px] px-5 py-20 sm:px-9 sm:py-28 lg:px-14">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_.75fr] lg:items-end">
            <div><p className="mb-4 text-[9px] font-bold uppercase tracking-[.16em] text-[#477c54]">A simpler way to connect</p><h2 className="max-w-[600px] text-[clamp(2rem,3.7vw,3.1rem)] font-semibold leading-[1.12] tracking-[-.05em]">From growing to selling.<br/>Without the guesswork.</h2></div>
            <p className="max-w-[390px] pb-1 text-[12px] leading-5 text-[#748077] lg:justify-self-end">One place for the people who grow our food and the people who need it.</p>
          </div>
          <div className="mt-14 grid gap-8 border-t border-[#dfe4da] pt-7 sm:grid-cols-3 sm:gap-6">
            {[['01', 'Find your people', 'Farmers list their harvest. Buyers discover fresh produce and connect at the source.'], ['02', 'Make a fair connection', 'Explore products, discuss your needs, and choose what works for you.'], ['03', 'Keep your order in view', 'Follow order updates and delivery progress with live logistics tracking on our roadmap.']].map(([n, title, desc]) => <article key={n} className="border-t border-[#e0e4dc] pt-5 pr-4"><span className="text-[16px] font-medium text-[#236744]">{n}</span><h3 className="mt-3 text-[14px] font-semibold tracking-[-.02em]">{title}</h3><p className="mt-2 max-w-[330px] text-[11px] leading-[1.55] text-[#7a857c]">{desc}</p></article>)}
          </div>
        </section>

        <section className="bg-[#fbfaf6] py-20 sm:py-24">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-9 lg:px-14">
            <div><p className="mb-3 text-[9px] font-bold uppercase tracking-[.16em] text-[#477c54]">The marketplace</p><h2 className="text-[clamp(2rem,3.7vw,3.1rem)] font-semibold leading-[1.12] tracking-[-.05em]">Fresh finds. Direct from the farm.</h2><p className="mt-3 text-[11px] text-[#7a857c]">Discover what’s growing, and connect with the people behind it.</p></div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">{[['Fresh vegetables', 'Tomatoes, leafy greens & everyday goodness', photos.vegetables], ['Seasonal fruits', 'Naturally sweet, picked with care', photos.fruits], ['Grains & staples', 'Teff, maize & the essentials you trust', photos.grains]].map(([title, sub, image]) => <article key={title} className="rounded-[5px] bg-[#f8f9f4] p-2"><div className="relative aspect-[1.75] overflow-hidden rounded-[4px] bg-[#d8e3d2]"><img src={image} alt={title} loading="lazy" className="h-full w-full object-cover" /></div><h3 className="mt-3 text-[11px] font-semibold">{title}</h3><p className="mt-1 text-[9px] text-[#7e887e]">{sub}</p></article>)}</div>
          </div>
        </section>

        <section className="bg-[#173e2e] text-white">
          <div className="mx-auto grid max-w-[1320px] items-center gap-12 px-5 py-20 sm:px-9 sm:py-24 lg:grid-cols-[.9fr_1.1fr] lg:px-14 lg:py-28">
            <div><p className="mb-4 text-[9px] font-bold uppercase tracking-[.16em] text-[#d1e3bc]">A little intelligence. A lot of possibility.</p><h2 className="max-w-[470px] text-[clamp(2rem,3.7vw,3rem)] font-semibold leading-[1.12] tracking-[-.05em]">Your next growing season, with a smarter start.</h2><p className="mt-4 max-w-[390px] text-[11px] leading-[1.6] text-white/70">Meet your AI farming companion. A simpler way to ask questions, explore crop insights, and make more informed decisions on your farm.</p><div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[9px] text-white/80">{['Crop guidance', 'Practical insights', 'Everyday support'].map((item) => <span key={item}>{item}</span>)}</div></div>
            <div className="relative mx-auto w-full max-w-[510px] rounded-[6px] bg-[#f6f7f0] p-4 text-[#203b2d] sm:p-5"><div className="flex items-center justify-between border-b border-[#e3e8df] pb-3"><div className="text-[11px] font-semibold">GreenPath assistant</div><span className="rounded-full bg-[#e7f0dc] px-2 py-1 text-[8px] font-bold text-[#537d4f]">PREVIEW</span></div><div className="py-4"><div className="ml-auto max-w-[290px] rounded-[5px] bg-[#e8efd9] p-3 text-[9px] text-[#556657]">How can I prepare for my next planting season?</div><p className="mt-4 text-[7px] font-bold uppercase tracking-[.14em] text-[#5a9164]">Let’s grow together</p><h3 className="mt-2 text-[12px] font-semibold">Start with your farm, not a guess.</h3><p className="mt-2 max-w-[340px] text-[9px] leading-[1.5] text-[#819083]">Tell me your crop, location, and planting plans. We can explore soil preparation, seasonal needs, and questions to discuss with a local expert.</p></div><div className="rounded-[4px] border border-[#e8ece4] bg-white px-3 py-2 text-[8px] text-[#a0aaa0]">Ask a farming question... <ArrowUpRight className="float-right text-[#438253]" size={12} /></div></div>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1320px] items-center gap-10 px-5 py-20 sm:px-9 sm:py-24 lg:grid-cols-[.8fr_1.2fr] lg:px-14 lg:py-28">
          <div><p className="mb-4 inline-flex rounded-full bg-[#edf2e5] px-3 py-1.5 text-[8px] font-bold uppercase tracking-[.12em] text-[#477c54]">On the roadmap</p><h2 className="max-w-[450px] text-[clamp(2rem,3.7vw,3.1rem)] font-semibold leading-[1.12] tracking-[-.05em]">From farm gate<br/>to your doorstep.<br/>Stay in the loop.</h2><p className="mt-4 max-w-[370px] text-[11px] leading-[1.6] text-[#748077]">Good connections shouldn’t end at checkout. We’re planning live logistics tracking to make the journey of every order easier to follow.</p><div className="mt-4 flex flex-wrap gap-2 text-[9px] font-medium text-[#477c54]"><span>Live location</span><span>·</span><span>Delivery progress</span><span>·</span><span>Order updates</span></div><p className="mt-4 text-[8px] text-[#98a197]">Future feature · Tracking preview shown for illustration.</p></div>
          <div className="rounded-[6px] border border-[#e0e6dc] bg-white p-4 sm:p-5"><div className="flex items-start justify-between"><div><h3 className="text-[11px] font-semibold">Your harvest, on its way</h3><p className="mt-1 text-[7px] font-medium uppercase tracking-[.1em] text-[#8b9689]">Demo order · GP-0426</p></div><span className="rounded-full bg-[#eff4e8] px-2 py-1 text-[7px] font-medium text-[#61855a]">Location preview</span></div><div className="relative mt-3 h-[170px] overflow-hidden rounded-[3px] bg-[#edf2e8] sm:h-[205px]" style={{backgroundImage:'linear-gradient(28deg,transparent 47%,#fff 48%,#fff 51%,transparent 52%),linear-gradient(145deg,transparent 42%,#fff 43%,#fff 46%,transparent 47%),linear-gradient(90deg,transparent 34%,#fff 35%,#fff 38%,transparent 39%),linear-gradient(0deg,transparent 65%,#fff 66%,#fff 69%,transparent 70%)'}}><svg className="absolute inset-0 h-full w-full" viewBox="0 0 520 250" preserveAspectRatio="none" aria-hidden="true"><polyline points="70,194 165,194 165,145 286,145 286,86 430,86" fill="none" stroke="#247047" strokeWidth="5"/><circle cx="70" cy="194" r="8" fill="#247047"/><circle cx="286" cy="145" r="13" fill="#247047" stroke="#c8dfc2" strokeWidth="8"/><circle cx="430" cy="86" r="8" fill="#163c2c"/></svg><span className="absolute left-[11%] bottom-[10%] text-[7px] font-semibold text-[#285d41]">Farm</span><span className="absolute right-[14%] top-[30%] text-[7px] font-semibold text-[#285d41]">Your delivery</span></div><div className="mt-3 flex items-center justify-between text-[8px] text-[#7b887e]"><span className="font-semibold text-[#526d58]">Delivery journey</span><span>Preview only</span></div><div className="mt-3 flex items-center"><span className="h-2 w-2 rounded-full bg-[#28764d]"/><span className="h-px flex-1 bg-[#9abb92]"/><span className="h-2 w-2 rounded-full bg-[#28764d]"/><span className="h-px flex-1 bg-[#9abb92]"/><span className="h-2 w-2 rounded-full bg-[#28764d]"/><span className="h-px flex-1 bg-[#dce5d8]"/><span className="h-2 w-2 rounded-full bg-[#dce5d8]"/></div><div className="mt-2 flex justify-between text-[7px] text-[#879187]"><span>Confirmed</span><span>Picked up</span><span className="font-semibold text-[#4b8158]">On the way</span><span>Delivered</span></div></div>
        </section>

        <section className="bg-[#deefb6]">
          <div className="mx-auto max-w-[1320px] px-5 py-9 sm:px-9 sm:py-11 lg:px-14"><h2 className="text-[clamp(1.7rem,3vw,2.6rem)] font-semibold leading-tight tracking-[-.04em]">Better connections. Better possibilities.</h2><p className="mt-2 max-w-[560px] text-[11px] leading-5 text-[#637a65]">Whether you grow it or need it, your next chapter starts here.</p><div className="mt-5"><button onClick={() => go('register')} className="rounded-[4px] bg-[#1e6848] px-4 py-2.5 text-[10px] font-bold text-white hover:bg-[#17553a]">Register <ArrowRight className="ml-1 inline" size={12} /></button></div></div>
        </section>
      </main>

      <footer className="bg-[#153a2b] text-white">
        <div className="mx-auto max-w-[1320px] px-5 py-8 sm:px-9 sm:py-9 lg:px-14">
          <div className="flex flex-col gap-6 border-b border-white/15 pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div><a href="/" onClick={(e) => { e.preventDefault(); setActiveView('landing'); navigate('/'); }} className="inline-flex text-[17px] font-extrabold tracking-[-.05em]">{shortBrand}</a><p className="mt-2 text-[11px] text-white/65">Farm to market, together.</p></div>
            <address className="flex flex-col gap-2 not-italic text-[11px] text-white/70 sm:items-end">{content?.contactEmail && <a className="inline-flex items-center gap-2 hover:text-white" href={`mailto:${content.contactEmail}`}><Mail size={13}/>{content.contactEmail}</a>}{content?.contactPhone && <a className="inline-flex items-center gap-2 hover:text-white" href={`tel:${content.contactPhone}`}><Phone size={13}/>{content.contactPhone}</a>}{content?.contactOffice && <span className="inline-flex items-center gap-2"><MapPin size={13}/>{content.contactOffice}</span>}</address>
          </div>
          <div className="pt-4 text-[9px] text-white/45">© {new Date().getFullYear()} GreenPath. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};
