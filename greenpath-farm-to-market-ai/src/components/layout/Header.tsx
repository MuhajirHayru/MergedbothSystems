import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { Language } from '../../types';
import { NotificationsDropdown } from '../common/NotificationsDropdown';
import {
  Sparkles,
  Globe,
  Sun,
  Moon,
  ChevronDown,
  Menu,
  X,
  Search,
  User,
  Settings,
  ShieldCheck,
  LogOut,
  Building2,
  Lock,
} from 'lucide-react';

interface HeaderProps {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, sidebarOpen }) => {
  const {
    currentRole,
    logout,
    language,
    setLanguage,
    currentUser,
    wallet,
    setAiModalOpen,
    activeView,
    setActiveView,
    platformConfig,
  } = useApp();

  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Marketplace quick-search is a shopper tool; staff consoles don't need it.
  const STAFF_ROLES = new Set([
    'super_admin', 'user_admin', 'top_user_admin', 'regional_admin',
    'zonal_admin', 'wereda_admin', 'financial_manager', 'logistics_manager',
    'customer_support',
  ]);
  const showSearch = !STAFF_ROLES.has(String(currentRole));

  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const handleSearchSubmit = (e?: React.FormEvent, term?: string) => {
    if (e) e.preventDefault();
    const query = (term !== undefined ? term : searchQuery).trim();
    if (!query) return;
    setActiveView('marketplace');
    navigate(`/marketplace?search=${encodeURIComponent(query)}`);
    setSearchFocused(false);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getBrandTitle = () => {
    if (language === 'am') return platformConfig.amharicTitle || 'ግሪንፓዝ የግብርና ገበያ AI';
    if (language === 'om') return platformConfig.oromoTitle || 'GreenPath Gabaa Qonnaa AI';
    return platformConfig.platformTitle || 'GreenPath Farm to Market AI';
  };

  const getViewBreadcrumb = () => {
    const formatted = activeView.replace(/_/g, ' ');
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  return (
    <header className="sticky top-0 z-50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-colors duration-150">
      <div className="w-full px-3 sm:px-6">
        <div className="flex items-center justify-between gap-4 h-16">
          {/* Left Zone: Hamburger & Logo & Breadcrumb */}
          <div className="flex items-center gap-3 shrink-0">
            {onToggleSidebar && currentRole !== 'public' && (
              <button
                type="button"
                onClick={onToggleSidebar}
                aria-label={sidebarOpen ? 'Close navigation sidebar' : 'Open navigation sidebar'}
                className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white md:hidden rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}

            <button
              onClick={() => {
                if (currentRole === 'public') setActiveView('landing');
                else setActiveView('marketplace');
              }}
              className="text-left group flex items-center gap-2.5 focus:outline-none"
            >
              <div className="w-8 h-8 rounded-lg bg-[#15803D] text-white flex items-center justify-center font-bold text-sm shadow-sm group-hover:bg-[#16A34A] transition-colors">
                GP
              </div>
              <div className="hidden sm:block">
                <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 group-hover:text-[#15803D] dark:group-hover:text-emerald-400 transition-colors whitespace-nowrap">
                  {getBrandTitle()}
                </span>
                <span className="hidden xl:inline text-[11px] text-slate-400 dark:text-slate-500 font-mono ml-2">
                  Ethiopia
                </span>
              </div>
            </button>

            {/* Breadcrumb Context */}
            {currentRole !== 'public' && (
              <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-slate-200 dark:border-slate-800 text-xs">
                <span className="text-slate-400 dark:text-slate-500 font-medium">Workspace</span>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 capitalize">
                  {getViewBreadcrumb()}
                </span>
              </div>
            )}
          </div>

          {/* Center Zone: Quick Search (wired to Marketplace search) — staff consoles omit it */}
          {showSearch && (
          <div ref={searchContainerRef} className="hidden md:flex flex-1 max-w-md mx-2 relative">
            <form onSubmit={handleSearchSubmit} className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search commodities, varieties, regions (e.g. Avocado, Teff)..."
                className="w-full pl-9 pr-8 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#15803D] dark:focus:ring-emerald-500 transition-all shadow-inner"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>

            {/* Quick search instant suggestions dropdown */}
            {searchFocused && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-3 z-50 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Popular Commodities & Corridors
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '🥑 Hass Avocado', term: 'Avocado' },
                    { label: '🍅 Meki Tomatoes', term: 'Tomato' },
                    { label: '🧅 Red Shallots', term: 'Onion' },
                    { label: '🌾 Yirgacheffe Coffee', term: 'Coffee' },
                    { label: '🥔 Highland Potatoes', term: 'Potato' },
                    { label: '🚚 Mojo-Addis Corridor', term: 'Mojo' },
                  ].map((chip) => (
                    <button
                      key={chip.term}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSearchQuery(chip.term);
                        handleSearchSubmit(undefined, chip.term);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700 dark:hover:text-emerald-300 text-slate-700 dark:text-slate-300 transition-colors text-[11px] font-medium"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Right Zone: Controls (Role Switcher, Theme, Language, Notifications, User) */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Current role (read-only; determined by signed-in account) */}
            {currentRole !== 'public' && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 capitalize">
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
                {currentRole.replace(/_/g, ' ')}
              </span>
            )}


            {/* Notification Center */}
            {currentRole !== 'public' && <NotificationsDropdown />}

            {/* Global AI Assistant Trigger */}
            <button
              onClick={() => setAiModalOpen(true)}
              className="p-2 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition-colors"
              title="Open Global Multilingual AI Assistant"
              aria-label="Open Global Multilingual AI Assistant"
            >
              <Sparkles className="w-5 h-5 animate-pulse" />
            </button>

            {/* Theme Toggle (Light / Dark) */}
            <button
              onClick={toggleTheme}
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors focus:outline-none"
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
              aria-label="Toggle Theme"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4 text-slate-700" />
              ) : (
                <Sun className="w-4 h-4 text-amber-400" />
              )}
            </button>

            {/* Language Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                className="flex items-center gap-1 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-xs font-semibold"
                title="Select Language"
              >
                <Globe className="w-4 h-4 text-slate-500" />
                <span className="uppercase text-[11px]">{language}</span>
              </button>

              {langDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setLangDropdownOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 z-50 py-1 text-xs">
                    <button
                      onClick={() => {
                        setLanguage('en');
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                        language === 'en' ? 'font-bold text-[#15803D]' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      English (EN)
                    </button>
                    <button
                      onClick={() => {
                        setLanguage('am');
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                        language === 'am' ? 'font-bold text-[#15803D]' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      አማርኛ (Amharic)
                    </button>
                    <button
                      onClick={() => {
                        setLanguage('om');
                        setLangDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${
                        language === 'om' ? 'font-bold text-[#15803D]' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      Afaan Oromoo (OM)
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* User Profile Menu */}
            {currentRole !== 'public' ? (
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-[#15803D] text-white flex items-center justify-center font-bold text-xs">
                    {(currentUser?.name || currentUser?.email || 'G').charAt(0).toUpperCase()}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {userDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserDropdownOpen(false)}
                      aria-hidden="true"
                    />
                    <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 z-50 py-2 text-xs divide-y divide-slate-100 dark:divide-slate-800">
                      <div className="px-4 py-2.5">
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">
                          {currentUser?.name || 'Signed-in user'}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {currentUser?.email || ''}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 capitalize">
                            {String(currentUser?.role || currentRole || '').replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {currentUser?.region || ''}
                          </span>
                        </div>
                      </div>

                      <div className="py-1">
                        <button
                          onClick={() => {
                            setActiveView('settings');
                            setUserDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                        >
                          <User className="w-4 h-4 text-slate-400" />
                          <span>Profile & Account</span>
                        </button>
                        <button
                          onClick={() => {
                            setActiveView('wallet');
                            setUserDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                        >
                          <Building2 className="w-4 h-4 text-slate-400" />
                          <span>Wallet & Bank Accounts</span>
                        </button>
                        <button
                          onClick={() => {
                            setActiveView('settings');
                            setUserDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                        >
                          <Settings className="w-4 h-4 text-slate-400" />
                          <span>Preferences & Security</span>
                        </button>
                      </div>

                      <div className="pt-1">
                        <button
                          onClick={async () => {
                            setUserDropdownOpen(false);
                            await logout();
                            setActiveView('landing');
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-left font-medium"
                        >
                          <LogOut className="w-4 h-4" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveView('login')}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-[#15803D] dark:hover:text-emerald-400"
                >
                  Sign In
                </button>
                <button
                  onClick={() => setActiveView('register')}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#15803D] hover:bg-[#166534] text-white rounded-lg transition-colors shadow-xs"
                >
                  Register
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
