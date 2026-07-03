"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  FileStack,
  Lightbulb,
  Lock,
  Shield,
} from "lucide-react";

import { AssessmentForm } from "@/components/AssessmentForm";
import { NewAssessmentChooser } from "@/components/new-assessment-chooser";
import { Separator } from "@/components/ui/separator";
import { EASE } from "@/components/dashboard-shell";

// --- Static content --------------------------------------------------------
const TIPS = [
  "Upload PNG, JPG, or PDF diagrams — or paste Mermaid code directly.",
  "Label your trust boundaries and data flows for sharper results.",
  "Attach supporting docs (specs, RFCs) to enrich the analysis.",
] as const;

// --- Subtle monochrome background -----------------------------------------
function MonoBackground() {
  return (
    <>
      {/* Dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05] dark:opacity-[0.08] bg-[radial-gradient(circle_at_1px_1px,var(--foreground)_1px,transparent_0)] bg-size-[22px_22px]"
      />
      {/* Soft top vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-linear-to-b from-foreground/[0.03] via-transparent to-transparent"
      />
    </>
  );
}

// --- Guidance rail ---------------------------------------------------------
function GuidanceRail() {
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        {/* Header band */}
        <div className="border-b border-border/60 bg-muted/40 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-foreground text-background dark:bg-white dark:text-black">
              <Lightbulb className="size-4" />
            </span>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              Before you start
            </h3>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            A few things that help the engine produce a sharper threat model.
          </p>
        </div>

        {/* Tips */}
        <ul className="space-y-3.5 p-5">
          {TIPS.map((tip, i) => (
            <motion.li
              key={tip}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.35, ease: EASE }}
              className="flex items-start gap-2.5 text-xs leading-relaxed text-foreground/85"
            >
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-background text-[9px] font-bold dark:bg-white dark:text-black">
                {i + 1}
              </span>
              <span>{tip}</span>
            </motion.li>
          ))}
        </ul>

        <Separator className="bg-border/50" />

        {/* Footer note */}
        <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
          <FileStack className="size-3.5 shrink-0 text-muted-foreground/70" />
          <span>Drafts aren&apos;t saved until you submit.</span>
        </div>
      </div>

      {/* Privacy reassurance chip */}
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background/50 px-4 py-3 text-[11px] text-muted-foreground">
        <Shield className="size-3.5 shrink-0 text-foreground/70" />
        <span>Your artifacts are processed only for this assessment.</span>
      </div>
    </aside>
  );
}

// --- Page ------------------------------------------------------------------
export default function NewAssessmentPage() {
  const router = useRouter();
  // Chooser opens on mount; picking "Upload existing" reveals the form.
  // Backdrop / ESC close → bounce back to my_assessment so we're never
  // stranded on the page with no form visible.
  const [chooserOpen, setChooserOpen] = React.useState(true);
  const [formRevealed, setFormRevealed] = React.useState(false);

  return (
    <div className="relative min-h-[calc(100vh-var(--header-height))] overflow-hidden bg-background">
      <NewAssessmentChooser
        open={chooserOpen}
        onUploadSelected={() => {
          setChooserOpen(false);
          setFormRevealed(true);
        }}
        onOpenChange={(next) => {
          setChooserOpen(next);
          if (!next && !formRevealed) {
            router.push("/dashboard/assessment/my_assessment");
          }
        }}
      />
      <MonoBackground />

      {/* --- Slim top bar -------------------------------------------------- */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-md lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/dashboard/assessment/my_assessment"
            aria-label="Back to assessments"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <span className="text-sm font-medium text-muted-foreground">
            Assessments
            <span className="mx-1.5 text-border">/</span>
            <span className="font-semibold text-foreground">New</span>
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground">
          <Lock className="size-3" />
          Security
        </span>
      </div>

      {/* --- Content ------------------------------------------------------- */}
      <div className="mx-auto max-w-6xl px-6 py-10 lg:py-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mb-8 max-w-2xl"
        >
          <span className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <span className="size-1 rounded-full bg-foreground" />
            New assessment
          </span>
          <h1 className="text-balance text-[32px] font-bold leading-[1.08] tracking-tight text-foreground sm:text-[38px]">
            Start a new threat assessment
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            Share your application context and architecture. Our engine maps
            the attack surface and drafts a prioritized threat model for review.
          </p>
        </motion.div>

        {/* Form + guidance */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)] lg:gap-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.5, ease: EASE }}
            className="relative min-w-0"
          >
            <AssessmentForm />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.18, duration: 0.45, ease: EASE }}
          >
            <GuidanceRail />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
