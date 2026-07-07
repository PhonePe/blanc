"use client"

// Step 2 of the assessment flow — after the user is happy with the diagram
// + components inventory in /assessment/[id] (the "Studio" page), they land
// here to review the AI-generated summary and answer clarification
// questions before kicking off the actual threat-model generation.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clipboard,
  Clock,
  Coins,
  DollarSign,
  HelpCircle,
  ImageIcon,
  Info,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Timer,
  XCircle,
  Zap,
} from "lucide-react"

import { api } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import {
  useAssessmentData,
  type AssessmentImage,
} from "@/hooks/use-assessment-data"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
const STATE_INFO: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  PENDING: {
    label: "Queued",
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    border: "border-border",
  },
  PROCESSING: {
    label: "Analyzing",
    color: "text-primary",
    bg: "bg-primary/5",
    border: "border-primary/20",
  },
  NEEDS_INPUT: {
    label: "Input Required",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-200/60",
  },
  COMPLETED: {
    label: "Complete",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950",
    border: "border-emerald-200/60",
  },
  FAILED: {
    label: "Failed",
    color: "text-destructive",
    bg: "bg-destructive/5",
    border: "border-destructive/20",
  },
}

// Match the normalization the Studio page does so partial / legacy
// clarification payloads (list-of-strings, list-of-objects, or
// { questions: [...] }) all collapse to a uniform shape.
function normalizeQuestions(raw: AssessmentImage["clarification"]) {
  let list: any[]
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === "object" && Array.isArray((raw as any).questions))
    list = (raw as any).questions
  else list = []
  return list.map((q: any) => ({
    question: typeof q === "string" ? q : q.question || "",
    answer: typeof q === "string" ? "" : q.answer || "",
    auto_answered: typeof q === "string" ? false : Boolean(q.auto_answered),
  }))
}

export default function AssessmentSummaryPage() {
  const { id } = useParams()
  const router = useRouter()
  const assessmentId =
    typeof id === "string" ? id : Array.isArray(id) ? id[0] : ""

  const {
    assessmentState,
    assessmentStage,
    images,
    loading,
    usageData,
    refetch,
  } = useAssessmentData(assessmentId)

  const [activeImageIdx, setActiveImageIdx] = useState(0)
  // Map<image_id, Map<question_index, answer>>. Kept locally so the user can
  // type freely without each keystroke hitting the backend.
  const [userAnswers, setUserAnswers] = useState<
    Record<string, Record<number, string>>
  >({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isAutoAnswering, setIsAutoAnswering] = useState<string | null>(null)

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeImage = images[activeImageIdx] || null

  const { highLevelSummary, questions } = useMemo(() => {
    if (!activeImage) return { highLevelSummary: null, questions: [] as ReturnType<typeof normalizeQuestions> }
    return {
      highLevelSummary: activeImage.analysis_summary?.summary || null,
      questions: normalizeQuestions(activeImage.clarification),
    }
  }, [activeImage])

  // Pre-fill answer fields with the server-provided answer when a new image
  // becomes active and we don't already have local edits for it.
  useEffect(() => {
    if (!activeImage || questions.length === 0) return
    const imgId = activeImage.image_id
    if (userAnswers[imgId]) return
    const initialMap: Record<number, string> = {}
    questions.forEach((q, idx) => {
      if (q.answer) initialMap[idx] = q.answer
    })
    setUserAnswers((prev) => ({ ...prev, [imgId]: initialMap }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImage?.image_id, questions.length])

  const unansweredCount = useMemo(() => {
    if (!activeImage || !questions.length) return 0
    const imgId = activeImage.image_id
    return questions.reduce((n, q, idx) => {
      const v = userAnswers[imgId]?.[idx] ?? q.answer ?? ""
      return n + (v.trim().length === 0 ? 1 : 0)
    }, 0)
  }, [activeImage, questions, userAnswers])

  const persistAnswers = useCallback(
    async (shouldFinalize: boolean) => {
      if (!assessmentId) return
      if (shouldFinalize) setIsSubmitting(true)
      else setIsSaving(true)
      try {
        for (const img of images) {
          if (img.state !== "NEEDS_INPUT" && img.state !== "COMPLETED") continue
          const imgId = img.image_id
          const imgAnswers = userAnswers[imgId] || {}
          const qList = normalizeQuestions(img.clarification)
          if (qList.length === 0) continue
          const formattedAnswers = qList.map((q, index) => ({
            question: q.question,
            answer: imgAnswers[index] || q.answer || "",
          }))
          if (shouldFinalize) {
            await api.post(`/assessment/${assessmentId}/images/${imgId}/answer`, {
              clarification_questions: formattedAnswers,
              // Pass an empty string — the Mermaid edits made in the Studio
              // step are already persisted via the surface-map PUT call and
              // the assessment-level answer endpoint reuses the stored copy.
              mermaid_code: "",
            })
          } else {
            // Soft / draft save (no state transition).
            await api.put(
              `/assessment/${assessmentId}/images/${imgId}/save-answers`,
              {
                clarification_questions: formattedAnswers,
              }
            )
          }
        }
        if (shouldFinalize) {
          toast.success("Answers saved — starting threat modeling")
          router.push(`/dashboard/threat/${assessmentId}`)
        } else {
          toast.success("Draft saved successfully")
          await refetch()
        }
      } catch (e: any) {
        toast.error(e?.message || "Failed to save answers")
      } finally {
        setIsSubmitting(false)
        setIsSaving(false)
      }
    },
    [assessmentId, images, userAnswers, router, refetch]
  )

  // Auto-save 2s after the last edit. Mirrors the Studio page so users
  // never lose answers when switching steps.
  useEffect(() => {
    const hasAnswers = Object.values(userAnswers).some(
      (m) => Object.keys(m).length > 0
    )
    if (!hasAnswers) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      // Silent save — no state change, no toast.
      ;(async () => {
        if (!assessmentId) return
        try {
          for (const img of images) {
            if (img.state !== "NEEDS_INPUT" && img.state !== "COMPLETED")
              continue
            const imgId = img.image_id
            const imgAnswers = userAnswers[imgId] || {}
            if (Object.keys(imgAnswers).length === 0) continue
            const qList = normalizeQuestions(img.clarification)
            if (qList.length === 0) continue
            const formattedAnswers = qList.map((q, index) => ({
              question: q.question,
              answer: imgAnswers[index] || q.answer || "",
            }))
            await api.put(
              `/assessment/${assessmentId}/images/${imgId}/save-answers`,
              {
                clarification_questions: formattedAnswers,
              }
            )
          }
        } catch {
          /* silent */
        }
      })()
    }, 2000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [userAnswers, assessmentId, images])

  const handleAutoAnswer = async (imageId: string) => {
    if (!assessmentId) return
    setIsAutoAnswering(imageId)
    try {
      const result = await api.post(
        `/assessment/${assessmentId}/images/${imageId}/auto-answer`,
        {},
        { retryOnPost: true }
      )
      // Backend returns the updated list under `clarifications` (see
      // AssessmentService.auto_answer_image). Fall back to the legacy
      // `clarification_questions` key in case the API shape changes.
      const list: any[] | undefined =
        result?.data?.clarifications ?? result?.data?.clarification_questions
      if (Array.isArray(list)) {
        const autoAnswers: Record<number, string> = {}
        list.forEach((q: any, idx: number) => {
          if (q?.answer) autoAnswers[idx] = q.answer
        })
        setUserAnswers((prev) => ({
          ...prev,
          [imageId]: { ...prev[imageId], ...autoAnswers },
        }))
        const answered = Object.values(autoAnswers).filter((a) => a.trim()).length
        toast.success(
          `Auto-answered ${answered} of ${list.length} questions`
        )
      }
      await refetch()
    } catch (e: any) {
      toast.error(e?.message || "Auto-answer failed — try answering manually")
    } finally {
      setIsAutoAnswering(null)
    }
  }

  // --- Loading ---
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Sparkles size={20} className="text-primary-foreground" />
          </div>
          <motion.div
            className="absolute -inset-1.5 rounded-lg border-2 border-primary/20"
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Loading summary</p>
          <p className="text-xs text-muted-foreground mt-1">
            Fetching the latest data…
          </p>
        </div>
      </div>
    )
  }

  const isProcessing = assessmentState === "PROCESSING"
  const summaryReady = images.some((img) => img.analysis_summary?.summary)

  // --- Generation Loading Screen ---
  // Shown immediately after the user clicks "Generate Summary & Questions"
  // on the Studio page (which routes here while the backend is still in
  // Phase B). We keep the user on this page with a clear, stage-aware
  // loader until the backend transitions out of PROCESSING — i.e. BOTH the
  // summary AND the clarification questions are finished. Gating on
  // `summaryReady` alone would unmount the loader mid-Phase B (summary
  // first, questions still pending) and briefly render the misleading
  // "No clarification questions" empty state.
  if (isProcessing) {
    const phaseBStages = [
      {
        id: "SUMMARIZING",
        label: "Generating summary",
        description: "Distilling your architecture into a high-level overview",
        icon: Sparkles,
      },
      {
        id: "CLARIFICATION",
        label: "Drafting clarification questions",
        description: "Identifying gaps the AI needs you to fill in",
        icon: MessageCircleQuestion,
      },
    ] as const
    const activeIdx = Math.max(
      0,
      phaseBStages.findIndex((s) => s.id === assessmentStage),
    )
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <Card className="gap-0 overflow-hidden border-border/70 py-0 shadow-sm">
            <CardHeader className="gap-3 border-b border-border/60 bg-muted/20 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="grid size-10 place-items-center rounded-xl bg-linear-to-br from-violet-600 to-fuchsia-600 text-white shadow-sm">
                    <Sparkles size={18} />
                  </div>
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -inset-1.5 rounded-xl border-2 border-violet-500/30"
                    animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0, 0.55] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">Preparing your summary</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    This usually takes a few seconds — please keep this tab open.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              {phaseBStages.map((stage, idx) => {
                const Icon = stage.icon
                const isDone = idx < activeIdx
                const isActive = idx === activeIdx
                return (
                  <div
                    key={stage.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                      isActive && "border-primary/30 bg-primary/5",
                      isDone && "border-emerald-400/40 bg-emerald-500/5",
                      !isActive && !isDone && "border-border/60 bg-muted/20",
                    )}
                  >
                    <div
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-md transition-colors",
                        isDone && "bg-emerald-500 text-white",
                        isActive && "bg-primary text-primary-foreground",
                        !isActive && !isDone && "bg-muted text-muted-foreground",
                      )}
                    >
                      {isActive ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : isDone ? (
                        <Check size={14} strokeWidth={3} />
                      ) : (
                        <Icon size={14} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-medium leading-tight",
                          isActive ? "text-foreground" : "text-foreground/80",
                        )}
                      >
                        {stage.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {stage.description}
                      </p>
                    </div>
                    {isDone && (
                      <Badge
                        variant="outline"
                        className="h-5 shrink-0 gap-1 rounded-full border-emerald-300/60 bg-emerald-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        <Check size={9} strokeWidth={3} />
                        Done
                      </Badge>
                    )}
                  </div>
                )
              })}
            </CardContent>
            <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-5 py-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" />
                Auto-refreshing…
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  router.push(`/dashboard/assessment/${assessmentId}`)
                }
                className="h-7 text-[11px]"
              >
                <ArrowLeft className="size-3" />
                Back to Studio
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* --- Top Navigation --- */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border-b border-border"
      >
        <div className="flex min-h-[53px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/assessment/my_assessment"
              className="inline-flex items-center justify-center rounded-md w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Back to assessments"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
                <Sparkles size={12} className="text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-foreground leading-none">
                  Summary &amp; Questions
                </h1>
                <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                  Step 2 · Review &amp; clarify
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const info = STATE_INFO[assessmentState] || STATE_INFO.PENDING
              return (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border",
                    info.bg,
                    info.color,
                    info.border
                  )}
                >
                  {assessmentState === "PROCESSING" && (
                    <Loader2 size={12} className="animate-spin" />
                  )}
                  {assessmentState === "FAILED" && <XCircle size={12} />}
                  {assessmentState === "COMPLETED" && <Check size={12} />}
                  {assessmentState === "NEEDS_INPUT" && <HelpCircle size={12} />}
                  {assessmentState === "PENDING" && <Clock size={12} />}
                  {info.label}
                </span>
              )
            })()}

            <Separator orientation="vertical" className="h-6!" />

            <TooltipProvider delayDuration={200}>
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        router.push(`/dashboard/assessment/${assessmentId}`)
                      }
                      disabled={isSaving || isSubmitting}
                      className="h-8"
                    >
                      <ArrowLeft />
                      <span className="hidden sm:inline">Back to Studio</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Return to the diagram canvas
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => persistAnswers(false)}
                      disabled={isSaving || isSubmitting}
                      className="h-8"
                    >
                      {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                      <span className="hidden sm:inline">{isSaving ? "Saving…" : "Save Draft"}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Save current edits without submitting
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      onClick={() => persistAnswers(true)}
                      disabled={isProcessing || isSubmitting}
                      className="h-8 shadow-sm"
                    >
                      {isSubmitting || isProcessing ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ShieldAlert />
                      )}
                      <span className="hidden sm:inline">
                        {isProcessing
                          ? "Working…"
                          : isSubmitting
                          ? "Submitting…"
                          : "Generate Threat Model"}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Submit answers and run threat analysis
                  </TooltipContent>
                </Tooltip>
                {assessmentState === "FAILED" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          router.push(`/dashboard/assessment/${assessmentId}`)
                        }
                        className="h-8"
                      >
                        <RefreshCw />
                        <span className="hidden sm:inline">Retry in Studio</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Re-run the pipeline from the Studio page
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </TooltipProvider>
          </div>
        </div>
      </motion.header>

      {/* --- Image selector (only when multiple) --- */}
      {images.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="border-b bg-card/30 px-4 sm:px-6 py-3"
        >
          <div className="flex items-center gap-3 overflow-x-auto">
            <div className="flex items-center gap-1.5 shrink-0">
              <ImageIcon size={12} className="text-muted-foreground" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Diagrams
              </p>
              <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[10px]">
                {images.length}
              </Badge>
            </div>
            <Separator orientation="vertical" className="h-6!" />
            <div className="flex flex-1 gap-1.5 overflow-x-auto">
              {images.map((img, idx) => {
                const info = STATE_INFO[img.state] || STATE_INFO.PENDING
                const isActive = idx === activeImageIdx
                return (
                  <motion.button
                    key={img.image_id}
                    onClick={() => setActiveImageIdx(idx)}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: "spring" as const, stiffness: 400, damping: 28 }}
                    className={cn(
                      "relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "border-primary/40 bg-primary/5 shadow-xs"
                        : "border-border/60 hover:border-border hover:bg-muted/60",
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="image-selector-active"
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-primary/30"
                        transition={{ type: "spring" as const, stiffness: 400, damping: 32 }}
                      />
                    )}
                    <div
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-md transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <ImageIcon size={11} />
                    </div>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "truncate text-[12px] font-medium leading-tight",
                          isActive ? "text-foreground" : "text-foreground/75",
                        )}
                      >
                        Image {idx + 1}
                      </p>
                      <span className={cn("text-[10px] leading-none", info.color)}>
                        {info.label}
                      </span>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* --- Main Content --- */}
      <main className="min-w-0 p-4 sm:p-6 pb-24 space-y-6">
        {!summaryReady && !activeImage?.analysis_summary?.summary && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
          >
            <Card className="overflow-hidden border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 px-8 py-12 text-center">
                <div className="relative">
                  <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Loader2 size={20} className="animate-spin" />
                  </div>
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -inset-1.5 rounded-lg border border-primary/30"
                    animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Summary not ready yet
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The AI is still analyzing your architecture. This page will
                    refresh automatically.
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Summary section */}
        {highLevelSummary && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {(() => {
              const wordCount = highLevelSummary.trim().split(/\s+/).filter(Boolean).length
              const readMinutes = Math.max(1, Math.round(wordCount / 200))
              return (
                <Card className="gap-0 overflow-hidden border-border/70 py-0 shadow-xs">
                  <CardHeader className="gap-0 border-b border-border/60 bg-muted/30 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background text-foreground/80 shadow-xs">
                          <Sparkles size={16} />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-sm font-semibold leading-tight">
                            Architecture Summary
                          </CardTitle>
                          <CardDescription className="mt-1 text-xs leading-relaxed">
                            AI-generated overview of the selected diagram
                          </CardDescription>
                        </div>
                      </div>
                      <TooltipProvider delayDuration={200}>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className="hidden h-6 gap-1 rounded-md px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline-flex"
                          >
                            <Sparkles size={10} />
                            AI
                          </Badge>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(highLevelSummary)
                                    toast.success("Summary copied")
                                  } catch {
                                    toast.error("Copy failed")
                                  }
                                }}
                                className="size-7"
                              >
                                <Clipboard className="size-3.5" />
                                <span className="sr-only">Copy summary</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Copy summary</TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>
                    </div>
                  </CardHeader>
                  <CardContent className="px-5 py-5">
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.15, duration: 0.3 }}
                      className="whitespace-pre-line text-sm leading-7 text-foreground/85"
                    >
                      {highLevelSummary}
                    </motion.p>
                  </CardContent>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-5 py-2.5 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums font-medium text-foreground/75">{wordCount}</span>
                        words
                      </span>
                      <Separator orientation="vertical" className="h-3!" />
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} />
                        ~{readMinutes} min read
                      </span>
                    </div>
                    {images.length > 1 && activeImage && (
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon size={11} />
                        Image {activeImageIdx + 1} of {images.length}
                      </span>
                    )}
                  </div>
                </Card>
              )
            })()}
          </motion.section>
        )}

        {/* Q&A section */}
        {questions.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            {(() => {
              const total = questions.length
              const answered = total - unansweredCount
              const pct = total > 0 ? Math.round((answered / total) * 100) : 0
              return (
                <Card className="gap-0 overflow-hidden border-border/70 py-0 shadow-sm">
                  <CardHeader className="gap-4 border-b border-border/60 bg-muted/20 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <motion.div
                          initial={{ rotate: -8, scale: 0.85, opacity: 0 }}
                          animate={{ rotate: 0, scale: 1, opacity: 1 }}
                          transition={{ delay: 0.2, type: "spring" as const, stiffness: 220, damping: 16 }}
                          className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-amber-500/15 via-orange-500/10 to-rose-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-300"
                        >
                          <MessageCircleQuestion size={18} />
                        </motion.div>
                        <div>
                          <CardTitle className="flex items-center gap-2 text-base">
                            Clarification Questions
                            <AnimatePresence mode="popLayout">
                              {unansweredCount > 0 && (
                                <motion.span
                                  key="unanswered"
                                  initial={{ scale: 0.6, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0.6, opacity: 0 }}
                                  transition={{ type: "spring" as const, stiffness: 380, damping: 22 }}
                                >
                                  <Badge className="h-5 rounded-full bg-amber-500 px-1.5 text-[10px] tabular-nums text-white hover:bg-amber-500">
                                    {unansweredCount} unanswered
                                  </Badge>
                                </motion.span>
                              )}
                              {unansweredCount === 0 && (
                                <motion.span
                                  key="complete"
                                  initial={{ scale: 0.6, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0.6, opacity: 0 }}
                                  transition={{ type: "spring" as const, stiffness: 380, damping: 22 }}
                                >
                                  <Badge className="h-5 gap-1 rounded-full bg-emerald-500 px-1.5 text-[10px] text-white hover:bg-emerald-500">
                                    <CheckCircle2 size={11} />
                                    All answered
                                  </Badge>
                                </motion.span>
                              )}
                            </AnimatePresence>
                          </CardTitle>
                          <CardDescription className="mt-0.5 text-xs">
                            Help us understand your system for more accurate
                            threats
                          </CardDescription>
                        </div>
                      </div>
                      {activeImage && activeImage.state === "NEEDS_INPUT" && (
                        <Button
                          size="sm"
                          onClick={() => handleAutoAnswer(activeImage.image_id)}
                          disabled={isAutoAnswering === activeImage.image_id}
                          className="h-8 shrink-0 rounded-full px-3 text-xs shadow-sm"
                        >
                          {isAutoAnswering === activeImage.image_id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <BrainCircuit />
                          )}
                          {isAutoAnswering === activeImage.image_id
                            ? "Working…"
                            : "Auto-Answer"}
                        </Button>
                      )}
                    </div>

                    {/* Animated progress */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-muted-foreground">
                          Progress
                        </span>
                        <span className="tabular-nums font-semibold text-foreground">
                          <motion.span
                            key={answered}
                            initial={{ opacity: 0, y: -3 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className="inline-block"
                          >
                            {answered}
                          </motion.span>
                          {" "}
                          <span className="text-muted-foreground/70">
                            of {total} ({pct}%)
                          </span>
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        className={cn(
                          "h-1.5 transition-colors",
                          pct === 100 && "[&>div]:bg-emerald-500",
                        )}
                      />
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 p-4 sm:p-5">
                    {activeImage?.state === "NEEDS_INPUT" && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 rounded-lg border border-amber-200/60 bg-amber-50 p-3 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      >
                        <div className="shrink-0 rounded-md bg-amber-100 p-1.5 dark:bg-amber-900/40">
                          <Info size={14} className="text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                          <p className="text-xs font-medium">Your input is needed</p>
                          <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
                            Answer the questions below to continue. Even partial
                            information helps.
                          </p>
                        </div>
                      </motion.div>
                    )}

                    <div className="space-y-3">
                      {questions.map((qItem, index) => {
                        const imgId = activeImage?.image_id || ""
                        const currentVal =
                          userAnswers[imgId]?.[index] ?? qItem.answer ?? ""
                        const isAnswered = currentVal.trim().length > 0
                        return (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              delay: 0.05 * index,
                              duration: 0.3,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            layout
                          >
                            <div
                              className={cn(
                                "group relative overflow-hidden rounded-xl border bg-card shadow-xs transition-all",
                                isAnswered
                                  ? "border-emerald-400/40 bg-emerald-500/2"
                                  : "border-border hover:border-border/80 hover:shadow-sm",
                              )}
                            >
                              {/* Left accent bar */}
                              <motion.span
                                aria-hidden
                                initial={false}
                                animate={{
                                  scaleY: isAnswered ? 1 : 0,
                                  opacity: isAnswered ? 1 : 0,
                                }}
                                transition={{ duration: 0.25 }}
                                style={{ transformOrigin: "top" }}
                                className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-linear-to-b from-emerald-400 to-emerald-600"
                              />
                              <div className="p-4 sm:p-5">
                                <div className="flex gap-3.5">
                                  <motion.div
                                    layout
                                    transition={{
                                      type: "spring" as const,
                                      stiffness: 380,
                                      damping: 24,
                                    }}
                                    className={cn(
                                      "relative flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors",
                                      isAnswered
                                        ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    <AnimatePresence mode="wait" initial={false}>
                                      {isAnswered ? (
                                        <motion.span
                                          key="check"
                                          initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
                                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                          exit={{ scale: 0.4, opacity: 0 }}
                                          transition={{ type: "spring" as const, stiffness: 420, damping: 22 }}
                                        >
                                          <Check size={15} strokeWidth={3} />
                                        </motion.span>
                                      ) : (
                                        <motion.span
                                          key="num"
                                          initial={{ scale: 0.5, opacity: 0 }}
                                          animate={{ scale: 1, opacity: 1 }}
                                          exit={{ scale: 0.5, opacity: 0 }}
                                          transition={{ duration: 0.15 }}
                                        >
                                          {index + 1}
                                        </motion.span>
                                      )}
                                    </AnimatePresence>
                                  </motion.div>
                                  <div className="min-w-0 flex-1">
                                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                                      <p className="text-sm font-medium leading-snug text-foreground">
                                        {qItem.question}
                                      </p>
                                      {qItem.auto_answered && (
                                        <Badge
                                          variant="outline"
                                          className="gap-1 rounded-full border-sky-300/60 bg-sky-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300"
                                        >
                                          <Sparkles size={9} />
                                          Auto answered
                                        </Badge>
                                      )}
                                      <AnimatePresence>
                                        {isAnswered && (
                                          <motion.span
                                            key="answered-pill"
                                            initial={{ opacity: 0, x: -4 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -4 }}
                                            transition={{ duration: 0.2 }}
                                            className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                                          >
                                            <CheckCircle2 size={10} />
                                            Answered
                                          </motion.span>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                    <Textarea
                                      placeholder="Type your answer…"
                                      value={currentVal}
                                      onChange={(e) =>
                                        setUserAnswers((prev) => ({
                                          ...prev,
                                          [imgId]: {
                                            ...prev[imgId],
                                            [index]: e.target.value,
                                          },
                                        }))
                                      }
                                      className="min-h-20 resize-none border-border/60 bg-background text-sm shadow-none focus-visible:ring-1"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}
          </motion.section>
        )}

        {questions.length === 0 && highLevelSummary && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                <div className="grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                  <CheckCircle2 size={20} />
                </div>
                <p className="text-sm font-medium text-foreground">
                  No clarification questions for this diagram
                </p>
                <p className="text-xs text-muted-foreground">
                  You can proceed to generate the threat model.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* LLM usage footer */}
        {usageData && usageData.total_calls > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
          >
            <Card className="gap-0 border-border/60 bg-muted/20 py-2.5 shadow-none">
              <CardContent className="flex flex-wrap items-center gap-4 px-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Zap className="size-3.5 text-amber-500" />
                  AI Usage
                </div>
                <Separator orientation="vertical" className="h-4!" />
                <div className="flex items-center gap-1">
                  <Coins className="size-3 text-violet-500" />
                  <span className="tabular-nums text-foreground/85">
                    {usageData.total_tokens_billed.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground/70">tokens</span>
                </div>
                <div className="flex items-center gap-1">
                  <DollarSign className="size-3 text-emerald-500" />
                  <span className="tabular-nums text-foreground/85">
                    ${usageData.total_estimated_cost.toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Timer className="size-3 text-sky-500" />
                  <span className="tabular-nums text-foreground/85">
                    {(usageData.total_duration_ms / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <span className="tabular-nums text-foreground/85">
                    {usageData.total_calls}
                  </span>
                  <span className="text-muted-foreground/70">calls</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </main>
    </div>
  )
}
