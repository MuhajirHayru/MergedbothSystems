"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * CommandPalette — global quick navigation (Ctrl/Cmd+K).
 *
 * Items are grouped, filtered by a case-insensitive match on the label and
 * keywords, and fully keyboard driven: Up/Down to move, Enter to run,
 * Escape to close.
 */

export interface CommandItem {
  id: string;
  label: string;
  group?: string;
  href?: string;
  keywords?: string;
  onSelect?: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  placeholder = "Search pages and actions…",
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.label} ${item.group ?? ""} ${item.keywords ?? ""}`.toLowerCase().includes(needle)
    );
  }, [items, query]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
    };
  }, [open]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function run(item: CommandItem) {
    onOpenChange(false);
    if (item.onSelect) {
      item.onSelect();
    } else if (item.href) {
      router.push(item.href);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (filtered.length ? (index + 1) % filtered.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        filtered.length ? (index - 1 + filtered.length) % filtered.length : 0
      );
      return;
    }
    if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      run(filtered[activeIndex]);
    }
  }

  if (!open) return null;

  let lastGroup: string | undefined;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-slate-950/45"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-xl)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-controls="command-palette-results"
            aria-activedescendant={
              filtered[activeIndex] ? `command-item-${filtered[activeIndex].id}` : undefined
            }
            className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            Esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          aria-label="Commands"
          className="max-h-[min(60vh,26rem)] overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No matches for “{query}”.
            </li>
          ) : (
            filtered.map((item, index) => {
              const showGroup = item.group && item.group !== lastGroup;
              lastGroup = item.group;
              const active = index === activeIndex;

              return (
                <React.Fragment key={item.id}>
                  {showGroup ? (
                    <li
                      role="presentation"
                      className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {item.group}
                    </li>
                  ) : null}
                  <li
                    id={`command-item-${item.id}`}
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(item)}
                    className={cn(
                      "mx-1 flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                      active ? "bg-muted text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
