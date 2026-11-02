"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Bell,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { getNavItems, useAuth, usesSidebar, type NavItem } from "@/lib/auth/context";
import { ICONS, shortRelative } from "@/lib/format";
import { authApi, notificationsApi, walletApi } from "@/lib/api/client";
import { Avatar, CommandPalette, Spinner, ToastProvider } from "@/components/ui";
import { PresenceProvider } from "@/components/presence/PresenceProvider";
import { AssistantWidget } from "@/components/layout/AssistantWidget";
import { BrandMark } from "@/components/branding/BrandMark";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { cn } from "@/lib/utils";
import type { Notification, UserRole } from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared unread count
// ---------------------------------------------------------------------------

interface UnreadContextValue {
  count: number;
  pendingPayoutCount: number | null;
  announcement: string | null;
  refresh: () => void;
}

let routeNavigationStartedAt: number | null = null;

const UnreadContext = createContext<UnreadContextValue>({
  count: 0,
  pendingPayoutCount: null,
  announcement: null,
  refresh: () => undefined,
});

function UnreadProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [count, setCount] = useState(0);
  const [pendingPayoutCount, setPendingPayoutCount] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!isAuthenticated) {
      setCount(0);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const data = await notificationsApi.unreadCount();
        if (!cancelled) setCount(data.unread_count ?? 0);
      } catch {
        // The badge is best-effort; a failure must not break the shell.
      }
    };

    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated, nonce]);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== "FINANCIAL_MANAGER") {
      setPendingPayoutCount(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const data = await walletApi.payouts({ status: "PENDING", page: 1 });
        if (!cancelled) setPendingPayoutCount(data.count);
      } catch {
        // Keep the last successful count; the next poll can recover.
      }
    };

    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated, user?.role]);

  useEffect(() => {
    if (!isAuthenticated) {
      setAnnouncement(null);
      return;
    }

    let cancelled = false;
    authApi
      .announcement()
      .then((data) => {
        if (!cancelled) setAnnouncement(data.announcement || null);
      })
      .catch(() => {
        // The announcement is optional; a failed fetch should not block the shell.
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const value = useMemo(
    () => ({ count, pendingPayoutCount, announcement, refresh }),
    [count, pendingPayoutCount, announcement, refresh]
  );
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function SharedAppProviders({ children }: { children: ReactNode }) {
  return (
    <PresenceProvider>
      <ToastProvider>
        <UnreadProvider>
          <RouteTiming />
          {children}
        </UnreadProvider>
      </ToastProvider>
    </PresenceProvider>
  );
}

function RouteTiming() {
  const pathname = usePathname();

  useEffect(() => {
    if (import.meta.env.VITE_PERFORMANCE_DIAGNOSTICS !== "1") return;
    const startNavigation = (event?: MouseEvent) => {
      if (event?.target instanceof Element) {
        const anchor = event.target.closest("a[href]");
        if (!anchor) return;
        const destination = new URL(anchor.getAttribute("href")!, window.location.href);
        if (
          destination.origin !== window.location.origin ||
          destination.pathname === window.location.pathname
        ) {
          return;
        }
      }
      routeNavigationStartedAt = performance.now();
    };
    const handleClick = (event: MouseEvent) => startNavigation(event);
    const handlePopState = () => startNavigation();
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_PERFORMANCE_DIAGNOSTICS !== "1") return;
    const startedAt = routeNavigationStartedAt;
    if (startedAt === null) return;
    routeNavigationStartedAt = null;
    console.info("[performance] route-transition", {
      pathname,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }, [pathname]);

  return null;
}

function useUnread() {
  return useContext(UnreadContext);
}

/**
 * Exposed so pages rendered inside `<AppShell>` (e.g. `/notifications`) can
 * refresh the shared bell/sidebar counter after marking items read.
 */
export function useNotifications() {
  return useUnread();
}

// ---------------------------------------------------------------------------
// Full page loader shown while auth or the role guard resolves
// ---------------------------------------------------------------------------

function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification bell with a peek popover
// ---------------------------------------------------------------------------

function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const { count, refresh } = useUnread();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    notificationsApi
      .list(1)
      .then((data) => {
        if (!cancelled) setItems(data.results.slice(0, 8));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function markAll() {
    try {
      await notificationsApi.markAllRead();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      refresh();
    } catch {
      // Ignore: the next poll will correct the badge.
    }
  }

  async function openNotification(notification: Notification) {
    try {
      if (!notification.is_read) {
        await notificationsApi.markRead(notification.id);
        setItems((prev) =>
          prev.map((item) =>
            item.id === notification.id ? { ...item, is_read: true } : item
          )
        );
        refresh();
      }
      setOpen(false);
      router.push(notification.target_url || "/notifications");
    } catch {
      setOpen(false);
      router.push("/notifications");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              {count > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  You&apos;re all caught up.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((n) => (
                    <li
                      key={n.id}
                      className={cn("px-4 py-3", !n.is_read && "bg-primary/5")}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => void openNotification(n)}
                      >
                        <span className="block text-sm text-foreground">{n.message}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {shortRelative(n.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-border px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-muted"
            >
              View all
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search trigger (opens the command palette)
// ---------------------------------------------------------------------------

function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Search pages and actions"
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span className="hidden lg:inline">Search…</span>
      <kbd className="hidden rounded border border-border px-1 text-[10px] lg:inline">Ctrl K</kbd>
    </button>
  );
}

// ---------------------------------------------------------------------------
// User chip with profile / settings / logout
// ---------------------------------------------------------------------------

function UserChip() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar name={user.full_name} size="sm" src={user.profile_photo} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold text-foreground">
            {user.full_name}
          </span>
          <span className="block text-xs text-muted-foreground">{user.role_display}</span>
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-lg)]">
            <div className="border-b border-border px-4 py-3">
              <p className="truncate text-sm font-semibold text-foreground">
                {user.full_name}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-foreground hover:bg-muted"
            >
              Profile
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-foreground hover:bg-muted"
            >
              Settings
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                void logout();
              }}
              className="flex w-full items-center gap-2 border-t border-border px-4 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared nav link rendering
// ---------------------------------------------------------------------------

function useNavState() {
  const pathname = usePathname();

  return useCallback(
    (item: NavItem) =>
      pathname === item.href ||
      (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
    [pathname]
  );
}

const BADGED_LABELS = new Set(["Notifications"]);

function NavBadge({ label }: { label: string }) {
  const { count, pendingPayoutCount } = useUnread();

  if (label === "Payout Invoices") {
    if (pendingPayoutCount === null || pendingPayoutCount <= 0) return null;
    return (
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
        {pendingPayoutCount > 99 ? "99+" : pendingPayoutCount}
      </span>
    );
  }
  if (!BADGED_LABELS.has(label) || count <= 0) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sidebar for the marketplace roles
// ---------------------------------------------------------------------------

function Sidebar({
  items,
  collapsed,
  mobileOpen,
  onClose,
  onToggleCollapsed,
}: {
  items: NavItem[];
  collapsed: boolean;
  mobileOpen: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
}) {
  const isActive = useNavState();
  const { logout } = useAuth();
  let previousGroup: string | undefined;

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/40 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        id="dashboard-sidebar"
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-200 md:static md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "md:w-20" : "md:w-60 xl:w-64"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border px-5",
            collapsed && "md:justify-center md:px-2"
          )}
        >
          <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-2">
            <BrandMark
              className="text-sidebar-foreground"
              iconClassName="h-6 w-6 text-sidebar-foreground"
              nameClassName={cn(
                "truncate text-lg font-semibold text-sidebar-foreground",
                collapsed && "md:hidden"
              )}
            />
          </Link>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="ml-auto hidden rounded-[var(--radius-sm)] p-2 text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:block"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-[var(--radius-sm)] p-2 text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {items.map((item) => {
            const Icon = ICONS[item.icon] ?? ICONS.LayoutDashboard;
            const active = isActive(item);
            const showGroup = item.group && item.group !== previousGroup;
            previousGroup = item.group;

            return (
              <div key={item.href}>
                {showGroup && (
                  <p
                    className={cn(
                      "px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/60",
                      collapsed && "md:sr-only"
                    )}
                  >
                    {item.group}
                  </p>
                )}
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    collapsed && "md:justify-center md:px-2"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className={cn("flex-1 truncate", collapsed && "md:hidden")}>
                    {item.label}
                  </span>
                  <span className={cn(collapsed && "md:hidden")}>
                    <NavBadge label={item.label} />
                  </span>
                </Link>
              </div>
            );
          })}

          <button
            onClick={() => void logout()}
            className={cn(
              "mt-auto flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-medium text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapsed && "md:justify-center md:px-2"
            )}
            aria-label={collapsed ? "Logout" : undefined}
            title={collapsed ? "Logout" : undefined}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>Logout</span>
          </button>
        </nav>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Header for sidebar roles
// ---------------------------------------------------------------------------

function Header({
  title,
  onOpenNavigation,
  onOpenSearch,
}: {
  title: string;
  onOpenNavigation: () => void;
  onOpenSearch: () => void;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenNavigation}
          className="rounded-[var(--radius-sm)] p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          aria-label="Open navigation"
          aria-controls="dashboard-sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-lg font-semibold text-foreground lg:text-xl">{title}</h1>
      </div>
      <div className="flex items-center gap-1.5 lg:gap-3">
        <SearchTrigger onOpen={onOpenSearch} />
        <ThemeToggle />
        <NotificationBell />
        <UserChip />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Super-admin announcement banner
// ---------------------------------------------------------------------------

function Announcement() {
  const { announcement: text } = useUnread();

  if (!text) return null;

  return (
    <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/10 px-5 py-2 text-sm text-foreground lg:px-8">
      <ShieldAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-nav chrome for staff roles
// ---------------------------------------------------------------------------

function TopNav({
  items,
  title,
  mobileOpen,
  onClose,
  onOpenNavigation,
  onOpenSearch,
}: {
  items: NavItem[];
  title: string;
  mobileOpen: boolean;
  onClose: () => void;
  onOpenNavigation: () => void;
  onOpenSearch: () => void;
}) {
  const isActive = useNavState();
  const { logout } = useAuth();

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/40 md:hidden"
          onClick={onClose}
        />
      )}
      <div className="border-b border-border bg-card">
        <header className="flex h-16 items-center justify-between gap-4 px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={mobileOpen ? onClose : onOpenNavigation}
              className="rounded-[var(--radius-sm)] p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              aria-label="Open navigation"
              aria-controls="topnav-panel"
              aria-expanded={mobileOpen}
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/" className="shrink-0">
              <BrandMark iconClassName="h-6 w-6 text-primary" />
            </Link>
            <h1 className="truncate text-lg font-semibold text-foreground lg:text-xl">
              {title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 lg:gap-3">
            <SearchTrigger onOpen={onOpenSearch} />
            <ThemeToggle />
            <NotificationBell />
            <UserChip />
          </div>
        </header>
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-1 overflow-x-auto px-5 pb-2 lg:px-8 md:flex"
        >
          {items.map((item) => {
            const Icon = ICONS[item.icon] ?? ICONS.LayoutDashboard;
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex items-center gap-2">
                  {item.label}
                  <NavBadge label={item.label} />
                </span>
              </Link>
            );
          })}
          <button
            onClick={() => void logout()}
            className="ml-auto flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </nav>

        {mobileOpen && (
          <div
            id="topnav-panel"
            className="max-h-[60vh] overflow-y-auto border-t border-border bg-card md:hidden"
          >
            {items.map((item) => {
              const Icon = ICONS[item.icon] ?? ICONS.LayoutDashboard;
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3 text-sm font-medium",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  <NavBadge label={item.label} />
                </Link>
              );
            })}
            <button
              onClick={() => {
                onClose();
                void logout();
              }}
              className="flex w-full items-center gap-3 border-t border-border px-5 py-3 text-left text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AppShell: auth gate + role guard + role-appropriate chrome
// ---------------------------------------------------------------------------

export function AppShell({
  title,
  children,
  allow,
}: {
  title: string;
  children: ReactNode;
  allow: UserRole[];
}) {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Pages pass `allow` as an inline array literal, so it changes identity on
  // every render. The guard is driven off the serialised key instead, which
  // keeps the effect and the render check in sync without re-firing.
  const allowKey = allow.join(",");
  const allowed = allowKey ? (allowKey.split(",") as UserRole[]) : [];

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace("/login");
    } else if (user && !allowKey.split(",").includes(user.role)) {
      router.replace("/forbidden");
    }
  }, [isLoading, isAuthenticated, user, allowKey, router]);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavigationOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavigationOpen]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  if (isLoading || !isAuthenticated || !user) {
    return <FullPageLoader />;
  }
  if (!allowed.includes(user.role)) {
    return <FullPageLoader />;
  }

  const items = getNavItems(user.role);
  const sidebar = usesSidebar(user.role);

  const commandItems = [
    ...items.map((item) => ({
      id: `nav-${item.href}`,
      label: item.label,
      group: item.group ?? "Navigate",
      href: item.href,
      keywords: item.href,
    })),
    {
      id: "action-profile",
      label: "Profile",
      group: "Account",
      href: "/profile",
    },
    {
      id: "action-settings",
      label: "Settings",
      group: "Account",
      href: "/settings",
    },
    {
      id: "action-logout",
      label: "Logout",
      group: "Account",
      keywords: "sign out",
      onSelect: () => void logout(),
    },
  ];

  const palette = (
    <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={commandItems} />
  );

  if (!sidebar) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <TopNav
          items={items}
          title={title}
          mobileOpen={mobileNavigationOpen}
          onClose={() => setMobileNavigationOpen(false)}
          onOpenNavigation={() => setMobileNavigationOpen(true)}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <Announcement />
        <main className="flex-1 overflow-y-auto p-5 lg:p-8">{children}</main>
        <AssistantWidget />
        {palette}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        items={items}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavigationOpen}
        onClose={() => setMobileNavigationOpen(false)}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          onOpenNavigation={() => setMobileNavigationOpen(true)}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <Announcement />
        <main className="flex-1 overflow-y-auto p-5 lg:p-8">{children}</main>
      </div>
      <AssistantWidget />
      {palette}
    </div>
  );
}
