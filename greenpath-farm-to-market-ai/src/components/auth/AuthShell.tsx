import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { BrandMark } from "@/components/branding/BrandMark";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

/**
 * AuthShell — the shared frame for sign in, register and password recovery.
 *
 * The brand panel is decorative and hidden below `lg`; the form column owns the
 * narrow layout. All colours come from tokens so both themes are supported.
 */

export interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Short bullets that explain what happens after this step. */
  highlights?: string[];
  eyebrow?: string;
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  highlights,
  eyebrow = "Verified agricultural trade",
}: AuthShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-[42%] flex-col justify-between border-r border-sidebar-border bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Link href="/" aria-label="GreenPath home">
          <BrandMark
            className="gap-3"
            iconClassName="h-8 w-8 text-sidebar-foreground"
            nameClassName="text-2xl font-semibold text-sidebar-foreground"
          />
        </Link>

        <div className="max-w-md space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/60">
            {eyebrow}
          </p>
          <p className="text-2xl font-semibold leading-snug text-sidebar-foreground">
            Farm-to-marketplace trade with verified accounts, audited payments and
            delivery tracked end to end.
          </p>
          {highlights && highlights.length > 0 ? (
            <ul className="space-y-3 text-sm text-sidebar-foreground/80">
              {highlights.map((item) => (
                <li key={item} className="flex gap-3">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-primary"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <p className="text-xs text-sidebar-foreground/60">
          Accounts are reviewed by a User Admin before trading is enabled. Amounts
          are always in Ethiopian Birr (ETB).
        </p>
      </aside>

      <main className="flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 lg:px-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to home
          </Link>
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark iconClassName="h-5 w-5 text-primary" nameClassName="text-base font-semibold" />
          </div>
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-start justify-center px-5 pb-12 pt-4 sm:items-center lg:px-10">
          <div className="w-full max-w-md">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            <div className="mt-7">{children}</div>
            {footer ? <div className="mt-6 text-sm text-muted-foreground">{footer}</div> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
