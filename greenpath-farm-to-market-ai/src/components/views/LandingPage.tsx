import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

/**
 * Landing page — three connected moments: growing, transporting, ordering.
 * Design source: CANVA_LANDING_PAGE_BRIEF.md / canva-greenpath-landing.html
 * (deep forest green + harvest green + soft cream, full-frame documentary
 * photography, minimal header, compact footer).
 */

const photos = {
  farmer: '/images/landing-hero-farmer.png',
  truck: '/images/landing-truck.jpg',
  farmers: '/images/landing-farmers-phone.jpg',
};

export const LandingPage: React.FC = () => {
  const { platformConfig, setActiveView } = useApp();
  const navigate = useNavigate();
  const content = platformConfig?.websiteContent;
  const go = (view: 'login' | 'register') => {
    setActiveView(view);
    navigate(`/${view}`);
  };

  return (
    <div className="min-h-screen bg-[#f8f7f1] text-[#173b2b]" style={{ fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' }}>
      {/* Header — wordmark + the only two account actions */}
      <header className="flex h-[76px] items-center justify-between bg-[#fbfaf6] px-[6vw]">
        <div className="flex items-center gap-3 text-[21px] font-extrabold tracking-[-.04em]">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-[#17633c] text-[20px] text-white">✦</span>
          <span>GreenPath</span>
        </div>
        <div className="flex items-center gap-2.5 text-[14px] font-bold">
          <button onClick={() => go('login')} className="px-[17px] py-[11px] hover:underline">Sign in</button>
          <button onClick={() => go('register')} className="rounded-full bg-[#17633c] px-[19px] py-3 text-white transition hover:bg-[#124d30]">Create account</button>
        </div>
      </header>

      <main>
        {/* Scene 1 — farmer at work: full-frame photo, gradient behind the copy */}
        <section className="relative flex min-h-[680px] h-[calc(100vh-76px)] max-h-[900px] items-center overflow-hidden bg-[#183b2b]">
          <img
            src={photos.farmer}
            alt="Farmer harvesting vegetables in a green field"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: 'center 52%' }}
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(13,39,28,.82), rgba(13,39,28,.48) 48%, rgba(13,39,28,.04))' }} />
          <div className="relative z-10 max-w-[760px] px-[9vw] py-10 text-white">
            <h1 className="m-0 text-[clamp(48px,6.5vw,88px)] font-extrabold leading-[.99] tracking-[-.065em]">
              Good food starts with farmers in the field.
            </h1>
            <p className="mt-[26px] max-w-[560px] text-[clamp(18px,1.7vw,22px)] leading-[1.55] text-white/90">
              GreenPath connects the people who grow fresh produce with the buyers who need it.
            </p>
          </div>
        </section>

        {/* Scene 2 — produce in transit: the whole truck, the whole load */}
        <section className="grid min-h-[660px] place-items-center bg-[#17633c] px-[5vw] py-[42px]">
          <div className="relative grid min-h-[570px] w-full max-w-[1500px] place-items-center overflow-hidden rounded-[28px] bg-[#184c32]">
            <img
              src={photos.truck}
              alt="A farm truck with tomatoes and potatoes on board"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(8,43,25,.38), rgba(8,43,25,.13), rgba(8,43,25,.4))' }} />
            <h2 className="z-10 m-0 p-6 text-center text-white text-[clamp(42px,6.8vw,88px)] font-extrabold leading-[1.03] tracking-[-.055em]" style={{ textShadow: '0 3px 22px rgba(0,0,0,.55)' }}>
              Your order is on the way
            </h2>
          </div>
        </section>

        {/* Scene 3 — farmers and phone orders */}
        <section className="mx-auto grid max-w-[1440px] grid-cols-[.88fr_1.12fr] items-center gap-[7vw] px-[7vw] py-[112px]">
          <div>
            <h2 className="m-0 max-w-[520px] text-[clamp(40px,5vw,66px)] font-extrabold leading-[1.02] tracking-[-.06em]">
              Farmers manage orders. Buyers order direct.
            </h2>
            <p className="mx-0 mt-[23px] max-w-[540px] text-[18px] leading-[1.7] text-[#52665a]">
              Farmers can check their GreenPath dashboard on a phone while wholesalers and retailers send orders straight to the source.
            </p>
          </div>
          <div className="relative min-h-[490px] h-[min(56vw,620px)] overflow-hidden rounded-[30px] bg-[#dce8d8]">
            <img
              src={photos.farmers}
              alt="Smiling farmers checking a phone together in a field"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 h-[60%]" style={{ background: 'linear-gradient(transparent, rgba(14,41,27,.18))' }} />
          </div>
        </section>
      </main>

      {/* Footer — compact forest green with the configured contacts */}
      <footer className="flex min-h-[150px] flex-wrap items-center justify-between gap-[22px] bg-[#173b2b] px-[7vw] py-10 text-white">
        <div className="flex items-center gap-3 text-[18px] font-extrabold tracking-[-.04em]">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#17633c] text-[18px] text-white">✦</span>
          <span>GreenPath</span>
        </div>
        <address className="flex flex-wrap gap-x-[30px] gap-y-3 text-[14px] not-italic text-white/85">
          <span>{content?.contactEmail || 'support@greenpath.et'}</span>
          <span>{content?.contactPhone || '+251 900 000 000'}</span>
          <span>{content?.contactOffice || 'Addis Ababa, Ethiopia'}</span>
        </address>
      </footer>
    </div>
  );
};
