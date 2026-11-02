import * as React from "react";

import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

/**
 * Avatar — initials with an optional profile image. Images are aligned with
 * the same URL rules as the rest of the app (absolute or `/media/...`).
 */

const AVATAR_TONES = [
  "bg-success/10 text-success",
  "bg-info/10 text-info",
  "bg-primary/10 text-primary",
  "bg-warning/10 text-warning",
  "bg-accent/15 text-accent-foreground",
  "bg-muted text-muted-foreground",
];

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

export interface AvatarProps {
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  src?: string | null;
  className?: string;
}

function mediaUrl(src: string) {
  if (src.startsWith("http")) return src;
  const base = (
    import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1"
  ).replace(/\/api\/v1\/?$/, "");
  return `${base}${src.startsWith("/") ? src : `/${src}`}`;
}

function Avatar({ name, size = "md", src, className }: AvatarProps) {
  const seed = (name ?? "").split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const tone = AVATAR_TONES[seed % AVATAR_TONES.length];

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold",
        tone,
        SIZES[size],
        className
      )}
      aria-hidden="true"
    >
      {initials(name)}
      {src ? (
        <img
          src={mediaUrl(src)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}

export { Avatar };
