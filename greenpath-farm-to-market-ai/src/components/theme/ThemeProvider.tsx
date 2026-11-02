"use client";

import * as React from "react";

/**
 * Theme provider — light / dark / system, persisted in localStorage.
 *
 * The `dark` class is applied to <html> before first paint by the inline
 * script in app/layout.tsx, so there is no flash of the wrong theme. This
 * provider keeps React state in sync afterwards.
 */

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "greenpath-theme";

interface ThemeContextValue {
  theme: ThemeChoice;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeChoice) => void;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: ThemeChoice) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  return dark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeChoice>("system");
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    const initial: ThemeChoice = stored ?? "system";
    setThemeState(initial);
    setResolvedTheme(applyTheme(initial) as "light" | "dark");
  }, []);

  React.useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setResolvedTheme(applyTheme("system") as "light" | "dark");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = React.useCallback((next: ThemeChoice) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    setResolvedTheme(applyTheme(next) as "light" | "dark");
  }, []);

  const toggleTheme = React.useCallback(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  }, [setTheme]);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
