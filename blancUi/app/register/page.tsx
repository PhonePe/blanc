"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";

import { RegisterForm } from "@/components/register-form";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  Brand wordmark                                                    */
/* ------------------------------------------------------------------ */

type WordmarkProps = {
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg" | "xl";
  tagline?: boolean;
  className?: string;
};

function BlancWordmark({
  variant = "light",
  size = "md",
  tagline = true,
  className,
}: WordmarkProps) {
  const isDark = variant === "dark";
  const wordSize = {
    sm: "text-3xl",
    md: "text-5xl",
    lg: "text-7xl",
    xl: "text-[clamp(4.5rem,9vw,8.5rem)]",
  }[size];
  const taglineSize = {
    sm: "text-[9px] tracking-[0.22em]",
    md: "text-[11px] tracking-[0.32em]",
    lg: "text-[13px] tracking-[0.34em]",
    xl: "text-[15px] tracking-[0.36em]",
  }[size];
  const dashGap = {
    sm: "mt-2",
    md: "mt-3",
    lg: "mt-4",
    xl: "mt-5",
  }[size];

  return (
    <div className={cn("flex flex-col items-center select-none", className)}>
      <h1
        className={cn(
          "font-medium leading-none",
          wordSize,
          isDark ? "text-white" : "text-[#0e2a4d] dark:text-white",
        )}
        style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
      >
        Blanc<span className="text-[#d23f3c]">.</span>
      </h1>
      {tagline && (
        <>
          <p
            className={cn(
              "mt-3 font-medium uppercase",
              taglineSize,
              isDark
                ? "text-white/90"
                : "text-[#0e2a4d]/90 dark:text-white/85",
            )}
          >
            Threat Modeling Studio
          </p>
          <div
            className={cn("flex items-center justify-center gap-2", dashGap)}
          >
            <span
              className={cn(
                "h-px w-6",
                isDark
                  ? "bg-white/80"
                  : "bg-[#0e2a4d]/80 dark:bg-white/70",
              )}
            />
            <span className="h-px w-6 bg-[#d23f3c]" />
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function RegisterPage() {
  return (
    <div className="grid min-h-svh bg-white text-[#0e2a4d] dark:bg-black dark:text-white lg:grid-cols-[1.05fr_1fr]">
      {/* --------------------------- LEFT — Form --------------------------- */}
      <div className="relative z-10 flex flex-col justify-between gap-6 bg-white p-6 dark:bg-black md:p-10">
        {/* Top brand row */}
        <div className="relative z-10 flex items-center justify-between">
          <Link
            href="/"
            className="group/brand flex items-center gap-2.5 outline-none"
            aria-label="Blanc — Threat Modeling Studio"
          >
            <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-[9px] bg-[#0e2a4d] ring-1 ring-[#0e2a4d]/30 shadow-sm transition-transform group-hover/brand:scale-[1.04] dark:bg-white/10 dark:ring-white/15">
              <Image
                src="/brand.png"
                alt="Blanc"
                width={36}
                height={36}
                priority
                className="size-full object-cover"
              />
            </span>
            <span
              className="text-xl font-medium leading-none text-[#0e2a4d] dark:text-white"
              style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
            >
              Blanc<span className="text-[#d23f3c]">.</span>
            </span>
          </Link>
        </div>

        {/* Centered form card */}
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="relative w-full max-w-sm">
            <div className="relative rounded-2xl border border-[#0e2a4d]/10 bg-white p-6 shadow-[0_30px_80px_-30px_rgba(14,42,77,0.25)] md:p-8 dark:border-white/10 dark:bg-white/3 dark:shadow-[0_30px_80px_-30px_rgba(0,0,0,0.55)]">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-8 -top-px h-px bg-linear-to-r from-transparent via-[#d23f3c]/60 to-transparent"
              />
              <RegisterForm />
            </div>

            <p className="mt-5 text-center text-xs text-[#0e2a4d]/65 dark:text-white/60">
              By creating an account you agree to the{" "}
              <Link
                href="#"
                className="font-medium text-[#0e2a4d] underline-offset-4 hover:underline dark:text-white"
              >
                Terms
              </Link>{" "}
              &amp;{" "}
              <Link
                href="#"
                className="font-medium text-[#0e2a4d] underline-offset-4 hover:underline dark:text-white"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-center text-[11px] text-[#0e2a4d]/55 dark:text-white/55">
          <span>© 2026 Blanc Threat Modeling Studio</span>
        </div>
      </div>

      {/* --------------------------- RIGHT — Brand stage --------------------------- */}
      <div className="relative hidden overflow-hidden bg-black text-white lg:flex">
        {/* Subtle dotted grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--color-foreground)_1px,transparent_0)]/5 bg-size-[22px_22px]"
        />

        {/* Animated aurora blobs */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-32 top-1/4 size-104 rounded-full bg-[#1c3963]/45 blur-[120px]"
          animate={{
            x: [0, 40, -20, 0],
            y: [0, -30, 20, 0],
            scale: [1, 1.08, 0.96, 1],
          }}
          transition={{ duration: 18, ease: "easeInOut", repeat: Infinity }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -right-24 bottom-10 size-88 rounded-full bg-[#d23f3c]/18 blur-[110px]"
          animate={{
            x: [0, -30, 25, 0],
            y: [0, 20, -25, 0],
            scale: [1, 0.94, 1.1, 1],
          }}
          transition={{ duration: 22, ease: "easeInOut", repeat: Infinity }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#3b5f93]/15 blur-[90px]"
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 8, ease: "easeInOut", repeat: Infinity }}
        />

        {/* Conic shimmer sweep */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[140%] -translate-x-1/2 -translate-y-1/2 opacity-[0.07] [background:conic-gradient(from_0deg,transparent_0deg,#d23f3c_40deg,transparent_80deg,transparent_360deg)]"
          animate={{ rotate: 360 }}
          transition={{ duration: 30, ease: "linear", repeat: Infinity }}
        />

        {/* Vignette */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/0 via-black/30 to-black/70"
        />

        {/* Floating particles */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {[
            { left: "12%", top: "22%", delay: 0, dur: 7 },
            { left: "78%", top: "18%", delay: 1.2, dur: 9 },
            { left: "34%", top: "82%", delay: 2.4, dur: 8 },
            { left: "68%", top: "68%", delay: 0.6, dur: 10 },
            { left: "22%", top: "55%", delay: 3, dur: 6.5 },
            { left: "86%", top: "42%", delay: 1.8, dur: 8.5 },
            { left: "50%", top: "12%", delay: 4, dur: 9.5 },
            { left: "42%", top: "38%", delay: 2, dur: 7.5 },
          ].map((p, i) => (
            <motion.span
              key={i}
              className="absolute size-1 rounded-full bg-white/40"
              style={{ left: p.left, top: p.top }}
              animate={{
                y: [0, -24, 0],
                opacity: [0, 0.7, 0],
              }}
              transition={{
                duration: p.dur,
                ease: "easeInOut",
                repeat: Infinity,
                delay: p.delay,
              }}
            />
          ))}
        </div>

        {/* Content stack — centered wordmark + tagline only */}
        <div className="relative z-10 flex w-full flex-col items-center justify-center px-10 py-16">
          <motion.div
            initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.9, ease: EASE }}
            className="relative"
          >
            {/* Glow halo behind wordmark */}
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-[#d23f3c]/15 blur-3xl"
              animate={{ opacity: [0.4, 0.75, 0.4], scale: [0.9, 1.05, 0.9] }}
              transition={{ duration: 6, ease: "easeInOut", repeat: Infinity }}
            />
            <BlancWordmark variant="dark" size="xl" tagline />
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.7, ease: EASE }}
            className="mx-auto mt-10 max-w-md text-balance text-center text-base leading-relaxed text-white/70"
          >
            A modern, AI-assisted workspace for{" "}
            <span className="text-white">threat modeling</span> — built for
            engineers, designed for security.
          </motion.p>

          {/* Animated underline accent */}
          <motion.span
            aria-hidden
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: 0.9, duration: 1, ease: EASE }}
            className="mt-10 block h-px w-32 origin-center bg-linear-to-r from-transparent via-[#d23f3c]/60 to-transparent"
          />
        </div>
      </div>
    </div>
  );
}
