"use client";

/**
 * Dashboard Design System
 * -----------------------
 * Shared primitives that encode the dashboard's visual language so every
 * page renders with the same look (background, hero, eyebrows, footer pill).
 *
 *   <PageShell accent="violet">
 *     <PageHero icon={Settings2} badge="Admin Console" title="…" description="…" />
 *     <SectionEyebrow eyebrow="01 · Onboarding" title="…" description="…" />
 *     { ...page content... }
 *     <FooterPill label="Blanc Admin · v1" />
 *   </PageShell>
 */

import * as React from "react";
import { motion } from "framer-motion";
import { Sparkles, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// --- Animation token ------------------------------------------------------
export const EASE = [0.22, 1, 0.36, 1] as const;

// --- Accent palette -------------------------------------------------------
export type Accent =
  | "violet"
  | "rose"
  | "indigo"
  | "amber"
  | "emerald"
  | "blue";

export const accentPlate: Record<Accent, string> = {
  violet: "from-violet-500 via-purple-500 to-fuchsia-600",
  rose: "from-rose-500 via-pink-500 to-fuchsia-600",
  indigo: "from-indigo-500 via-indigo-500 to-violet-600",
  amber: "from-amber-500 via-orange-500 to-rose-500",
  emerald: "from-emerald-500 via-emerald-500 to-teal-600",
  blue: "from-sky-500 via-blue-500 to-indigo-600",
};

export const accentBadge: Record<Accent, string> = {
  violet:
    "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
  rose: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
  indigo:
    "border-indigo-500/30 bg-indigo-500/5 text-indigo-700 dark:text-indigo-300",
  amber:
    "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  emerald:
    "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  blue: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
};

// --- Background blob palettes (triplets) ----------------------------------
type BlobTriplet = { left: string; right: string; bottom: string };

const BLOB_PALETTES: Record<Accent, BlobTriplet> = {
  violet: {
    left: "bg-violet-500/8 dark:bg-violet-500/10",
    right: "bg-sky-500/8 dark:bg-sky-500/10",
    bottom: "bg-emerald-500/6 dark:bg-emerald-500/8",
  },
  rose: {
    left: "bg-rose-500/8 dark:bg-rose-500/10",
    right: "bg-indigo-500/8 dark:bg-indigo-500/10",
    bottom: "bg-amber-500/6 dark:bg-amber-500/8",
  },
  indigo: {
    left: "bg-indigo-500/8 dark:bg-indigo-500/10",
    right: "bg-sky-500/8 dark:bg-sky-500/10",
    bottom: "bg-violet-500/6 dark:bg-violet-500/8",
  },
  amber: {
    left: "bg-amber-500/8 dark:bg-amber-500/10",
    right: "bg-rose-500/8 dark:bg-rose-500/10",
    bottom: "bg-emerald-500/6 dark:bg-emerald-500/8",
  },
  emerald: {
    left: "bg-emerald-500/8 dark:bg-emerald-500/10",
    right: "bg-sky-500/8 dark:bg-sky-500/10",
    bottom: "bg-indigo-500/6 dark:bg-indigo-500/8",
  },
  blue: {
    left: "bg-sky-500/8 dark:bg-sky-500/10",
    right: "bg-indigo-500/8 dark:bg-indigo-500/10",
    bottom: "bg-violet-500/6 dark:bg-violet-500/8",
  },
};

// --- PageBackground -------------------------------------------------------
export function PageBackground({
  accent = "violet",
  grid = true,
}: {
  accent?: Accent;
  grid?: boolean;
}) {
  const p = BLOB_PALETTES[accent];
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className={cn(
            "absolute -left-40 top-0 size-[420px] rounded-full blur-3xl",
            p.left,
          )}
        />
        <div
          className={cn(
            "absolute -right-40 top-40 size-[420px] rounded-full blur-3xl",
            p.right,
          )}
        />
        <div
          className={cn(
            "absolute left-1/2 top-[60%] size-[360px] -translate-x-1/2 rounded-full blur-3xl",
            p.bottom,
          )}
        />
      </div>
      {grid && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04] dark:opacity-[0.06] bg-[radial-gradient(circle_at_1px_1px,var(--foreground)_1px,transparent_0)] bg-size-[22px_22px]"
        />
      )}
    </>
  );
}

// --- PageShell ------------------------------------------------------------
export function PageShell({
  accent = "violet",
  maxWidth = "7xl",
  className,
  children,
}: {
  accent?: Accent;
  maxWidth?: "5xl" | "6xl" | "7xl" | "full";
  className?: string;
  children: React.ReactNode;
}) {
  const maxClass = {
    "5xl": "max-w-5xl",
    "6xl": "max-w-6xl",
    "7xl": "max-w-7xl",
    full: "max-w-none",
  }[maxWidth];
  return (
    <div
      className={cn(
        "relative min-h-[calc(100vh-var(--header-height))] overflow-hidden bg-background",
        className,
      )}
    >
      <PageBackground accent={accent} />
      <div className={cn("mx-auto px-6 py-10 lg:py-14", maxClass)}>
        {children}
      </div>
    </div>
  );
}

// --- StatusPill -----------------------------------------------------------
export function StatusPill({
  label,
  tone = "emerald",
}: {
  label: string;
  tone?: "emerald" | "amber" | "rose" | "sky";
}) {
  const toneMap = {
    emerald: { ping: "bg-emerald-400", dot: "bg-emerald-500" },
    amber: { ping: "bg-amber-400", dot: "bg-amber-500" },
    rose: { ping: "bg-rose-400", dot: "bg-rose-500" },
    sky: { ping: "bg-sky-400", dot: "bg-sky-500" },
  }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.2, duration: 0.35 }}
      className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 shadow-xs backdrop-blur"
    >
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-70",
            toneMap.ping,
          )}
        />
        <span
          className={cn("relative inline-flex size-2 rounded-full", toneMap.dot)}
        />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
    </motion.div>
  );
}

// --- PageHero -------------------------------------------------------------
export function PageHero({
  icon: Icon,
  badge,
  badgeIcon: BadgeIcon,
  badgeAccent = "violet",
  title,
  description,
  rightSlot,
  className,
}: {
  icon: LucideIcon;
  badge?: string;
  badgeIcon?: LucideIcon;
  badgeAccent?: Accent;
  title: React.ReactNode;
  description?: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className={cn("mb-10", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0.85, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{
              delay: 0.05,
              type: "spring" as const,
              stiffness: 260,
              damping: 18,
            }}
            whileHover={{ rotate: -4, scale: 1.05 }}
            className="relative grid size-12 place-items-center rounded-2xl bg-linear-to-br from-slate-900 via-slate-800 to-slate-700 text-white shadow-md ring-1 ring-white/10 dark:from-slate-50 dark:via-slate-100 dark:to-slate-300 dark:text-slate-900 dark:ring-black/10"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-b from-white/20 to-transparent dark:from-white/40"
            />
            <Icon className="relative size-5" />
          </motion.div>
          <div className="min-w-0">
            {badge && (
              <Badge
                variant="outline"
                className={cn(
                  "mb-2 gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider",
                  accentBadge[badgeAccent],
                )}
              >
                {BadgeIcon ? <BadgeIcon className="size-2.5" /> : null}
                {badge}
              </Badge>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {rightSlot}
      </div>
    </motion.div>
  );
}

// --- SectionEyebrow -------------------------------------------------------
export function SectionEyebrow({
  eyebrow,
  title,
  description,
  delay = 0.08,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: EASE }}
      className={cn("mb-5", className)}
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <span className="inline-block h-px w-6 bg-foreground/30" />
        {eyebrow}
      </div>
      <h2 className="text-lg font-bold tracking-tight text-foreground">
        {title}
      </h2>
      {description && (
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {description}
        </p>
      )}
    </motion.div>
  );
}

// --- FooterPill -----------------------------------------------------------
export function FooterPill({
  label,
  icon: Icon = Sparkles,
  tone = "violet",
  className,
}: {
  label: string;
  icon?: LucideIcon;
  tone?: Accent;
  className?: string;
}) {
  const toneText = {
    violet: "text-violet-500",
    rose: "text-rose-500",
    indigo: "text-indigo-500",
    amber: "text-amber-500",
    emerald: "text-emerald-500",
    blue: "text-sky-500",
  }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.4 }}
      className={cn("mt-16 flex justify-center", className)}
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/70 px-3 py-1.5 backdrop-blur-sm">
        <Icon className={cn("size-3", toneText)} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
      </div>
    </motion.div>
  );
}
