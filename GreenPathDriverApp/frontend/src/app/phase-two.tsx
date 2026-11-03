"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Bell,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquareText,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Truck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { apiBaseUrl, apiRequest } from "@/lib/logistics-api";
import { loadUnreadCount } from "@/lib/driver-features";
import { signInWithMarketplace } from "@/lib/marketplace-auth";
import { ConfirmationDialog, PasswordField, StatusBadge } from "./ui";
import PhaseThree from "./phase-three";
import DriverBankAccounts from "./driver-bank-accounts";
import DriverChatbot from "./driver-chatbot";
import DriverMessages from "./driver-messages";
import DriverProfile from "./driver-profile";
import DriverSettings from "./driver-settings";
import DriverWallet from "./driver-wallet";

type Role =
  | "driver"
  | "farmer"
  | "wholesaler"
  | "retailer"
  | "financial_manager"
  | "administrator"
  | "super_admin"
  | "top_user_admin"
  | "regional_admin"
  | "zonal_admin"
  | "wereda_admin";

type User = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role | "";
  is_active: boolean;
};

type DocumentRecord = {
  id: number;
  document_type: string;
  verification_status: "pending" | "verified" | "rejected";
  verified_by: string | null;
  verified_at: string | null;
  verification_reason: string;
  expires_at: string | null;
  uploaded_at: string;
};

type Application = {
  id: number;
  status: string;
  legal_full_name: string;
  identity_document_type: string;
  identity_reference: string;
  license_number: string;
  license_expiry: string | null;
  vehicle_type: string;
  vehicle_registration: string;
  cargo_capacity_kg: string | null;
  service_region: string;
  service_zone: string;
  service_wereda: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_reason: string;
  created_at: string;
  updated_at: string;
  username?: string;
  email?: string;
  profile: { phone_number: string; preferred_language: string };
  documents: DocumentRecord[];
  review_history?: {
    from_status: string;
    to_status: string;
    reason: string;
    reviewer: string | null;
    created_at: string;
  }[];
};

type PageResult = { count: number; next: string | null; previous: string | null; results: Application[] };
type LoginMode = "login" | "register" | "recover";
type DriverAvailability = { available: boolean; eligible: boolean };

const reviewerRoles: Role[] = [
  "super_admin",
  "top_user_admin",
  "regional_admin",
  "zonal_admin",
  "wereda_admin",
];

const reviewTransitions: Record<string, string[]> = {
  submitted: ["under_review", "additional_info_required", "rejected"],
  under_review: ["additional_info_required", "approved", "rejected"],
  additional_info_required: ["under_review", "rejected"],
  approved: ["suspended"],
  suspended: ["under_review"],
};

const roleLabels: Record<string, string> = {
  driver: "Driver",
  farmer: "Farmer",
  wholesaler: "Wholesaler",
  retailer: "Retailer",
  financial_manager: "Financial Manager",
  administrator: "Administrator",
  super_admin: "Super Admin",
  top_user_admin: "Top User Admin",
  regional_admin: "Regional Admin",
  zonal_admin: "Zonal Admin",
  wereda_admin: "Wereda Admin",
};

export function resolveMarketplaceRegisterUrl(configuredUrl?: string) {
  if (!configuredUrl) return "";
  try {
    const url = new URL(configuredUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.searchParams.set("role", "DRIVER");
    return url.toString();
  } catch {
    return "";
  }
}
const marketplaceRegisterUrl = resolveMarketplaceRegisterUrl(
  process.env.NEXT_PUBLIC_MARKETPLACE_REGISTER_URL,
);
const marketplaceIntegrated = process.env.NEXT_PUBLIC_MARKETPLACE_INTEGRATED === "true";

function isReviewer(role: string): role is Role {
  return reviewerRoles.includes(role as Role);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function daysUntil(date: string | null) {
  return date
    ? Math.ceil((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000)
    : null;
}

export default function PhaseTwo() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<LoginMode>("login");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [application, setApplication] = useState<Application | null>(null);
  const [availability, setAvailability] = useState<DriverAvailability | null>(null);
  const [availabilityWorking, setAvailabilityWorking] = useState(false);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [queue, setQueue] = useState<PageResult | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [queueStatus, setQueueStatus] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reviewStatus, setReviewStatus] = useState("under_review");
  const [reviewReason, setReviewReason] = useState("");
  const [verifyReason, setVerifyReason] = useState("");
  const [confirmReview, setConfirmReview] = useState(false);
  const [pendingDocumentDecision, setPendingDocumentDecision] = useState<{
    documentId: number;
    verificationStatus: "verified" | "rejected";
  } | null>(null);
  const [activeNav, setActiveNav] = useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityNotice, setAvailabilityNotice] = useState("");
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [licenseDaysRemaining, setLicenseDaysRemaining] = useState<number | null>(null);
  const [resetPayload, setResetPayload] = useState<{ uid: string; token: string } | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<User>("/auth/me/")
      .then((current) => {
        if (active) {
          if (current.role === "driver" || isReviewer(current.role)) {
            setApplicationLoading(true);
          }
          setUser(current);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const updateActiveNav = () => {
      setActiveNav(window.location.hash.slice(1) || "overview");
      setMobileNavOpen(false);
    };
    updateActiveNav();
    window.addEventListener("hashchange", updateActiveNav);
    return () => window.removeEventListener("hashchange", updateActiveNav);
  }, []);

  useEffect(() => {
    if (user?.role !== "driver") return;
    let active = true;
    const refreshUnread = () => {
      void loadUnreadCount()
        .then((result) => {
          if (active) setUnreadMessages(result.unread_count);
        })
        .catch(() => undefined);
    };
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.role]);

  useEffect(() => {
    if (!user?.is_active) return;
    let active = true;
    if (user.role === "driver") {
      apiRequest<Application>("/drivers/me/application/")
        .then((value) => {
          if (active) {
            setApplication(value);
            setLicenseDaysRemaining(daysUntil(value.license_expiry));
          }
        })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : "Could not load application.");
        })
        .finally(() => {
          if (active) setApplicationLoading(false);
        });
      apiRequest<DriverAvailability>("/drivers/me/availability/")
        .then((value) => { if (active) setAvailability(value); })
        .catch(() => { if (active) setAvailability(null); });
    } else if (isReviewer(user.role)) {
      apiRequest<PageResult>("/admin/driver-applications/?page=1&page_size=20")
        .then((value) => {
          if (active) setQueue(value);
        })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : "Could not load applications.");
        })
        .finally(() => {
          if (active) setApplicationLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [user]);

  async function updateAvailability(available: boolean) {
    if (availabilityWorking || availability === null) return;
    setAvailabilityWorking(true);
    setAvailabilityError("");
    setAvailabilityNotice("");
    try {
      const saved = await apiRequest<DriverAvailability>("/drivers/me/availability/", {
        method: "PATCH",
        body: JSON.stringify({ available }),
      });
      setAvailability(saved);
      setAvailabilityNotice(
        saved.available
          ? "You are now accepting eligible delivery offers."
          : "You are no longer accepting new delivery offers.",
      );
    } catch (reason) {
      setAvailabilityError(
        reason instanceof Error
          ? reason.message
          : "Availability could not be updated. Please try again.",
      );
    } finally {
      setAvailabilityWorking(false);
    }
  }

  async function loadQueue(nextPage = 1) {
    const query = new URLSearchParams({ page: String(nextPage), page_size: "20" });
    if (queueStatus) query.set("status", queueStatus);
    if (queueSearch.trim()) query.set("search", queueSearch.trim());
    const result = await apiRequest<PageResult>(`/admin/driver-applications/?${query}`);
    setQueue(result);
    setPage(nextPage);
    setSelected(null);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    try {
      let current: User;
      if (marketplaceIntegrated) {
        await signInWithMarketplace(
          String(data.get("email") ?? "").trim(),
          String(data.get("password") ?? ""),
        );
        current = await apiRequest<User>("/auth/me/");
        if (current.role !== "driver") {
          throw new Error("This Marketplace account is not authorized for the DriverApp.");
        }
      } else {
        current = await apiRequest<User>("/auth/login/", {
          method: "POST",
          body: JSON.stringify({
            username: data.get("username"),
            password: data.get("password"),
          }),
        });
      }
      if (current.role === "driver" || isReviewer(current.role)) {
        setApplicationLoading(true);
      }
      setUser(current);
      setNotice("Signed in securely.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setWorking(false);
    }
  }

  async function handleRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<{
        detail: string;
        development_reset?: { uid: string; token: string };
      }>("/auth/password-reset/", {
        method: "POST",
        body: JSON.stringify({ email: data.get("email") }),
      });
      setNotice(result.detail);
      setResetPayload(result.development_reset ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recovery request failed.");
    } finally {
      setWorking(false);
    }
  }

  async function handleResetConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetPayload) return;
    setWorking(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest("/auth/password-reset/confirm/", {
        method: "POST",
        body: JSON.stringify({
          uid: resetPayload.uid,
          token: resetPayload.token,
          new_password: data.get("new_password"),
        }),
      });
      setNotice("Password updated. Sign in with your new password.");
      setResetPayload(null);
      setMode("login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Password reset failed.");
    } finally {
      setWorking(false);
    }
  }

  async function handleLogout() {
    setWorking(true);
    setError("");
    try {
      await apiRequest("/auth/logout/", { method: "POST", body: "{}" });
      setUser(null);
      setApplication(null);
      setQueue(null);
      setSelected(null);
      setNotice("You have signed out.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-out failed.");
    } finally {
      setWorking(false);
    }
  }

  async function saveApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, FormDataEntryValue> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string" && value !== "") payload[key] = value;
    }
    try {
      const updated = await apiRequest<Application>("/drivers/me/application/", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setApplication(updated);
      setLicenseDaysRemaining(daysUntil(updated.license_expiry));
      setNotice("Application details saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Application could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData(event.currentTarget);
      await apiRequest<DocumentRecord>("/drivers/me/application/documents/", {
        method: "POST",
        body: form,
      });
      const updated = await apiRequest<Application>("/drivers/me/application/");
      setApplication(updated);
      event.currentTarget.reset();
      setNotice("Document uploaded to private storage.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Document upload failed.");
    } finally {
      setWorking(false);
    }
  }

  async function submitApplication() {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const updated = await apiRequest<Application>("/drivers/me/application/submit/", {
        method: "POST",
        body: "{}",
      });
      setApplication(updated);
      setNotice("Application submitted for review.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Application could not be submitted.");
    } finally {
      setWorking(false);
    }
  }

  async function openApplication(item: Application) {
    setError("");
    try {
      const detail = await apiRequest<Application>(
        `/admin/driver-applications/${item.id}/`,
      );
      setSelected(detail);
      setReviewStatus(
        detail.status === "submitted" ? "under_review" : "additional_info_required",
      );
      setReviewReason("");
      setVerifyReason("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load application details.");
    }
  }

  async function reviewApplication() {
    if (!selected) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const updated = await apiRequest<Application>(
        `/admin/driver-applications/${selected.id}/review/`,
        {
          method: "POST",
          body: JSON.stringify({ status: reviewStatus, reason: reviewReason }),
        },
      );
      setSelected(updated);
      setNotice(`Application marked ${statusLabel(updated.status).toLowerCase()}.`);
      setConfirmReview(false);
      await loadQueue(page);
      setSelected(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review decision failed.");
    } finally {
      setWorking(false);
    }
  }

  async function verifyDocument(documentId: number, verificationStatus: "verified" | "rejected") {
    if (!selected) return;
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<DocumentRecord>(
        `/admin/driver-documents/${documentId}/verify/`,
        {
          method: "POST",
          body: JSON.stringify({
            verification_status: verificationStatus,
            reason: verifyReason,
          }),
        },
      );
      const updated = {
        ...selected,
        documents: selected.documents.map((document) =>
          document.id === result.id ? result : document,
        ),
      };
      setSelected(updated);
      setNotice(`Document ${verificationStatus}.`);
      setPendingDocumentDecision(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Document review failed.");
    } finally {
      setWorking(false);
    }
  }

  if (booting) {
    return <main className="auth-loading" aria-live="polite">Connecting to GreenPath logistics…</main>;
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-brand-panel">
          <a className="brand" href="#sign-in" aria-label="GreenPath logistics">
            <span className="brand-mark">GP</span>
            <span className="brand-copy"><strong>greenpath</strong><span>LOGISTICS</span></span>
          </a>
          <div className="auth-brand-copy">
            <p className="eyebrow">AGRICULTURAL LOGISTICS</p>
            <h1>Every delivery starts with trust.</h1>
            <p>Secure access for the people moving agricultural goods from farm to market.</p>
          </div>
          <span className="auth-edition">INDEPENDENT DEVELOPMENT WORKSPACE · 02</span>
        </section>
        <section className="auth-form-panel" id="sign-in">
          <div className="auth-form-wrap">
            <p className="eyebrow">{mode === "register" ? "DRIVER ONBOARDING" : mode === "recover" ? "ACCOUNT RECOVERY" : "SECURE WORKSPACE"}</p>
            <h2>{mode === "register" ? "Apply as a driver" : mode === "recover" ? "Reset your password" : "Welcome back"}</h2>
            <p className="auth-subtitle">
              {mode === "register" ? "Your Marketplace account and driver application are managed in one place." : mode === "recover" ? "We’ll send recovery instructions when an active account matches." : "Sign in with your GreenPath logistics account."}
            </p>

            {mode === "login" && (
              <form className="auth-form" onSubmit={handleLogin}>
                <label className="form-field">{marketplaceIntegrated ? "Marketplace email" : "Username or email"}<input name={marketplaceIntegrated ? "email" : "username"} type={marketplaceIntegrated ? "email" : "text"} autoComplete="username" required /></label>
                <PasswordField label="Password" name="password" autoComplete="current-password" />
                <button className="button button-primary" type="submit" disabled={working}>{working ? "Signing in…" : "Sign in"}</button>
              </form>
            )}

            {mode === "register" && (
              <div className="auth-form">
                <p className="field-hint">Driver identity and approval are managed by GreenPath Marketplace. Continue there to create one canonical account and submit your driver application.</p>
                {marketplaceRegisterUrl ? (
                  <a className="button button-primary" href={marketplaceRegisterUrl}>Continue to Marketplace registration</a>
                ) : (
                  <p className="feedback feedback-warning" role="status">Marketplace registration is not configured. Set NEXT_PUBLIC_MARKETPLACE_REGISTER_URL to the Marketplace /register URL and restart or rebuild DriverApp.</p>
                )}
              </div>
            )}

            {mode === "recover" && !resetPayload && (
              <form className="auth-form" onSubmit={handleRecovery}>
                <label className="form-field">Account email<input name="email" type="email" autoComplete="email" required /></label>
                <button className="button button-primary" type="submit" disabled={working}>{working ? "Requesting…" : "Send recovery instructions"}</button>
              </form>
            )}

            {mode === "recover" && resetPayload && (
              <form className="auth-form" onSubmit={handleResetConfirm}>
                <p className="development-token">Development reset token ready. It is not stored in the browser.</p>
                <PasswordField label="New password" name="new_password" autoComplete="new-password" minLength={12} />
                <button className="button button-primary" type="submit" disabled={working}>{working ? "Updating…" : "Set new password"}</button>
              </form>
            )}

            {error && <p className="feedback feedback-error" role="alert">{error}</p>}
            {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

            <div className="auth-links">
              {mode !== "login" && <button type="button" className="text-button" onClick={() => { setMode("login"); setError(""); setNotice(""); setResetPayload(null); }}>Back to sign in</button>}
              {mode === "login" && <><button type="button" className="text-button" onClick={() => { setMode("recover"); setError(""); setNotice(""); }}>Forgot password?</button><button type="button" className="text-button" onClick={() => { setMode("register"); setError(""); setNotice(""); }}>Apply as a driver <span aria-hidden="true">→</span></button></>}
            </div>
          </div>
        </section>
      </main>
    );
  }

  const reviewer = !marketplaceIntegrated && isReviewer(user.role);
  const driver = user.role === "driver";
  const shipmentBuyer =
    user.role === "wholesaler" || user.role === "retailer";
  const editable = application && ["draft", "additional_info_required"].includes(application.status);
  const activeCount = queue?.count ?? 0;
  const availableDecisions = selected ? reviewTransitions[selected.status] ?? [] : [];

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
  const initials = (displayName || user.username).slice(0, 2).toUpperCase();
  const driverSectionTitles: Record<string, string> = {
    overview: "Driver dashboard",
    "available-offers": "Delivery offers",
    "assigned-deliveries": "My shipments",
    messages: "Messages",
    "financial-summary": "Wallet",
    "bank-accounts": "Bank accounts",
    "driver-application": "Profile",
    settings: "Settings",
  };
  const pageTitle = reviewer
    ? "Driver applications"
    : driver
      ? driverSectionTitles[activeNav] ?? "Driver dashboard"
      : shipmentBuyer
        ? "Delivery coordination"
        : "Account workspace";
  const availabilityOn = Boolean(availability?.available && availability?.eligible);

  return (
    <div className={`app-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className={`sidebar-backdrop${mobileNavOpen ? " open" : ""}`}
        aria-label="Close navigation"
        onClick={() => setMobileNavOpen(false)}
      />
      <aside
        id="dashboard-sidebar"
        className={`sidebar${mobileNavOpen ? " sidebar-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-head">
          <a
            className="brand"
            href="#overview"
            aria-label="GreenPath logistics home"
            onClick={() => setMobileNavOpen(false)}
          >
            <span className="brand-mark">GP</span>
            <span className="brand-copy"><strong>greenpath</strong><span>LOGISTICS</span></span>
          </a>
          <button
            className="sidebar-collapse"
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
          </button>
          <button
            className="sidebar-close"
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <a className={`nav-link${activeNav === "overview" ? " nav-link-active" : ""}`} href="#overview" aria-current={activeNav === "overview" ? "page" : undefined}><LayoutDashboard className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Dashboard</span></a>
          {driver && <>
            <p className="nav-group-label">DRIVER</p>
            <a className={`nav-link${activeNav === "available-offers" ? " nav-link-active" : ""}`} href="#available-offers" title="Delivery offers" aria-current={activeNav === "available-offers" ? "page" : undefined}><PackageSearch className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Delivery requests</span></a>
            <a className={`nav-link${activeNav === "assigned-deliveries" ? " nav-link-active" : ""}`} href="#assigned-deliveries" title="My shipments" aria-current={activeNav === "assigned-deliveries" ? "page" : undefined}><Truck className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">My shipments</span></a>
            <a className={`nav-link${activeNav === "messages" ? " nav-link-active" : ""}`} href="#messages" aria-current={activeNav === "messages" ? "page" : undefined}><MessageSquareText className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Messages</span>{unreadMessages > 0 && <span className="nav-badge">{unreadMessages}</span>}</a>
            <a className={`nav-link${activeNav === "financial-summary" ? " nav-link-active" : ""}`} href="#financial-summary" aria-current={activeNav === "financial-summary" ? "page" : undefined}><WalletCards className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Wallet</span></a>
            <a className={`nav-link${activeNav === "bank-accounts" ? " nav-link-active" : ""}`} href="#bank-accounts" aria-current={activeNav === "bank-accounts" ? "page" : undefined}><Landmark className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Bank accounts</span></a>
            <button
              className="nav-link"
              type="button"
              onClick={() => window.dispatchEvent(new Event("greenpath:open-chatbot"))}
            >
              <MessageCircle className="nav-icon" size={17} aria-hidden="true" />
              <span className="nav-label">Chatbot</span>
            </button>
            <p className="nav-group-label">ACCOUNT</p>
            <a className={`nav-link${activeNav === "driver-application" ? " nav-link-active" : ""}`} href="#driver-application" title="Profile" aria-current={activeNav === "driver-application" ? "page" : undefined}><UserRound className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Profile</span></a>
            <a className={`nav-link${activeNav === "settings" ? " nav-link-active" : ""}`} href="#settings" title="Settings" aria-current={activeNav === "settings" ? "page" : undefined}><Settings className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Settings</span></a>
          </>}
          {shipmentBuyer && <>
            <p className="nav-group-label">SHIPMENTS</p>
            <a className={`nav-link${activeNav === "shipments" ? " nav-link-active" : ""}`} href="#shipments" aria-current={activeNav === "shipments" ? "page" : undefined} title="Delivery requests"><Truck className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Shipments</span></a>
            <a className={`nav-link${activeNav === "shipment-notifications" ? " nav-link-active" : ""}`} href="#shipment-notifications" aria-current={activeNav === "shipment-notifications" ? "page" : undefined} title="Shipment notifications"><Bell className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Activity</span></a>
          </>}
          {reviewer && <a className={`nav-link${activeNav === "review-queue" ? " nav-link-active" : ""}`} href="#review-queue" aria-current={activeNav === "review-queue" ? "page" : undefined} title="Driver review queue"><ShieldCheck className="nav-icon" size={17} aria-hidden="true" /><span className="nav-label">Driver review</span></a>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <span className="avatar">{initials}</span>
            <span>
              <strong>{displayName}</strong>
              <small>{roleLabels[user.role] ?? "Account"}</small>
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="nav-toggle"
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              aria-controls="dashboard-sidebar"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <h1 className="topbar-title">{pageTitle}</h1>
          </div>
          <div className="topbar-actions">
            {(driver || shipmentBuyer) && <a className="header-icon-link" href="#messages" aria-label="Messages" title="Messages"><MessageSquareText size={18} aria-hidden="true" /></a>}
            <a className="header-icon-link" href={shipmentBuyer ? "#shipment-notifications" : "#messages"} aria-label="Notifications" title="Notifications"><Bell size={18} aria-hidden="true" /></a>
            <div className="user-menu">
              {userMenuOpen && (
                <div className="menu-scrim" onClick={() => setUserMenuOpen(false)} aria-hidden="true" />
              )}
              <button
                className="user-menu-trigger"
                type="button"
                onClick={() => setUserMenuOpen((value) => !value)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                aria-label="Account menu"
              >
                <span className="avatar">{initials}</span>
                <span className="user-identity">
                  <span><strong>{displayName}</strong><small>{roleLabels[user.role] ?? "Account"}</small></span>
                </span>
              </button>
              {userMenuOpen && (
                <div className="user-menu-panel" role="menu">
                  <div className="user-menu-head">
                    <strong>{displayName}</strong>
                    <small>{user.email || user.username}</small>
                  </div>
                  <a className="user-menu-item" role="menuitem" href="#driver-application" onClick={() => setUserMenuOpen(false)}><UserRound size={15} aria-hidden="true" /> Profile</a>
                  <a className="user-menu-item" role="menuitem" href="#settings" onClick={() => setUserMenuOpen(false)}><Settings size={15} aria-hidden="true" /> Settings</a>
                  <button className="user-menu-item danger" role="menuitem" type="button" onClick={() => { setUserMenuOpen(false); void handleLogout(); }} disabled={working}><LogOut size={15} aria-hidden="true" /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <p className="eyebrow">{reviewer ? "VERIFICATION DESK" : driver ? "DRIVER WORKSPACE" : shipmentBuyer ? "SHIPMENT OPERATIONS" : "GREENPATH LOGISTICS"}</p>
            <p className="page-subtitle">{reviewer ? "Review submitted records only within your authorized geographic scope." : driver ? "Manage your availability, deliveries, messages, profile, and Marketplace earnings from one workspace." : shipmentBuyer ? "Manage delivery requests, fee agreements, and active shipments." : "Your account is signed in. Workspaces are limited to the permissions assigned to your role."}</p>
          </div>
          {driver && application && <StatusBadge status={application.status} />}
        </section>

        {error && <p className="feedback feedback-error page-feedback" role="alert">{error}</p>}
        {notice && <p className="feedback feedback-success page-feedback" role="status">{notice}</p>}

        {driver && (
          <>
          <section className="dashboard-section" aria-labelledby="dashboard-heading">
            <div className="dashboard-hero">
              <div className="dashboard-hero-head">
                <div>
                  <p className="eyebrow">DRIVER OVERVIEW</p>
                  <h2 id="dashboard-heading">Welcome back, {displayName.split(" ")[0]}</h2>
                  <p>Availability controls new delivery offers only. Existing assigned shipments stay available to you.</p>
                </div>
              </div>
              <div className="stat-grid">
                <article className="stat-card">
                  <span className="stat-card-label">Application status</span>
                  <span className="stat-card-value">{application ? statusLabel(application.status) : "Not loaded"}</span>
                  <span className="stat-card-note">Controlled by Marketplace review</span>
                </article>
                <article className="stat-card">
                  <span className="stat-card-label">Availability</span>
                  <span className="stat-card-value">{availability?.eligible ? (availabilityOn ? "Active" : "Inactive") : "Unavailable"}</span>
                  <span className="stat-card-note">New delivery offers only</span>
                </article>
                <article className="stat-card">
                  <span className="stat-card-label">Unread messages</span>
                  <span className="stat-card-value">{unreadMessages}</span>
                  <span className="stat-card-note"><a className="text-button" href="#messages">Open messages</a></span>
                </article>
                <article className="stat-card">
                  <span className="stat-card-label">Driving license</span>
                  <span className="stat-card-value">{licenseDaysRemaining === null ? "—" : licenseDaysRemaining < 0 ? "Expired" : `${licenseDaysRemaining} days`}</span>
                  <span className="stat-card-note">Keep credentials current</span>
                </article>
              </div>
            </div>

            <section className="availability-card" aria-labelledby="availability-heading">
              <div className="availability-copy">
                <p className="eyebrow">DELIVERY AVAILABILITY</p>
                <h2 id="availability-heading">{availability?.eligible ? (availabilityOn ? "Accepting delivery offers" : "Not accepting offers") : "Availability unavailable"}</h2>
                <p>Availability does not change Marketplace approval, end your session, or start location sharing.</p>
                {availability === null && <p className="feedback feedback-warning availability-error" role="status">Availability status could not be loaded. Refresh to try again.</p>}
                {availabilityError && <p className="feedback feedback-error availability-error" role="alert">{availabilityError}</p>}
                {availabilityNotice && <p className="feedback feedback-success availability-error" role="status">{availabilityNotice}</p>}
              </div>
              {availability?.eligible ? (
                <div className="availability-control">
                  <span className={`availability-status${availabilityOn ? " is-on" : ""}`}>
                    {availabilityWorking ? "SAVING" : availabilityOn ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <button
                    className={`switch${availabilityOn ? " switch-on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={availabilityOn}
                    aria-label="Available for new delivery offers"
                    aria-busy={availabilityWorking}
                    disabled={availabilityWorking || availability === null}
                    onClick={() => void updateAvailability(!availabilityOn)}
                  >
                    <span className="switch-thumb" aria-hidden="true" />
                  </button>
                  {availabilityWorking && <span className="availability-busy">Saving…</span>}
                </div>
              ) : (
                <span className="field-hint">Approval and authorization are required before accepting new work.</span>
              )}
            </section>
          </section>

          <section className="driver-workspace" id="driver-application" aria-busy={applicationLoading}>
            <DriverProfile
              user={user}
              application={application}
              availability={availability}
              onProfileSaved={(fullName) => {
                const [firstName, ...rest] = fullName.trim().split(" ");
                setUser((current) =>
                  current
                    ? {
                        ...current,
                        first_name: firstName ?? current.first_name,
                        last_name: rest.join(" "),
                      }
                    : current,
                );
              }}
            />
            {applicationLoading && <div className="work-panel loading-panel">Loading your application…</div>}
            {!applicationLoading && application && (
              <>
                <div className="driver-summary">
                  <div><span className="eyebrow">APPLICATION #{application.id}</span><strong>{statusLabel(application.status)}</strong><p>{application.review_reason || (application.status === "draft" ? "Complete every required section before submitting." : "The application state is controlled by authorized reviewers.")}</p></div>
                  <div className="summary-meta"><span>SUBMITTED</span><strong>{application.submitted_at ? new Date(application.submitted_at).toLocaleDateString() : "Not submitted"}</strong></div>
                </div>
                {licenseDaysRemaining !== null && licenseDaysRemaining <= 30 && (
                  <p className={`feedback ${licenseDaysRemaining < 0 ? "feedback-error" : "feedback-warning"}`} role="status">
                    {licenseDaysRemaining < 0 ? "Your driving license has expired." : `Your driving license expires in ${licenseDaysRemaining} day${licenseDaysRemaining === 1 ? "" : "s"}.`}
                    {editable ? " Update the expiry date and upload a current license document." : " Contact a reviewer about updating this credential."}
                  </p>
                )}
                <ol className="application-progress" aria-label="Application progress">
                  {["Draft", "Submitted", "Under review", "Decision"].map((step, index) => {
                    const currentIndex = application.status === "draft" ? 0
                      : application.status === "submitted" ? 1
                        : application.status === "under_review" || application.status === "additional_info_required" ? 2
                          : 3;
                    return <li key={step} className={index < currentIndex ? "step-complete" : index === currentIndex ? "step-current" : ""} aria-current={index === currentIndex ? "step" : undefined}><span>{index + 1}</span><small>{step}</small></li>;
                  })}
                </ol>

                <form className="work-panel application-form" onSubmit={saveApplication}>
                  <div className="section-heading"><div><p className="eyebrow">DRIVER PROFILE</p><h2>Identity and vehicle</h2></div><span className="field-hint">{editable ? "Draft changes are saved to your application" : "Submitted details are locked for review"}</span></div>
                  <fieldset disabled={!editable || working}>
                    <section className="application-section" aria-labelledby="identity-fields-heading"><h3 id="identity-fields-heading">Identity and contact</h3><div className="form-grid">
                      <label className="form-field">Legal full name<input name="legal_full_name" defaultValue={application.legal_full_name} required maxLength={200} /></label>
                      <label className="form-field">Phone number<input name="phone_number" type="tel" defaultValue={application.profile.phone_number} required maxLength={32} /></label>
                      <label className="form-field">Identity document type<input name="identity_document_type" defaultValue={application.identity_document_type} maxLength={50} /></label>
                      <label className="form-field">Identity reference<input name="identity_reference" defaultValue={application.identity_reference} maxLength={100} /></label>
                    </div></section>
                    <section className="application-section" aria-labelledby="vehicle-fields-heading"><h3 id="vehicle-fields-heading">License and vehicle</h3><div className="form-grid">
                      <label className="form-field">Driving license number<input name="license_number" defaultValue={application.license_number} required maxLength={100} /></label>
                      <label className="form-field">License expiry<input name="license_expiry" type="date" defaultValue={application.license_expiry ?? ""} required /></label>
                      <label className="form-field">Vehicle type<input name="vehicle_type" defaultValue={application.vehicle_type} required maxLength={80} /></label>
                      <label className="form-field">Vehicle registration<input name="vehicle_registration" defaultValue={application.vehicle_registration} required maxLength={80} /></label>
                      <label className="form-field">Cargo capacity (kg)<input name="cargo_capacity_kg" type="number" min="0.01" step="0.01" defaultValue={application.cargo_capacity_kg ?? ""} required /></label>
                    </div></section>
                    <section className="application-section" aria-labelledby="service-fields-heading"><h3 id="service-fields-heading">Service coverage and preferences</h3><div className="form-grid">
                      <label className="form-field">Preferred language<select name="preferred_language" defaultValue={application.profile.preferred_language}><option value="en">English</option><option value="am">Amharic</option><option value="om">Afaan Oromo</option></select></label>
                      <label className="form-field">Service region<input name="service_region" defaultValue={application.service_region} maxLength={100} /></label>
                      <label className="form-field">Service zone<input name="service_zone" defaultValue={application.service_zone} maxLength={100} /></label>
                      <label className="form-field">Service wereda<input name="service_wereda" defaultValue={application.service_wereda} maxLength={100} /></label>
                    </div></section>
                  </fieldset>
                  {editable && <div className="form-actions"><button className="button button-secondary" type="submit" disabled={working}>{working ? "Saving…" : "Save application"}</button></div>}
                </form>

                <div className="lower-grid driver-lower-grid">
                  <section className="work-panel">
                    <div className="section-heading"><div><p className="eyebrow">PRIVATE EVIDENCE</p><h2>Required documents</h2></div><span className="empty-count">{application.documents.length} uploaded</span></div>
                    <p className="panel-description">PDF, PNG, or JPEG; maximum 10 MB. Files are stored privately and are never served inline.</p>
                    <ul className="document-list">
                      {application.documents.map((document) => <li key={document.id}><div><strong>{statusLabel(document.document_type)}</strong><small>Uploaded {new Date(document.uploaded_at).toLocaleDateString()}{document.expires_at ? ` · Expires ${document.expires_at}` : ""}{document.verified_by ? ` · Reviewed by ${document.verified_by}` : ""}</small></div><span className={`document-state document-${document.verification_status}`}>{statusLabel(document.verification_status)}</span><a className="icon-link" href={`${apiBaseUrl()}/driver-documents/${document.id}/download/`} target="_blank" rel="noreferrer" aria-label={`Download ${document.document_type} document`}>↓</a></li>)}
                      {application.documents.length === 0 && <li className="document-empty">No documents uploaded yet.</li>}
                    </ul>
                    {editable && <form className="upload-form" onSubmit={uploadDocument}>
                      <label className="form-field">Document type<select name="document_type" defaultValue="identity"><option value="identity">Identity document</option><option value="driving_license">Driving license</option><option value="vehicle_registration">Vehicle registration</option></select></label>
                      <label className="form-field">Expiration date <span className="field-hint">optional</span><input name="expires_at" type="date" /></label>
                      <label className="form-field file-field">Choose file<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required /></label>
                      <button className="button button-secondary" type="submit" disabled={working}>{working ? "Uploading…" : "Upload document"}</button>
                    </form>}
                  </section>

                  <section className="work-panel review-history-panel">
                    <div className="section-heading"><div><p className="eyebrow">REVIEW TRAIL</p><h2>Application history</h2></div></div>
                    <ul className="history-list">
                      {(application.review_history ?? []).map((item, index) => <li key={`${item.created_at}-${index}`}><span className="history-dot" /><div><strong>{statusLabel(item.to_status)}</strong><small>{item.reason}</small><small>{item.reviewer ? `Reviewed by ${item.reviewer}` : "Submitted by you"} · {new Date(item.created_at).toLocaleString()}</small></div></li>)}
                      {!application.review_history?.length && <li className="document-empty">No review activity yet.</li>}
                    </ul>
                    {editable && <div className="submit-callout"><p>When your profile and required documents are ready, submit them for review. Submitted identity and vehicle details are locked until reviewers request changes.</p><button className="button button-primary" type="button" onClick={submitApplication} disabled={working}>{working ? "Submitting…" : "Submit for review"}</button></div>}
                  </section>
                </div>
              </>
            )}
          </section>
          </>
        )}

        {reviewer && (
          <section className="review-layout" id="review-queue" aria-busy={applicationLoading}>
            <section className="work-panel queue-panel">
              <div className="section-heading"><div><p className="eyebrow">AUTHORIZED SCOPE</p><h2>Application queue</h2></div><span className="empty-count">{activeCount} records</span></div>
              <form className="queue-filters" onSubmit={(event) => { event.preventDefault(); loadQueue(1).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not filter applications.")); }}>
                <label className="sr-only" htmlFor="application-search">Search applications</label><input id="application-search" value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Search driver or email" />
                <label className="sr-only" htmlFor="application-status">Filter by status</label><select id="application-status" value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)}><option value="">All statuses</option>{["submitted", "under_review", "additional_info_required", "approved", "rejected", "suspended", "expired"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
                <button className="button button-secondary" type="submit" disabled={working}>Filter</button>
              </form>
              {applicationLoading && <div className="queue-message">Loading applications…</div>}
              {!applicationLoading && queue?.results.length === 0 && <div className="queue-message">No applications match this view.</div>}
              {!applicationLoading && !!queue?.results.length && <div className="queue-table-wrap"><table className="queue-table"><thead><tr><th>Driver</th><th>Submitted</th><th>Status</th><th><span className="sr-only">Open application</span></th></tr></thead><tbody>{queue.results.map((item) => <tr key={item.id} className={selected?.id === item.id ? "queue-row-selected" : ""}><td><strong>{item.legal_full_name}</strong><small>{item.email}</small></td><td>{item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : "Draft"}</td><td><span className={`status-pill status-${item.status}`}>{statusLabel(item.status)}</span></td><td><button className="text-button" type="button" onClick={() => openApplication(item)}>Review <span aria-hidden="true">→</span></button></td></tr>)}</tbody></table></div>}
              {queue && queue.count > 20 && <div className="pagination-row"><span>Page {page} · {queue.count} applications</span><div><button className="button button-small" type="button" disabled={!queue.previous || working} onClick={() => loadQueue(page - 1)}>Previous</button><button className="button button-small" type="button" disabled={!queue.next || working} onClick={() => loadQueue(page + 1)}>Next</button></div></div>}
            </section>

            {selected ? <section className="work-panel detail-panel">
              <div className="section-heading"><div><p className="eyebrow">APPLICATION #{selected.id}</p><h2>{selected.legal_full_name}</h2></div><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span></div>
              <p className="driver-contact">{selected.username} · {selected.email} · {selected.profile.phone_number}</p>
              <dl className="detail-grid"><div><dt>Identity reference</dt><dd>{selected.identity_document_type || "Not provided"} · {selected.identity_reference || "Not provided"}</dd></div><div><dt>License</dt><dd>{selected.license_number || "Not provided"} · Expires {selected.license_expiry || "Not provided"}</dd></div><div><dt>Vehicle</dt><dd>{selected.vehicle_type || "Not provided"} · {selected.vehicle_registration || "Not provided"}</dd></div><div><dt>Capacity</dt><dd>{selected.cargo_capacity_kg ? `${selected.cargo_capacity_kg} kg` : "Not provided"}</dd></div><div><dt>Service area</dt><dd>{[selected.service_region, selected.service_zone, selected.service_wereda].filter(Boolean).join(" · ") || "Not provided"}</dd></div><div><dt>Submitted</dt><dd>{selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : "Not submitted"}</dd></div></dl>

              <div className="detail-section"><p className="eyebrow">DOCUMENTS</p>{selected.documents.map((document) => <div className="review-document" key={document.id}><div><strong>{statusLabel(document.document_type)}</strong><span className={`document-state document-${document.verification_status}`}>{statusLabel(document.verification_status)}</span>{document.verified_by && <small>by {document.verified_by} · {document.verified_at ? new Date(document.verified_at).toLocaleString() : ""} · {document.verification_reason}</small>}</div><a className="button button-small" href={`${apiBaseUrl()}/driver-documents/${document.id}/download/`} target="_blank" rel="noreferrer">Open private file</a>{document.verification_status === "pending" && <div className="document-review-actions"><input aria-label={`Reason for ${document.document_type} decision`} placeholder="Reason required" value={verifyReason} onChange={(event) => setVerifyReason(event.target.value)} /><button className="button button-small" type="button" disabled={working || !verifyReason.trim()} onClick={() => setPendingDocumentDecision({ documentId: document.id, verificationStatus: "verified" })}>Verify</button><button className="button button-small button-warning" type="button" disabled={working || !verifyReason.trim()} onClick={() => setPendingDocumentDecision({ documentId: document.id, verificationStatus: "rejected" })}>Reject</button></div>}</div>)}{selected.documents.length === 0 && <p className="panel-description">No documents submitted.</p>}</div>

              <section className="decision-form"><p className="eyebrow">ADMINISTRATIVE DECISION</p>{availableDecisions.length ? <form className="decision-controls" onSubmit={(event) => { event.preventDefault(); if (reviewReason.trim()) setConfirmReview(true); }}><label className="form-field">New status<select value={availableDecisions.includes(reviewStatus) ? reviewStatus : availableDecisions[0]} onChange={(event) => setReviewStatus(event.target.value)}>{availableDecisions.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label><label className="form-field">Decision reason<textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} maxLength={2000} required rows={3} /></label><button className="button button-primary" type="submit" disabled={working || !reviewReason.trim()}>Review decision</button></form> : <p className="panel-description">No further administrative transitions are available from this state.</p>}</section>

              <div className="detail-section"><p className="eyebrow">REVIEW HISTORY</p><ul className="history-list">{(selected.review_history ?? []).map((item, index) => <li key={`${item.created_at}-${index}`}><span className="history-dot" /><div><strong>{statusLabel(item.to_status)}</strong><small>{item.reason}</small><small>{item.reviewer ?? "Driver"} · {new Date(item.created_at).toLocaleString()}</small></div></li>)}{!selected.review_history?.length && <li className="document-empty">No review history.</li>}</ul></div>
            </section> : <section className="work-panel detail-placeholder"><span className="empty-mark" aria-hidden="true">☷</span><h2>Select an application</h2><p>Application identity and private documents will appear here only within your authorized scope.</p></section>}
          </section>
        )}

        {(driver || shipmentBuyer) && <PhaseThree role={user.role} />}

        {driver && <>
          <DriverMessages />
          <DriverWallet />
          <DriverBankAccounts />
          <DriverSettings
            user={user}
            phone={application?.profile.phone_number}
            preferredLanguage={application?.profile.preferred_language}
            onSignOut={() => void handleLogout()}
            signingOut={working}
          />
          <DriverChatbot />
        </>}

        {!driver && !reviewer && !shipmentBuyer && <section className="work-panel role-limited-panel"><p className="eyebrow">{roleLabels[user.role] ?? "LOGISTICS ACCOUNT"}</p><h2>No workspace is assigned to this role yet.</h2><p>Authentication is active. Shipment and financial access are restricted to their authorized participants and configured integrations.</p></section>}

        <footer className="page-footer"><span>GREENPATH LOGISTICS</span><span>DELIVERY OPERATIONS <b>·</b> 0.3.0</span></footer>
      </main>
      <ConfirmationDialog
        open={confirmReview}
        title={`${statusLabel(reviewStatus)} application?`}
        description={`This decision will be recorded in the review history with your reason: “${reviewReason.trim()}”`}
        confirmLabel={`Confirm ${statusLabel(reviewStatus).toLowerCase()}`}
        destructive={reviewStatus === "rejected" || reviewStatus === "suspended"}
        busy={working}
        onCancel={() => setConfirmReview(false)}
        onConfirm={() => void reviewApplication()}
      />
      <ConfirmationDialog
        open={pendingDocumentDecision !== null}
        title={`${pendingDocumentDecision?.verificationStatus === "rejected" ? "Reject" : "Verify"} document?`}
        description={`This decision will be recorded with the required review reason: “${verifyReason.trim()}”`}
        confirmLabel={pendingDocumentDecision?.verificationStatus === "rejected" ? "Confirm rejection" : "Confirm verification"}
        destructive={pendingDocumentDecision?.verificationStatus === "rejected"}
        busy={working}
        onCancel={() => setPendingDocumentDecision(null)}
        onConfirm={() => {
          if (pendingDocumentDecision) {
            void verifyDocument(pendingDocumentDecision.documentId, pendingDocumentDecision.verificationStatus);
          }
        }}
      />
    </div>
  );
}
