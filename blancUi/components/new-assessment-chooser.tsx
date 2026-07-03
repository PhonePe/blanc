"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ImageIcon, PenLine } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Modal shown on entry to /dashboard/assessment/new. Two options:
 *
 *   1. Create a new architecture / sequence diagram in ATM Studio.
 *   2. Upload an existing image (or PDF containing one).
 */
export interface NewAssessmentChooserProps {
  open: boolean;
  onUploadSelected: () => void;
  onOpenChange: (open: boolean) => void;
}

export function NewAssessmentChooser({
  open,
  onUploadSelected,
  onOpenChange,
}: NewAssessmentChooserProps) {
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl gap-0 p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="border-b border-border/60 px-6 pt-6 pb-5 text-left">
          <span className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <span className="size-1 rounded-full bg-foreground" />
            New assessment
          </span>
          <DialogTitle className="text-2xl font-semibold tracking-tight">
            Start a new assessment
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Bring an existing diagram, or design one from scratch in ATM Studio.
          </DialogDescription>
        </DialogHeader>

        {/* Choices */}
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:gap-4 sm:p-6">
          <ChoiceCard
            index="01"
            icon={PenLine}
            title="Create new diagram"
            description="Draw a fresh architecture or sequence diagram in Mermaid, then hand it straight to the analyzer."
            cta="Open ATM Studio"
            onClick={() => router.push("/dashboard/atmstudio")}
          />
          <ChoiceCard
            index="02"
            icon={ImageIcon}
            title="Upload existing image"
            description="Have a PNG, JPG, or a PDF with a diagram? Upload it and let vision + OCR turn it into a threat model."
            cta="Choose a file"
            recommended
            onClick={onUploadSelected}
          />
        </div>

        {/* Footnote */}
        <div className="border-t border-border/60 bg-muted/30 px-6 py-3 text-[11px] text-muted-foreground">
          You can switch between diagrams and files later — this only picks
          where you start.
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ChoiceCardProps {
  index: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  cta: string;
  recommended?: boolean;
  onClick: () => void;
}

function ChoiceCard({
  index,
  icon: Icon,
  title,
  description,
  cta,
  recommended,
  onClick,
}: ChoiceCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card p-5 text-left",
        "border-border transition-all",
        "hover:border-foreground/40 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {/* Top row: icon + index / recommended pill */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <span
          className={cn(
            "grid size-10 place-items-center rounded-lg transition-colors",
            "bg-foreground text-background",
            "dark:bg-white dark:text-black",
          )}
        >
          <Icon className="size-4.5" />
        </span>
        <div className="flex items-center gap-2">
          {recommended && (
            <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-foreground">
              Recommended
            </span>
          )}
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {index}
          </span>
        </div>
      </div>

      {/* Body */}
      <h3 className="text-base font-semibold leading-snug text-foreground">
        {title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>

      {/* CTA row */}
      <div className="mt-5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span>{cta}</span>
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </motion.button>
  );
}
