"use client"

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react"
import dynamic from "next/dynamic"
import { useParams, useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { renderMermaidSvg } from "@/lib/mermaid"
import { useTheme } from "next-themes"

import {
  Loader2, FileCode2, MessageSquareText, Check,
  Sparkles, Layers, ShieldAlert,
  Copy, Terminal, AlertCircle, X,
  RotateCcw, Info, ZoomIn, ZoomOut, Maximize2, Move,
  ArrowLeft, XCircle, RefreshCw, Clock, Eye,
  ChevronRight, HelpCircle, CheckCircle2, Zap,
  ImageIcon, BrainCircuit, Coins, DollarSign, Timer,
  Search, ShieldCheck, Globe, Lock, Database, Server, Users,
  Network, CheckSquare, Square, ChevronDown, Plus, Trash, Trash2,
  KeyRound, Fingerprint, Wand2, ShieldQuestion,
  WandSparkles, FileJson, Clipboard, Eraser,
  type LucideIcon
} from "lucide-react"

const MermaidCanvas = dynamic(
  () => import("@/components/MermaidCanvas").then((m) => m.MermaidCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[420px] items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading Mermaid renderer
      </div>
    ),
  },
)
import type { MermaidRenderStatus } from "@/components/MermaidCanvas"
import { CodeEditor, type CodeEditorHandle } from "@/components/CodeEditor"
import Link from "next/link"
import Image from "next/image"
import { toast } from "sonner"
import { api } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// --- Constants ---

// Stage order matches the two-phase backend pipeline:
//   Phase A: IMAGE_PROCESSING → COMPONENT_ANALYSIS  (auto on upload)
//   -- User clicks "Next" in the studio --
//   Phase B: SUMMARIZING → CLARIFICATION             (auto after Next)
//   Then THREAT_MODELING is gated on COMPLETED.
const STAGES = [
  { id: "IMAGE_PROCESSING",   label: "Diagram Scan", icon: Eye,               tooltip: "Scanning and parsing the uploaded architecture diagrams" },
  { id: "COMPONENT_ANALYSIS", label: "Components",   icon: Layers,            tooltip: "Identifying and analyzing individual system components" },
  { id: "SUMMARIZING",        label: "Summary",      icon: Sparkles,          tooltip: "Generating a high-level summary of the architecture" },
  { id: "COMPONENT_DOCS",     label: "Docs",         icon: FileCode2,         tooltip: "Retrieving documentation for identified components" },
  { id: "CLARIFICATION",      label: "Questions",    icon: MessageSquareText, tooltip: "Generating clarification questions about the architecture" },
  { id: "THREAT_MODELING",    label: "Threats",      icon: ShieldAlert,       tooltip: "Running STRIDE-based threat analysis on the architecture" },
]

const STATE_INFO: Record<string, { label: string; description: string; color: string; bg: string; border: string; icon: any; gradient: string }> = {
  PENDING:         { label: "Queued",           description: "Assessment is queued",                                     color: "text-muted-foreground",                  bg: "bg-muted/50",                       border: "border-border",          icon: Clock,        gradient: "from-slate-500 to-slate-600" },
  PROCESSING:      { label: "Analyzing",        description: "AI is analyzing your architecture",                        color: "text-primary",                           bg: "bg-primary/5",                      border: "border-primary/20",      icon: Loader2,      gradient: "from-primary to-violet-600" },
  AWAITING_REVIEW: { label: "Review Components",description: "Diagram and components extracted — click Next to continue",color: "text-violet-600 dark:text-violet-400",   bg: "bg-violet-50 dark:bg-violet-950",   border: "border-violet-200/60",   icon: Eye,          gradient: "from-violet-500 to-fuchsia-600" },
  NEEDS_INPUT:     { label: "Input Required",   description: "We need your input to continue",                           color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950",     border: "border-amber-200/60",    icon: HelpCircle,   gradient: "from-amber-500 to-orange-600" },
  COMPLETED:       { label: "Complete",         description: "Analysis finished — review or proceed",                    color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950", border: "border-emerald-200/60",  icon: CheckCircle2, gradient: "from-emerald-500 to-teal-600" },
  FAILED:          { label: "Failed",           description: "The analysis encountered an error",                        color: "text-destructive",                       bg: "bg-destructive/5",                  border: "border-destructive/20",  icon: XCircle,      gradient: "from-rose-500 to-red-600" },
}

const PROCESSING_MESSAGES = [
  "Analyzing your architecture diagram…",
  "Identifying system boundaries…",
  "Mapping data flows between components…",
  "Evaluating trust zones…",
  "Checking for common patterns…",
]

// --- Types ---

type ImageData = {
  image_id: string
  image_path?: string
  state: string
  stage: string
  error_message?: string | null
  flow_diagram?: { mermaid?: string } | null
  analysis_summary?: { summary?: string } | null
  component_details?: { components?: any[] } | null
  clarification?: { questions?: any[] } | any[] | null
  component_docs?: { question: string; answer: string }[] | null
}

type StageStatus = "completed" | "processing" | "needs-input" | "failed" | "pending"

type InspectorCategory = "Client" | "Edge" | "Application" | "Data" | "External" | "Infrastructure" | "Unknown"
type InspectorExposure = "Internal" | "Partner" | "VPN" | "Internet/Public"
type InspectorFinding = { severity: "High" | "Medium" | "Low"; message: string }
type InspectorComponent = {
  id: string
  name: string
  category: InspectorCategory
  trustLevel: string
  exposure: InspectorExposure
  purpose: string
  sourceLabel: string
  authSignal: string
  protocolSignal: string
  completeness: number
  findings: InspectorFinding[]
}

const INSPECTOR_CATEGORY_UI: Record<InspectorCategory, { icon: LucideIcon; className: string }> = {
  Client: { icon: Users, className: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  Edge: { icon: Globe, className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  Application: { icon: Server, className: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300" },
  Data: { icon: Database, className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  External: { icon: Globe, className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" },
  Infrastructure: { icon: Layers, className: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  Unknown: { icon: HelpCircle, className: "bg-muted text-muted-foreground" },
}

const INSPECTOR_FINDING_UI: Record<InspectorFinding["severity"], string> = {
  High: "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-200",
  Medium: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  Low: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200",
}

const normalizeInspectorText = (value: unknown) =>
  typeof value === "string" ? value.trim() : ""

const getComponentValue = (component: any, keys: string[]) => {
  for (const key of keys) {
    const value = normalizeInspectorText(component?.[key])
    if (value) return value
  }
  return ""
}

const getDocumentationContext = (component: any) =>
  getComponentValue(component, ["documentation_context", "documentationContext", "context"])

const isMissingDocumentation = (value: string) => /^no information found/i.test(value)

const inferInspectorCategory = (name: string, purpose: string, trustLevel: string): InspectorCategory => {
  const haystack = `${name} ${purpose} ${trustLevel}`.toLowerCase()
  if (/(client|browser|mobile|desktop|portal|frontend)/.test(haystack)) return "Client"
  if (/(gateway|waf|cdn|edge|ingress|proxy|load.?balancer|firewall|nginx)/.test(haystack)) return "Edge"
  if (/(db|database|sql|mongo|redis|cache|store|bucket|queue|topic|broker|kafka)/.test(haystack)) return "Data"
  if (/(third.?party|partner|external|vendor|saas|razorpay|stripe|payu)/.test(haystack)) return "External"
  if (/(vpc|subnet|cluster|namespace|pod|container|vm|ec2|node|region|zone|vpn|express.?route)/.test(haystack)) return "Infrastructure"
  if (/(service|api|backend|server|worker|processor|engine|job|handler)/.test(haystack)) return "Application"
  return "Unknown"
}

const inferInspectorExposure = (category: InspectorCategory, name: string, purpose: string, trustLevel: string): InspectorExposure => {
  const haystack = `${category} ${name} ${purpose} ${trustLevel}`.toLowerCase()
  if (/(internet|public|client|browser|mobile|waf|cdn|gateway|edge|ingress|external)/.test(haystack)) return "Internet/Public"
  if (/(partner|vendor|third.?party)/.test(haystack)) return "Partner"
  if (/(vpn|private tunnel)/.test(haystack)) return "VPN"
  return "Internal"
}

const getComponentPurpose = (component: any) => {
  const documentationContext = getDocumentationContext(component)
  if (documentationContext && !isMissingDocumentation(documentationContext)) return documentationContext
  return getComponentValue(component, ["purpose", "description", "summary", "role"]) || "Component purpose needs review."
}

const getSourceLabel = (component: any) => {
  const documentationContext = getDocumentationContext(component)
  if (documentationContext && !isMissingDocumentation(documentationContext)) return "Documentation"
  if (documentationContext && isMissingDocumentation(documentationContext)) return "External Knowledge"
  return "AI Extraction"
}

const getInspectorFindings = (component: InspectorComponent): InspectorFinding[] => {
  const findings: InspectorFinding[] = []
  if (component.category === "Data" && component.exposure === "Internet/Public") {
    findings.push({ severity: "High", message: "Data component is marked public-facing; confirm storage is isolated behind private controls." })
  }
  if (component.exposure === "Internet/Public" && component.authSignal === "Not captured") {
    findings.push({ severity: "Medium", message: "Public-facing component has no extracted authentication signal." })
  }
  if (component.category === "Unknown") {
    findings.push({ severity: "Low", message: "Component category could not be inferred from the extracted details." })
  }
  if (component.sourceLabel === "External Knowledge") {
    findings.push({ severity: "Low", message: "Internal documentation was not found; validate ownership and controls manually." })
  }
  if (!component.trustLevel || component.trustLevel === "Unknown") {
    findings.push({ severity: "Low", message: "Trust level or boundary is not available in the extracted component details." })
  }
  return findings
}

const normalizeInspectorComponent = (component: any, index: number): InspectorComponent => {
  const name = getComponentValue(component, ["component", "name", "id", "title"]) || `Component ${index + 1}`
  const trustLevel = getComponentValue(component, ["trust_level", "trustBoundary", "trust_boundary", "boundary"]) || "Unknown"
  const purpose = getComponentPurpose(component)
  const rawCategory = getComponentValue(component, ["component_type", "category", "type"]) as InspectorCategory
  const safeCategory = rawCategory && INSPECTOR_CATEGORY_UI[rawCategory]
    ? rawCategory
    : inferInspectorCategory(name, purpose, trustLevel)
  const exposure = inferInspectorExposure(safeCategory, name, purpose, trustLevel)
  const authSignal = getComponentValue(component, ["auth_mechanism", "authentication", "authn", "auth", "identity_provider"]) || "Not captured"
  const protocolSignal = getComponentValue(component, ["protocol", "transport", "data_flow", "interface"]) || "Not captured"
  const sourceLabel = getSourceLabel(component)
  const completenessChecks = [
    safeCategory !== "Unknown",
    trustLevel !== "Unknown",
    purpose !== "Component purpose needs review.",
    authSignal !== "Not captured",
    protocolSignal !== "Not captured",
    sourceLabel !== "External Knowledge",
  ]
  const baseComponent: InspectorComponent = {
    id: getComponentValue(component, ["id", "component_id"]) || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `component_${index + 1}`,
    name,
    category: safeCategory,
    trustLevel,
    exposure,
    purpose,
    sourceLabel,
    authSignal,
    protocolSignal,
    completeness: Math.round((completenessChecks.filter(Boolean).length / completenessChecks.length) * 100),
    findings: [],
  }
  return { ...baseComponent, findings: getInspectorFindings(baseComponent) }
}






// ------------------ Sidebar ------------------

const SidebarPanel = ({ assessmentState, currentStage, images, activeImageIdx, onImageSelect }: {
  assessmentState: string; currentStage: string; images: ImageData[]
  activeImageIdx: number; onImageSelect: (idx: number) => void
}) => {
  // Derive state/stage from the active image when available, fallback to assessment-level
  const activeImage = images[activeImageIdx]
  const effectiveState = activeImage?.state || assessmentState
  const effectiveStage = activeImage?.stage || currentStage

  const currentStageIdx = STAGES.findIndex(s => s.id === effectiveStage)
  const isEffectiveProcessing = effectiveState === "PROCESSING"

  const getOverallStageStatus = (stageIdx: number): StageStatus => {
    if (effectiveState === "COMPLETED") return "completed"
    if (effectiveState === "FAILED" && stageIdx <= currentStageIdx) return stageIdx === currentStageIdx ? "failed" : "completed"
    // AWAITING_REVIEW: Phase A finished, every stage up to and including the
    // current one (COMPONENT_ANALYSIS) is done. The rest are queued behind the
    // user's "Next" click.
    if (effectiveState === "AWAITING_REVIEW") {
      if (stageIdx <= currentStageIdx) return "completed"
      return "pending"
    }
    if (stageIdx < currentStageIdx) return "completed"
    if (stageIdx === currentStageIdx) {
      if (effectiveState === "PROCESSING") return "processing"
      if (effectiveState === "NEEDS_INPUT") return "needs-input"
      if (effectiveState === "FAILED") return "failed"
    }
    return "pending"
  }

  const statusLabel: Record<StageStatus, string> = {
    completed: "Done", processing: "In progress", "needs-input": "Awaiting", failed: "Error", pending: "Queued",
  }
  const textColor: Record<StageStatus, string> = {
    completed: "text-emerald-600 dark:text-emerald-400", processing: "text-primary", "needs-input": "text-amber-600 dark:text-amber-400",
    failed: "text-destructive", pending: "text-muted-foreground/50",
  }

  // Progress along the stepper rail — percentage of stages reached.
  const railProgressPct = currentStageIdx < 0
    ? 0
    : effectiveState === "COMPLETED"
      ? 100
      : Math.round((currentStageIdx / Math.max(1, STAGES.length - 1)) * 100)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="sticky top-[53px] z-30 border-b border-border bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/75">
        {/* Stage progress rail */}
        <div className="px-4 py-3 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-background/85 px-4 py-4 shadow-sm backdrop-blur-sm">
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r",
                effectiveState === "FAILED" && "from-transparent via-rose-500/70 to-transparent",
                effectiveState === "NEEDS_INPUT" && "from-transparent via-amber-500/70 to-transparent",
                effectiveState === "COMPLETED" && "from-transparent via-emerald-500/70 to-transparent",
                effectiveState !== "FAILED" && effectiveState !== "NEEDS_INPUT" && effectiveState !== "COMPLETED" && "from-transparent via-primary/70 to-transparent",
              )}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.14] mask-[radial-gradient(ellipse_at_center,black_35%,transparent_78%)] bg-[radial-gradient(circle,currentColor_1px,transparent_1px)] bg-size-[18px_18px] text-muted-foreground/45"
            />
            {isEffectiveProcessing && (
              <span className="pointer-events-none absolute inset-0 bg-linear-to-r from-transparent via-primary/6 to-transparent animate-[shimmer_2.4s_ease-in-out_infinite] bg-size-[200%_100%]" />
            )}

            <div className="relative overflow-x-auto pb-1">
              <div
                className="relative grid min-w-[760px]"
                style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(7.25rem, 1fr))` }}
              >
                <div
                  className="pointer-events-none absolute top-[21px] h-2 rounded-full border border-border/50 bg-muted/50 shadow-inner"
                  style={{
                    left: `calc(${100 / (STAGES.length * 2)}%)`,
                    right: `calc(${100 / (STAGES.length * 2)}%)`,
                  }}
                />
                <motion.div
                  initial={false}
                  animate={{ width: `${railProgressPct}%` }}
                  transition={{ type: "spring" as const, stiffness: 120, damping: 24 }}
                  className={cn(
                    "pointer-events-none absolute top-[21px] h-2 overflow-hidden rounded-full bg-linear-to-r shadow-[0_0_18px_-5px_currentColor]",
                    effectiveState === "FAILED"
                      ? "from-rose-500 via-red-500 to-red-600 text-rose-500/80"
                      : effectiveState === "NEEDS_INPUT"
                        ? "from-emerald-400 via-emerald-500 to-amber-400 text-amber-500/70"
                        : effectiveState === "COMPLETED"
                          ? "from-emerald-400 via-teal-500 to-emerald-600 text-emerald-500/75"
                          : "from-primary via-violet-500 to-cyan-400 text-primary/75",
                  )}
                  style={{
                    left: `calc(${100 / (STAGES.length * 2)}%)`,
                    maxWidth: `calc(100% - ${100 / STAGES.length}%)`,
                  }}
                >
                  {(isEffectiveProcessing || effectiveState === "NEEDS_INPUT") && (
                    <span className="absolute inset-0 rounded-full bg-linear-to-r from-transparent via-white/55 to-transparent animate-[shimmer_1.8s_ease-in-out_infinite] bg-size-[200%_100%]" />
                  )}
                </motion.div>

                {STAGES.map((stage, idx) => {
                  const status = getOverallStageStatus(idx)
                  const Icon = stage.icon
                  const isCurrent = idx === currentStageIdx && effectiveState !== "COMPLETED"
                  return (
                    <Tooltip key={stage.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-current={isCurrent ? "step" : undefined}
                          aria-label={`Step ${idx + 1} of ${STAGES.length}: ${stage.label} — ${statusLabel[status]}`}
                          className="group relative flex flex-col items-center gap-2 px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          <span className="relative grid size-12 place-items-center rounded-full">
                            {isCurrent && (
                              <span
                                className={cn(
                                  "absolute inset-0 rounded-full blur-md opacity-60",
                                  status === "processing" && "bg-primary/45",
                                  status === "needs-input" && "bg-amber-500/45",
                                  status === "failed" && "bg-destructive/45",
                                )}
                              />
                            )}
                            <motion.span
                              layout
                              initial={false}
                              animate={
                                status === "completed"
                                  ? { scale: [0.9, 1.08, 1] }
                                  : status === "failed"
                                    ? { x: [0, -2, 2, -2, 2, 0] }
                                    : { scale: 1 }
                              }
                              transition={{ duration: 0.35 }}
                              className={cn(
                                "relative grid size-10 place-items-center rounded-full border-2 border-background shadow-sm transition-colors",
                                status === "completed" && "bg-linear-to-br from-emerald-400 to-emerald-600 text-white shadow-emerald-500/35",
                                status === "processing" && "bg-linear-to-br from-violet-500 to-primary text-white shadow-primary/40",
                                status === "needs-input" && "bg-linear-to-br from-amber-400 to-orange-500 text-white shadow-amber-500/40",
                                status === "failed" && "bg-linear-to-br from-rose-500 to-red-600 text-white shadow-destructive/40",
                                status === "pending" && "bg-background text-muted-foreground ring-1 ring-border group-hover:text-foreground",
                              )}
                            >
                              <AnimatePresence mode="wait" initial={false}>
                                <motion.span
                                  key={status}
                                  initial={{ scale: 0.55, opacity: 0, rotate: -45 }}
                                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                  exit={{ scale: 0.55, opacity: 0, rotate: 45 }}
                                  transition={{ duration: 0.18 }}
                                  className="grid place-items-center"
                                >
                                  {status === "completed" && <Check size={17} strokeWidth={3} />}
                                  {status === "processing" && <Loader2 size={17} className="animate-spin" strokeWidth={2.5} />}
                                  {status === "needs-input" && <HelpCircle size={17} strokeWidth={2.75} />}
                                  {status === "failed" && <X size={17} strokeWidth={3} />}
                                  {status === "pending" && <Icon size={15} strokeWidth={2.2} />}
                                </motion.span>
                              </AnimatePresence>
                            </motion.span>
                          </span>

                          <span className="flex min-w-0 flex-col items-center gap-1 text-center">
                            <span
                              className={cn(
                                "line-clamp-1 text-[12px] font-semibold leading-tight transition-colors",
                                status === "pending" ? "text-muted-foreground/70 group-hover:text-foreground/80" : "text-foreground",
                              )}
                            >
                              {stage.label}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none",
                                status === "completed" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                status === "processing" && "border-primary/20 bg-primary/10 text-primary",
                                status === "needs-input" && "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                                status === "failed" && "border-destructive/20 bg-destructive/10 text-destructive",
                                status === "pending" && "border-border/60 bg-muted/40 text-muted-foreground/75",
                              )}
                            >
                              {statusLabel[status]}
                            </span>
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-60">
                        <p className="mb-0.5 text-xs font-medium">Step {idx + 1}: {stage.label}</p>
                        <p className="text-[11px] text-muted-foreground">{stage.tooltip}</p>
                        <p className={cn("mt-1 text-[11px] font-medium", textColor[status])}>{statusLabel[status]}</p>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Row 3 — Diagrams strip */}
        {images.length > 0 && (
          <>
            <Separator />
            <div className="px-6 py-2.5 flex items-center gap-3">
              <div className="flex items-center gap-1.5 shrink-0">
                <ImageIcon size={12} className="text-muted-foreground" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Diagrams
                </p>
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] rounded-full">{images.length}</Badge>
              </div>
              <Separator orientation="vertical" className="h-6!" />
              <div className="flex gap-1.5 overflow-x-auto flex-1 scrollbar-thin">
                {images.map((img, idx) => {
                  const filename = `Image ${idx + 1}`
                  const imgInfo = STATE_INFO[img.state] || STATE_INFO.PENDING
                  const ImgStateIcon = imgInfo.icon
                  const isActive = idx === activeImageIdx
                  return (
                    <Tooltip key={img.image_id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => onImageSelect(idx)}
                          className={cn(
                            "inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all shrink-0 border",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isActive
                              ? "bg-primary/5 border-primary/30 shadow-xs"
                              : "border-border/60 hover:bg-muted/60 hover:border-border",
                          )}
                        >
                          <div className={cn(
                            "size-6 rounded-md grid place-items-center shrink-0",
                            isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                          )}>
                            <ImageIcon size={11} />
                          </div>
                          <div className="min-w-0">
                            <p className={cn("text-[12px] font-medium leading-tight truncate",
                              isActive ? "text-foreground" : "text-foreground/75",
                            )}>
                              {filename}
                            </p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <ImgStateIcon size={9} className={cn(imgInfo.color, img.state === "PROCESSING" && "animate-spin")} />
                              <span className={cn("text-[10px] leading-none", imgInfo.color)}>{imgInfo.label}</span>
                            </div>
                          </div>
                          {img.state === "COMPLETED" && <Check size={12} className="text-emerald-500 shrink-0" />}
                          {img.state === "FAILED" && <XCircle size={12} className="text-destructive shrink-0" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="font-medium text-xs">{filename}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {imgInfo.label}{img.state === "PROCESSING" && ` · ${STAGES.find(s => s.id === img.stage)?.label || img.stage}`}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

// ------------------ Sub-Components ------------------

const StatusBadge = ({ state, size = "sm" }: { state: string; size?: "sm" | "xs" }) => {
  const info = STATE_INFO[state] || STATE_INFO.PENDING
  const Icon = info.icon
  if (size === "xs") return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border ${info.bg} ${info.color} ${info.border}`}>
      <Icon size={10} className={state === "PROCESSING" ? "animate-spin" : ""} />
      {info.label}
    </span>
  )
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border ${info.bg} ${info.color} ${info.border}`}>
      <Icon size={12} className={state === "PROCESSING" ? "animate-spin" : ""} />
      {info.label}
    </span>
  )
}

// --- Failed Modal ---
const FailedModal = ({ open, onClose, onRetry, isRetrying, errorMessage }: {
  open: boolean; onClose: () => void; onRetry: () => void; isRetrying: boolean;
  errorMessage?: string | null;
}) => (
  <AnimatePresence>
    {open && (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring" as const, damping: 30, stiffness: 400 }}
          className="bg-background rounded-lg shadow-lg max-w-md w-full overflow-hidden border border-border"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2.5">
              <AlertCircle size={18} className="text-destructive shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Analysis Failed</h2>
            </div>
            <button onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="px-5 py-5 space-y-4">
            <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive font-mono">
              {errorMessage || "No error details returned."}
            </pre>
            <div className="flex gap-2.5">
              <button onClick={onClose} className="flex-1 inline-flex items-center justify-center rounded-md border border-border bg-background h-9 px-4 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors">
                Dismiss
              </button>
              <button onClick={onRetry} disabled={isRetrying}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground h-9 px-4 text-sm font-medium shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {isRetrying ? <><Loader2 size={14} className="animate-spin" /> Retrying…</> : <><RefreshCw size={14} /> Re-analyze</>}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
)

// --- Mermaid graph parsing (shared) ---

type MermaidParsedNode = { id: string; name: string; subgraph?: string }
type MermaidParsedEdge = { source: string; target: string }
type MermaidParsedGraph = { nodes: MermaidParsedNode[]; edges: MermaidParsedEdge[]; subgraphs: string[] }

const MERMAID_RESERVED_IDS = new Set([
  "subgraph", "end", "graph", "flowchart", "click", "style", "classDef", "linkStyle", "direction",
])

const MERMAID_NODE_PATTERN = /([a-zA-Z0-9_\-]+)\s*(?:\["([^"]+)"\]|\[([^\]]+)\]|\("([^"]+)"\)|\(([^)]+)\)|\{"([^"]+)"\}|\{([^}]+)\}|>([^\]]+)\])/g
const MERMAID_EDGE_PATTERN = /([a-zA-Z0-9_\-]+)\s*(?:-->|---|==>|-\.->|--x|-\.-|<-->)\s*([a-zA-Z0-9_\-]+)/g
const MERMAID_SUBGRAPH_PATTERN = /^subgraph\s+([a-zA-Z0-9_\-]+)\s*(?:\["([^"]+)"\]|\[([^\]]+)\])?/

const decodeMermaidLabel = (label: string) =>
  label
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()

const parseMermaidGraph = (source: string): MermaidParsedGraph => {
  const nodes = new Map<string, MermaidParsedNode>()
  const edges: MermaidParsedEdge[] = []
  const subgraphLabels = new Map<string, string>()
  const stack: string[] = []
  const lines = (source || "").replace(/\r\n/g, "\n").split("\n")

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%")) continue

    if (line.startsWith("subgraph ")) {
      const match = MERMAID_SUBGRAPH_PATTERN.exec(line)
      if (match) {
        const id = match[1]
        const label = match[2] || match[3] || id
        subgraphLabels.set(id, decodeMermaidLabel(label))
        stack.push(id)
      }
      continue
    }

    if (/^end\b/.test(line)) { stack.pop(); continue }
    if (/^(graph|flowchart|direction|classDef|style|click|linkStyle)\b/.test(line)) continue

    const currentSubgraph = stack[stack.length - 1]

    MERMAID_NODE_PATTERN.lastIndex = 0
    let nodeMatch: RegExpExecArray | null
    while ((nodeMatch = MERMAID_NODE_PATTERN.exec(line)) !== null) {
      const id = nodeMatch[1]
      if (MERMAID_RESERVED_IDS.has(id)) continue
      const label = decodeMermaidLabel(
        nodeMatch[2] || nodeMatch[3] || nodeMatch[4] || nodeMatch[5] || nodeMatch[6] || nodeMatch[7] || nodeMatch[8] || id
      )
      nodes.set(id, { id, name: label, subgraph: currentSubgraph })
    }

    MERMAID_EDGE_PATTERN.lastIndex = 0
    let edgeMatch: RegExpExecArray | null
    while ((edgeMatch = MERMAID_EDGE_PATTERN.exec(line)) !== null) {
      const [, source, target] = edgeMatch
      if (MERMAID_RESERVED_IDS.has(source) || MERMAID_RESERVED_IDS.has(target)) continue
      if (!nodes.has(source)) nodes.set(source, { id: source, name: source, subgraph: currentSubgraph })
      if (!nodes.has(target)) nodes.set(target, { id: target, name: target, subgraph: currentSubgraph })
      edges.push({ source, target })
    }
  }

  return {
    nodes: Array.from(nodes.values()).map((node) => ({
      ...node,
      subgraph: node.subgraph ? subgraphLabels.get(node.subgraph) || node.subgraph : undefined,
    })),
    edges,
    subgraphs: Array.from(subgraphLabels.values()),
  }
}

// --- ThreatModel Inventory types & helpers ---
// Schema based on the Surface Discovery reference (components / trust boundaries / environments / exposure)

type TMTrustLevel = "Critical" | "High" | "Medium" | "Low"
type TMExposure = "Public" | "Partner" | "Internal" | "Restricted" | "VPN"
type TMComponentType = "Client" | "Edge" | "Application" | "Data" | "External" | "Infrastructure"
type TMEnvironmentType = "External" | "Semi-Trusted" | "Internal" | "Restricted"
type TMAuthN =
  | "None"
  | "API Key"
  | "JWT"
  | "OAuth2/OIDC"
  | "mTLS"
  | "SAML"
  | "Basic"
  | "Session"
  | "Service Account"
type TMAuthZ =
  | "None"
  | "RBAC"
  | "ABAC"
  | "ACL"
  | "Policy (OPA/Cedar)"
  | "Cloud IAM"
  | "OAuth Scopes"
type TMProtocol =
  | "HTTPS"
  | "HTTPS/Token"
  | "mTLS"
  | "gRPC"
  | "SQL/TCP"
  | "TCP"
  | "WebSocket"
  | "AMQP/Kafka"

type TMComponent = {
  id: string
  name: string
  type: TMComponentType
  exposure: TMExposure
  environment: string
  trustLevel: TMTrustLevel
  authn: TMAuthN
  authz: TMAuthZ
  desc: string
}

type TMBoundary = {
  id: string
  name: string
  source: string
  destination: string
  protocol: TMProtocol
  authentication: string
  threatLevel: TMTrustLevel
}

type TMEnvironment = {
  id: string
  name: string
  type: TMEnvironmentType
  desc: string
  // Component ids that live inside this environment / trust zone.
  // Powers the per-environment "components in this zone" checkboxes and
  // is what the AI Auto-discover pre-fills.
  memberComponents: string[]
}

const TM_TRUST_LEVELS: TMTrustLevel[] = ["Critical", "High", "Medium", "Low"]
const TM_EXPOSURES: TMExposure[] = ["Public", "Partner", "Internal", "Restricted", "VPN"]
const TM_COMPONENT_TYPES: TMComponentType[] = ["Client", "Edge", "Application", "Data", "External", "Infrastructure"]
const TM_ENVIRONMENT_TYPES: TMEnvironmentType[] = ["External", "Semi-Trusted", "Internal", "Restricted"]
const TM_PROTOCOLS: TMProtocol[] = ["HTTPS", "HTTPS/Token", "mTLS", "gRPC", "SQL/TCP", "TCP", "WebSocket", "AMQP/Kafka"]
const TM_AUTHN_OPTIONS: TMAuthN[] = ["None", "API Key", "JWT", "OAuth2/OIDC", "mTLS", "SAML", "Basic", "Session", "Service Account"]
const TM_AUTHZ_OPTIONS: TMAuthZ[] = ["None", "RBAC", "ABAC", "ACL", "Policy (OPA/Cedar)", "Cloud IAM", "OAuth Scopes"]

// --- Tooltip catalog: human descriptions for every enum option ---
type TMOptionInfo<T extends string> = Record<T, string>

const TM_INFO_COMPONENT_TYPE: TMOptionInfo<TMComponentType> = {
  Client: "Browser, mobile, desktop, admin UI — initiates requests.",
  Edge: "Gateway, CDN, LB, proxy, WAF — first hop from external network.",
  Application: "Backend services, APIs, workers — runs business logic.",
  Data: "Databases, caches, object storage, queues, secrets stores.",
  External: "Third-party / partner SaaS reached over the public internet.",
  Infrastructure: "VPC, subnet, cluster, namespace, host, region.",
}
const TM_INFO_EXPOSURE: TMOptionInfo<TMExposure> = {
  Public: "Reachable from the public internet by anyone.",
  Partner: "Reachable only by specific external partners (allow-listed).",
  Internal: "Reachable across many internal systems within the org.",
  Restricted: "Reachable from a tightly scoped set (CDE, vault, secrets).",
  VPN: "Reachable only over an authenticated VPN / private link.",
}
const TM_INFO_TRUST: TMOptionInfo<TMTrustLevel> = {
  Critical: "Handles regulated data (PCI/PII/secrets); blast radius severe.",
  High: "Sensitive but not regulated; compromise impacts many users.",
  Medium: "Standard service; limited blast radius.",
  Low: "Public-facing or low-value asset.",
}
const TM_INFO_ENV_TYPE: TMOptionInfo<TMEnvironmentType> = {
  External: "Internet / untrusted networks.",
  "Semi-Trusted": "DMZ, perimeter, public subnets.",
  Internal: "Private VPCs, internal networks.",
  Restricted: "CDE, PCI, secret-bearing private subnets.",
}
const TM_INFO_AUTHN: TMOptionInfo<TMAuthN> = {
  None: "No authentication required (anonymous).",
  "API Key": "Static API key in request header.",
  JWT: "Signed JSON Web Token (bearer).",
  "OAuth2/OIDC": "OAuth 2.0 / OpenID Connect authorization-code or client-credentials flow.",
  mTLS: "Mutual TLS — caller presents a client certificate.",
  SAML: "SAML 2.0 federated SSO assertions.",
  Basic: "HTTP Basic auth (user:pass over TLS).",
  Session: "Cookie-based session bound to a server-side store.",
  "Service Account": "Workload identity (cloud IAM role / K8s SA token).",
}
const TM_INFO_AUTHZ: TMOptionInfo<TMAuthZ> = {
  None: "No authorization checks performed.",
  RBAC: "Role-based access control — coarse role → permission mapping.",
  ABAC: "Attribute-based access control — claims, tags, request attributes.",
  ACL: "Per-resource access control list (allowed identities listed on the object).",
  "Policy (OPA/Cedar)": "Externalized policy engine evaluating decision rules.",
  "Cloud IAM": "Cloud-provider IAM policies (AWS/GCP/Azure).",
  "OAuth Scopes": "Fine-grained OAuth scopes / token claims gating each endpoint.",
}
const TM_INFO_PROTOCOL: TMOptionInfo<TMProtocol> = {
  HTTPS: "TLS-encrypted HTTP.",
  "HTTPS/Token": "HTTPS with bearer token / API key.",
  mTLS: "Mutual TLS — both sides present certs.",
  gRPC: "gRPC (HTTP/2) — typically over TLS.",
  "SQL/TCP": "Database protocol over TCP (PostgreSQL, MySQL, etc.).",
  TCP: "Raw TCP — verify TLS / encryption above.",
  WebSocket: "Long-lived bidirectional WebSocket connection.",
  "AMQP/Kafka": "Async message broker (RabbitMQ / Kafka).",
}

// Migrate prior persisted shape (zone → environment, legacy enum values → new)
const TM_LEGACY_EXPOSURE_MAP: Record<string, TMExposure> = {
  High: "Public", Moderate: "Partner", Low: "Internal", Isolated: "Restricted", "Internet/Public": "Public",
}
const TM_LEGACY_TYPE_MAP: Record<string, TMComponentType> = {
  Microservice: "Application", Proxy: "Edge", Gateway: "Edge", Firewall: "Edge",
  Vault: "Data", Database: "Data",
}

const migrateTMComponent = (raw: any): TMComponent => {
  const type: TMComponentType = TM_COMPONENT_TYPES.includes(raw?.type)
    ? raw.type
    : TM_LEGACY_TYPE_MAP[raw?.type as string] || "Application"
  const exposure: TMExposure = TM_EXPOSURES.includes(raw?.exposure)
    ? raw.exposure
    : TM_LEGACY_EXPOSURE_MAP[raw?.exposure as string] || "Internal"
  const trustLevel: TMTrustLevel = TM_TRUST_LEVELS.includes(raw?.trustLevel) ? raw.trustLevel : "Medium"
  const authn: TMAuthN = TM_AUTHN_OPTIONS.includes(raw?.authn) ? raw.authn : "None"
  const authz: TMAuthZ = TM_AUTHZ_OPTIONS.includes(raw?.authz) ? raw.authz : "None"
  return {
    id: String(raw?.id || `manual-${Date.now()}`),
    name: String(raw?.name || ""),
    type,
    exposure,
    environment: String(raw?.environment || raw?.zone || "Unspecified Environment"),
    trustLevel,
    authn,
    authz,
    desc: String(raw?.desc || ""),
  }
}

const migrateTMBoundary = (raw: any): TMBoundary => {
  const protocol: TMProtocol = TM_PROTOCOLS.includes(raw?.protocol) ? raw.protocol
    : raw?.protocol === "gRPC/Internal" ? "gRPC"
    : raw?.protocol === "mTLS/TCP" ? "mTLS"
    : "HTTPS"
  const threatLevel: TMTrustLevel = TM_TRUST_LEVELS.includes(raw?.threatLevel) ? raw.threatLevel : "Medium"
  return {
    id: String(raw?.id || `manual-${Date.now()}`),
    name: String(raw?.name || ""),
    source: String(raw?.source || ""),
    destination: String(raw?.destination || ""),
    protocol,
    authentication: String(raw?.authentication || "TLS 1.3"),
    threatLevel,
  }
}

const migrateTMEnvironment = (raw: any): TMEnvironment => {
  const type: TMEnvironmentType = TM_ENVIRONMENT_TYPES.includes(raw?.type) ? raw.type : "Internal"
  const rawMembers = raw?.member_components ?? raw?.memberComponents ?? []
  const memberComponents: string[] = Array.isArray(rawMembers)
    ? rawMembers.map((m: unknown) => String(m)).filter(Boolean)
    : []
  return {
    id: String(raw?.id || `manual-env-${Date.now()}`),
    name: String(raw?.name || ""),
    type,
    desc: String(raw?.desc || ""),
    memberComponents,
  }
}

const inferTMComponentType = (id: string, name: string): TMComponentType => {
  const haystack = `${id} ${name}`.toLowerCase()
  if (/(third.?party|partner|vendor|saas|stripe|razorpay|payu|kyc)/.test(haystack)) return "External"
  if (/(client|browser|mobile|desktop|portal|frontend|admin.?ui|webapp)/.test(haystack)) return "Client"
  if (/(gateway|cdn|edge|alb|elb|load.?balancer|nginx|proxy|envoy|haproxy|firewall|waf|ingress)/.test(haystack)) return "Edge"
  if (/(db|database|sql|mongo|cache|redis|store|bucket|s3|vault|hsm|kms|queue|topic|broker|kafka)/.test(haystack)) return "Data"
  if (/(vpc|subnet|cluster|namespace|pod|container|vm|ec2|node|region|zone)/.test(haystack)) return "Infrastructure"
  return "Application"
}

const inferTMEnvironmentType = (name: string): TMEnvironmentType => {
  const n = name.toLowerCase()
  if (/internet|public|external/.test(n)) return "External"
  if (/dmz|perimeter|edge/.test(n)) return "Semi-Trusted"
  if (/private|restricted|cde|pci|isolated|secure|vault|hsm/.test(n)) return "Restricted"
  return "Internal"
}

const inferTMExposure = (environment: string, type: TMComponentType): TMExposure => {
  const e = environment.toLowerCase()
  if (type === "External" || /partner|vendor|third.?party/.test(e)) return "Partner"
  if (type === "Client" || type === "Edge" || /public|internet|external|dmz/.test(e)) return "Public"
  if (/private|restricted|cde|pci|isolated|secure/.test(e)) return "Restricted"
  if (/vpn|tunnel/.test(e)) return "VPN"
  return "Internal"
}

const inferTMTrustLevel = (environment: string, exposure: TMExposure): TMTrustLevel => {
  const e = environment.toLowerCase()
  if (/cde|pci|vault|critical|secure|hsm/.test(e)) return "Critical"
  if (exposure === "Restricted") return "High"
  if (exposure === "Public" || exposure === "Partner") return "Low"
  return "Medium"
}

const inferTMAuthN = (type: TMComponentType, exposure: TMExposure): TMAuthN => {
  if (type === "Client") return "OAuth2/OIDC"
  if (type === "External") return "API Key"
  if (type === "Data") return "Service Account"
  if (type === "Edge") return exposure === "Public" ? "JWT" : "mTLS"
  if (exposure === "Public") return "JWT"
  return "Service Account"
}

const inferTMAuthZ = (type: TMComponentType, exposure: TMExposure): TMAuthZ => {
  if (type === "Data") return "Cloud IAM"
  if (type === "External") return "OAuth Scopes"
  if (exposure === "Public" || exposure === "Partner") return "OAuth Scopes"
  return "RBAC"
}

const inferTMThreatLevel = (source: string, destination: string): TMTrustLevel => {
  const s = source.toLowerCase()
  const d = destination.toLowerCase()
  const crossesPCI = (/cde|pci/.test(s) && !/cde|pci/.test(d)) || (!/cde|pci/.test(s) && /cde|pci/.test(d))
  const crossesPublic = /public|internet|external/.test(s) || /public|internet|external/.test(d)
  if (crossesPCI) return "Critical"
  if (crossesPublic) return "High"
  if (/dmz|perimeter|edge/.test(s) || /dmz|perimeter|edge/.test(d)) return "Medium"
  return "Low"
}

const reconcileTMComponents = (prev: TMComponent[], parsed: MermaidParsedGraph): TMComponent[] => {
  const next = parsed.nodes.map<TMComponent>((node) => {
    const existing = prev.find((c) => c.id === node.id)
    const environment = node.subgraph || existing?.environment || "Unspecified Environment"
    if (existing) {
      return { ...existing, name: node.name, environment: existing.environment || environment }
    }
    const type = inferTMComponentType(node.id, node.name)
    const exposure = inferTMExposure(environment, type)
    return {
      id: node.id,
      name: node.name,
      type,
      exposure,
      environment,
      trustLevel: inferTMTrustLevel(environment, exposure),
      authn: inferTMAuthN(type, exposure),
      authz: inferTMAuthZ(type, exposure),
      desc: "",
    }
  })
  const parsedIds = new Set(parsed.nodes.map((n) => n.id))
  const manual = prev.filter((c) => !parsedIds.has(c.id) && c.id.startsWith("manual-"))
  return [...next, ...manual]
}

const reconcileTMBoundaries = (prev: TMBoundary[], parsed: MermaidParsedGraph): TMBoundary[] => {
  const nodeById = new Map(parsed.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const next: TMBoundary[] = []
  for (const edge of parsed.edges) {
    const key = `${edge.source}__${edge.target}`
    if (seen.has(key)) continue
    seen.add(key)
    const id = `edge-${key}`
    const sourceNode = nodeById.get(edge.source)
    const targetNode = nodeById.get(edge.target)
    if (!sourceNode || !targetNode) continue
    const sourceEnv = sourceNode.subgraph || sourceNode.name
    const targetEnv = targetNode.subgraph || targetNode.name
    const existing = prev.find((b) => b.id === id)
    if (existing) {
      next.push({
        ...existing,
        name: existing.name || `${sourceEnv} → ${targetEnv}`,
        source: existing.source || sourceEnv,
        destination: existing.destination || targetEnv,
      })
      continue
    }
    next.push({
      id,
      name: `${sourceEnv} → ${targetEnv}`,
      source: sourceEnv,
      destination: targetEnv,
      protocol: "HTTPS",
      authentication: "TLS 1.3",
      threatLevel: inferTMThreatLevel(sourceEnv, targetEnv),
    })
  }
  const manual = prev.filter((b) => b.id.startsWith("manual-"))
  return [...next, ...manual]
}

const reconcileTMEnvironments = (
  prev: TMEnvironment[],
  parsed: MermaidParsedGraph,
  components: TMComponent[]
): TMEnvironment[] => {
  const names = new Set<string>()
  parsed.subgraphs.forEach((s) => names.add(s))
  components.forEach((c) => { if (c.environment) names.add(c.environment) })

  // For each env name, derive the set of component ids that live there. We
  // union the AI-pre-filled membership with the always-true rule that any
  // component whose `environment` field matches this env name belongs to it.
  const componentIdsByEnvName = new Map<string, Set<string>>()
  components.forEach((c) => {
    if (!c.environment) return
    const set = componentIdsByEnvName.get(c.environment) ?? new Set<string>()
    set.add(c.id)
    componentIdsByEnvName.set(c.environment, set)
  })
  const liveComponentIds = new Set(components.map((c) => c.id))

  const next: TMEnvironment[] = []
  for (const name of names) {
    const id = `env-${name}`
    const existing = prev.find((e) => e.id === id || e.name === name)
    const derived = componentIdsByEnvName.get(name) ?? new Set<string>()
    const preserved = (existing?.memberComponents ?? []).filter((cid) => liveComponentIds.has(cid))
    const merged = Array.from(new Set<string>([...preserved, ...derived]))
    if (existing) {
      next.push({ ...existing, id, name, memberComponents: merged })
    } else {
      next.push({
        id,
        name,
        type: inferTMEnvironmentType(name),
        desc: "",
        memberComponents: merged,
      })
    }
  }
  const manual = prev
    .filter((e) => e.id.startsWith("manual-env-"))
    .map((e) => ({
      ...e,
      memberComponents: (e.memberComponents ?? []).filter((cid) => liveComponentIds.has(cid)),
    }))
  return [...next, ...manual]
}

const getTMTrustClass = (level: TMTrustLevel) => {
  switch (level) {
    case "Critical": return "bg-red-500/15 border-red-500/30 text-red-500 dark:text-red-400"
    case "High": return "bg-orange-500/15 border-orange-500/30 text-orange-500 dark:text-orange-400"
    case "Medium": return "bg-indigo-500/15 border-indigo-500/30 text-indigo-500 dark:text-indigo-400"
    default: return "bg-slate-500/15 border-slate-500/30 text-slate-500 dark:text-slate-400"
  }
}

const getTMRiskClass = (level: TMTrustLevel) => {
  switch (level) {
    case "Critical": return "bg-red-500/15 border-red-500/30 text-red-500 dark:text-red-400"
    case "High": return "bg-amber-500/15 border-amber-500/30 text-amber-500 dark:text-amber-400"
    case "Medium": return "bg-yellow-500/15 border-yellow-500/30 text-yellow-600 dark:text-yellow-400"
    default: return "bg-emerald-500/15 border-emerald-500/30 text-emerald-500 dark:text-emerald-400"
  }
}

const getTMExposureClass = (level: TMExposure) => {
  switch (level) {
    case "Public": return "bg-rose-500/15 border-rose-500/30 text-rose-500 dark:text-rose-400"
    case "Partner": return "bg-amber-500/15 border-amber-500/30 text-amber-500 dark:text-amber-400"
    case "Internal": return "bg-sky-500/15 border-sky-500/30 text-sky-500 dark:text-sky-400"
    case "Restricted": return "bg-emerald-500/15 border-emerald-500/30 text-emerald-500 dark:text-emerald-400"
    case "VPN": return "bg-violet-500/15 border-violet-500/30 text-violet-500 dark:text-violet-400"
  }
}

const getTMEnvClass = (type: TMEnvironmentType) => {
  switch (type) {
    case "External": return "bg-rose-500/15 border-rose-500/30 text-rose-500 dark:text-rose-400"
    case "Semi-Trusted": return "bg-amber-500/15 border-amber-500/30 text-amber-500 dark:text-amber-400"
    case "Internal": return "bg-sky-500/15 border-sky-500/30 text-sky-500 dark:text-sky-400"
    case "Restricted": return "bg-emerald-500/15 border-emerald-500/30 text-emerald-500 dark:text-emerald-400"
  }
}

// Reusable info-tooltip — used next to enum dropdown labels to explain each option.
const EnumInfo = <T extends string>({
  title,
  options,
  info,
}: {
  title: string
  options: readonly T[]
  info: TMOptionInfo<T>
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`About ${title}`}
        onClick={(e) => e.preventDefault()}
      >
        <Info className="size-3" />
      </button>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      align="start"
      className="max-w-sm border bg-popover text-popover-foreground shadow-md"
    >
      <div className="space-y-1.5 p-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {title}
        </div>
        <dl className="space-y-1 text-[11px]">
          {options.map((opt) => (
            <div key={opt} className="leading-snug">
              <span className="font-semibold text-foreground">{opt}</span>
              <span className="text-muted-foreground"> — {info[opt]}</span>
            </div>
          ))}
        </dl>
      </div>
    </TooltipContent>
  </Tooltip>
)

// --- ThreatModel Inventory ---

const ThreatModelInventory = ({
  code,
  persistKey,
  assessmentId,
  imageId,
  imageState,
  imageStage,
}: {
  code: string;
  persistKey?: string;
  assessmentId?: string;
  imageId?: string;
  /** Backend state of THIS image row — controls the "still generating" placeholder. */
  imageState?: string;
  imageStage?: string;
}) => {
  const storageKey = persistKey ? `tm-inventory:${persistKey}` : null
  // API persistence is enabled only when both ids are known. Otherwise we
  // silently fall back to localStorage so the UI still works in isolation.
  const apiEnabled = Boolean(assessmentId && imageId)

  const [components, setComponents] = useState<TMComponent[]>([])
  const [boundaries, setBoundaries] = useState<TMBoundary[]>([])
  const [environments, setEnvironments] = useState<TMEnvironment[]>([])
  const [initialized, setInitialized] = useState(false)

  const [compSearch, setCompSearch] = useState("")
  const [boundarySearch, setBoundarySearch] = useState("")
  const [envSearch, setEnvSearch] = useState("")

  const [selectedCompIds, setSelectedCompIds] = useState<string[]>([])
  const [selectedBoundaryIds, setSelectedBoundaryIds] = useState<string[]>([])
  const [selectedEnvIds, setSelectedEnvIds] = useState<string[]>([])

  const [showAddCompModal, setShowAddCompModal] = useState(false)
  const [newComp, setNewComp] = useState<Omit<TMComponent, "id">>({
    name: "", environment: "Internal Network", trustLevel: "Medium", exposure: "Internal", type: "Application",
    authn: "JWT", authz: "RBAC", desc: "",
  })

  const [showAddBoundaryModal, setShowAddBoundaryModal] = useState(false)
  const [newBoundary, setNewBoundary] = useState<Omit<TMBoundary, "id">>({
    name: "", source: "Public Network", destination: "Internal Network", protocol: "HTTPS", authentication: "TLS 1.3", threatLevel: "Medium",
  })

  const [showAddEnvModal, setShowAddEnvModal] = useState(false)
  const [newEnv, setNewEnv] = useState<Omit<TMEnvironment, "id">>({
    name: "", type: "Internal", desc: "", memberComponents: [],
  })

  // Track save state for the API debounce + a ref to suppress the very next
  // save after a fresh hydrate/import (avoids POSTing back what we just read).
  const skipNextPersistRef = useRef(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")

  // Hydrate from API first (if available), then fall back to localStorage.
  useEffect(() => {
    let cancelled = false
    const hydrateFromLocal = () => {
      if (!storageKey) return
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed.components)) setComponents(parsed.components.map(migrateTMComponent))
          if (Array.isArray(parsed.boundaries)) setBoundaries(parsed.boundaries.map(migrateTMBoundary))
          if (Array.isArray(parsed.environments)) setEnvironments(parsed.environments.map(migrateTMEnvironment))
        }
      } catch { /* ignore */ }
    }

    const run = async () => {
      if (apiEnabled) {
        try {
          const res = await api.get(`/threat_modeling/${assessmentId}/surface-map/${imageId}`)
          const sm = res?.data?.surface_map
          if (!cancelled && sm) {
            const comps = Array.isArray(sm.components) ? sm.components.map(migrateTMComponent) : []
            const bounds = Array.isArray(sm.trust_boundaries) ? sm.trust_boundaries.map(migrateTMBoundary) : []
            const envs = Array.isArray(sm.environments) ? sm.environments.map(migrateTMEnvironment) : []
            // Only blow away local state when the server actually has data.
            if (comps.length || bounds.length || envs.length) {
              setComponents(comps)
              setBoundaries(bounds)
              setEnvironments(envs)
              skipNextPersistRef.current = true
            } else {
              hydrateFromLocal()
            }
          }
        } catch {
          // API failed — degrade gracefully to localStorage.
          hydrateFromLocal()
        }
      } else {
        hydrateFromLocal()
      }
      if (!cancelled) {
        setInitialized(true)
      }
    }
    run()
    return () => { cancelled = true }
  }, [storageKey, apiEnabled, assessmentId, imageId])

  // Re-hydrate when Phase A finishes.
  // The initial hydrate above runs once and, if the surface_map row didn't
  // yet exist at first mount, leaves the inventory empty. The parent poll
  // (`fetchData` in the page) flips `imageState` from PROCESSING to
  // AWAITING_REVIEW / COMPLETED once the backend has persisted the row —
  // that's our cue to fetch again so the user doesn't have to reload the
  // page to see the auto-populated components.
  useEffect(() => {
    if (!apiEnabled || !initialized) return
    // Only trigger when Phase A is definitely done. Anything not PENDING
    // and not PROCESSING means the pipeline has moved past the point
    // where auto_populate_surface_map runs.
    if (imageState === "PENDING" || imageState === "PROCESSING" || !imageState) return
    // If we already have local data, do nothing — a stale re-fetch would
    // clobber the user's manual edits (persist runs on every change and
    // eventually reconciles anyway).
    if (components.length || boundaries.length || environments.length) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get(`/threat_modeling/${assessmentId}/surface-map/${imageId}`)
        const sm = res?.data?.surface_map
        if (cancelled || !sm) return
        const comps = Array.isArray(sm.components) ? sm.components.map(migrateTMComponent) : []
        const bounds = Array.isArray(sm.trust_boundaries) ? sm.trust_boundaries.map(migrateTMBoundary) : []
        const envs = Array.isArray(sm.environments) ? sm.environments.map(migrateTMEnvironment) : []
        if (comps.length || bounds.length || envs.length) {
          setComponents(comps)
          setBoundaries(bounds)
          setEnvironments(envs)
          // The very next persist would round-trip the value we just read
          // back to the server — no-op, but wastes a PUT and creates a
          // noisy save-flash. Skip it.
          skipNextPersistRef.current = true
        }
      } catch { /* leave inventory empty — user can retry manually */ }
    })()
    return () => { cancelled = true }
    // Include the array lengths so the effect re-evaluates the "already
    // have data" guard when things actually land — otherwise we'd only
    // check that condition at effect-mount and could loop against a stale
    // read.
  }, [imageState, initialized, apiEnabled, assessmentId, imageId, components.length, boundaries.length, environments.length])

  // Persist: localStorage immediately, API debounced.
  useEffect(() => {
    if (!initialized) return
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ components, boundaries, environments }))
      } catch { /* ignore */ }
    }
    if (!apiEnabled) return
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }

    setSaveState("saving")
    const t = setTimeout(async () => {
      try {
        await api.put(`/threat_modeling/${assessmentId}/surface-map/${imageId}`, {
          components: components.map((c) => ({
            id: c.id, name: c.name, type: c.type, environment: c.environment,
            exposure: c.exposure, trust_level: c.trustLevel,
            authn: c.authn, authz: c.authz, desc: c.desc,
          })),
          trust_boundaries: boundaries.map((b) => ({
            id: b.id, name: b.name, source: b.source, destination: b.destination,
            protocol: b.protocol, authentication: b.authentication, threat_level: b.threatLevel,
          })),
          environments: environments.map((e) => ({
            id: e.id, name: e.name, type: e.type, desc: e.desc,
            member_components: e.memberComponents,
          })),
          mermaid: code,
        })
        setSaveState("saved")
      } catch {
        setSaveState("error")
      }
    }, 800)
    return () => clearTimeout(t)
  }, [components, boundaries, environments, storageKey, initialized, apiEnabled, assessmentId, imageId, code])

  useEffect(() => {
    setSelectedCompIds((prev) => prev.filter((id) => components.some((c) => c.id === id)))
  }, [components])

  useEffect(() => {
    setSelectedBoundaryIds((prev) => prev.filter((id) => boundaries.some((b) => b.id === id)))
  }, [boundaries])

  useEffect(() => {
    setSelectedEnvIds((prev) => prev.filter((id) => environments.some((e) => e.id === id)))
  }, [environments])

  const filteredComponents = useMemo(() => {
    const term = compSearch.trim().toLowerCase()
    if (!term) return components
    return components.filter((c) =>
      [c.name, c.environment, c.type, c.exposure, c.desc].join(" ").toLowerCase().includes(term)
    )
  }, [components, compSearch])

  const filteredBoundaries = useMemo(() => {
    const term = boundarySearch.trim().toLowerCase()
    if (!term) return boundaries
    return boundaries.filter((b) =>
      [b.name, b.source, b.destination, b.protocol, b.authentication].join(" ").toLowerCase().includes(term)
    )
  }, [boundaries, boundarySearch])

  const filteredEnvironments = useMemo(() => {
    const term = envSearch.trim().toLowerCase()
    if (!term) return environments
    return environments.filter((e) =>
      [e.name, e.type, e.desc].join(" ").toLowerCase().includes(term)
    )
  }, [environments, envSearch])

  const publicCount = useMemo(() => components.filter((c) => c.exposure === "Public").length, [components])
  const knownEnvironmentNames = useMemo(() => {
    const names = new Set<string>()
    environments.forEach((e) => names.add(e.name))
    components.forEach((c) => { if (c.environment) names.add(c.environment) })
    return Array.from(names)
  }, [environments, components])

  const compHeaderState: boolean | "indeterminate" = filteredComponents.length > 0 && filteredComponents.every((c) => selectedCompIds.includes(c.id))
    ? true
    : selectedCompIds.length > 0 ? "indeterminate" : false

  const boundaryHeaderState: boolean | "indeterminate" = filteredBoundaries.length > 0 && filteredBoundaries.every((b) => selectedBoundaryIds.includes(b.id))
    ? true
    : selectedBoundaryIds.length > 0 ? "indeterminate" : false

  const envHeaderState: boolean | "indeterminate" = filteredEnvironments.length > 0 && filteredEnvironments.every((e) => selectedEnvIds.includes(e.id))
    ? true
    : selectedEnvIds.length > 0 ? "indeterminate" : false

  // Component handlers
  const handleSelectAllComponents = () => {
    const filteredIds = filteredComponents.map((c) => c.id)
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedCompIds.includes(id))
    setSelectedCompIds((prev) => allSelected
      ? prev.filter((id) => !filteredIds.includes(id))
      : Array.from(new Set([...prev, ...filteredIds])))
  }

  const handleToggleComponentSelection = (id: string) => {
    setSelectedCompIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const handleBulkCompTrustChange = (trustLevel: TMTrustLevel) => {
    setComponents((prev) => prev.map((c) => selectedCompIds.includes(c.id) ? { ...c, trustLevel } : c))
    toast.success(`Trust level set to ${trustLevel}`)
  }

  const handleBulkCompExposureChange = (exposure: TMExposure) => {
    setComponents((prev) => prev.map((c) => selectedCompIds.includes(c.id) ? { ...c, exposure } : c))
    toast.success(`Exposure set to ${exposure}`)
  }

  const handleBulkCompDelete = () => {
    const n = selectedCompIds.length
    setComponents((prev) => prev.filter((c) => !selectedCompIds.includes(c.id)))
    setSelectedCompIds([])
    toast.success(`Deleted ${n} component${n === 1 ? "" : "s"}`)
  }

  const updateComponentField = <K extends keyof TMComponent>(id: string, field: K, value: TMComponent[K]) => {
    setComponents((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c))
  }

  const deleteComponent = (id: string) => {
    setComponents((prev) => prev.filter((c) => c.id !== id))
    toast.success("Component removed")
  }

  const addComponentHandler = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newComp.name.trim()) { toast.error("Component name is required"); return }
    const id = `manual-${Date.now()}`
    setComponents((prev) => [...prev, { ...newComp, id }])
    setShowAddCompModal(false)
    setNewComp({
      name: "", environment: "Internal Network", trustLevel: "Medium", exposure: "Internal", type: "Application",
      authn: "JWT", authz: "RBAC", desc: "",
    })
    toast.success("Component registered")
  }

  // Boundary handlers
  const handleSelectAllBoundaries = () => {
    const filteredIds = filteredBoundaries.map((b) => b.id)
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedBoundaryIds.includes(id))
    setSelectedBoundaryIds((prev) => allSelected
      ? prev.filter((id) => !filteredIds.includes(id))
      : Array.from(new Set([...prev, ...filteredIds])))
  }

  const handleToggleBoundarySelection = (id: string) => {
    setSelectedBoundaryIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const handleBulkBoundaryRiskChange = (threatLevel: TMTrustLevel) => {
    setBoundaries((prev) => prev.map((b) => selectedBoundaryIds.includes(b.id) ? { ...b, threatLevel } : b))
    toast.success(`Threat level set to ${threatLevel}`)
  }

  const handleBulkBoundaryProtocolChange = (protocol: TMProtocol) => {
    setBoundaries((prev) => prev.map((b) => selectedBoundaryIds.includes(b.id) ? { ...b, protocol } : b))
    toast.success(`Protocol set to ${protocol}`)
  }

  const handleBulkBoundaryDelete = () => {
    const n = selectedBoundaryIds.length
    setBoundaries((prev) => prev.filter((b) => !selectedBoundaryIds.includes(b.id)))
    setSelectedBoundaryIds([])
    toast.success(`Deleted ${n} boundar${n === 1 ? "y" : "ies"}`)
  }

  const updateBoundaryField = <K extends keyof TMBoundary>(id: string, field: K, value: TMBoundary[K]) => {
    setBoundaries((prev) => prev.map((b) => b.id === id ? { ...b, [field]: value } : b))
  }

  const deleteBoundary = (id: string) => {
    setBoundaries((prev) => prev.filter((b) => b.id !== id))
    toast.success("Boundary removed")
  }

  const addBoundaryHandler = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newBoundary.name.trim()) { toast.error("Boundary name is required"); return }
    const id = `manual-${Date.now()}`
    setBoundaries((prev) => [...prev, { ...newBoundary, id }])
    setShowAddBoundaryModal(false)
    setNewBoundary({ name: "", source: "Public Network", destination: "Internal Network", protocol: "HTTPS", authentication: "TLS 1.3", threatLevel: "Medium" })
    toast.success("Boundary registered")
  }

  // Environment handlers
  const handleSelectAllEnvironments = () => {
    const filteredIds = filteredEnvironments.map((e) => e.id)
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedEnvIds.includes(id))
    setSelectedEnvIds((prev) => allSelected
      ? prev.filter((id) => !filteredIds.includes(id))
      : Array.from(new Set([...prev, ...filteredIds])))
  }

  const handleToggleEnvironmentSelection = (id: string) => {
    setSelectedEnvIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const handleBulkEnvTypeChange = (type: TMEnvironmentType) => {
    setEnvironments((prev) => prev.map((e) => selectedEnvIds.includes(e.id) ? { ...e, type } : e))
    toast.success(`Environment type set to ${type}`)
  }

  const handleBulkEnvDelete = () => {
    const n = selectedEnvIds.length
    setEnvironments((prev) => prev.filter((e) => !selectedEnvIds.includes(e.id)))
    setSelectedEnvIds([])
    toast.success(`Deleted ${n} environment${n === 1 ? "" : "s"}`)
  }

  const updateEnvironmentField = <K extends keyof TMEnvironment>(id: string, field: K, value: TMEnvironment[K]) => {
    setEnvironments((prev) => {
      // If renaming, propagate to components.environment that referenced the old name
      if (field === "name") {
        const target = prev.find((e) => e.id === id)
        const oldName = target?.name
        const newName = value as unknown as string
        if (target && oldName && oldName !== newName) {
          setComponents((comps) => comps.map((c) => c.environment === oldName ? { ...c, environment: newName } : c))
        }
      }
      return prev.map((e) => e.id === id ? { ...e, [field]: value } : e)
    })
  }

  const deleteEnvironment = (id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id))
    toast.success("Environment removed")
  }

  const addEnvironmentHandler = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newEnv.name.trim()) { toast.error("Trust boundary name is required"); return }
    const id = `manual-env-${Date.now()}`
    const name = newEnv.name.trim()
    const picked = newEnv.memberComponents
    // Insert the new boundary, and strip any picked components from other
    // boundaries' member lists (one component lives in one boundary).
    setEnvironments((prev) => [
      ...prev.map((e) => (
        picked.length === 0
          ? e
          : { ...e, memberComponents: e.memberComponents.filter((cid) => !picked.includes(cid)) }
      )),
      { ...newEnv, id, name },
    ])
    // Point the chosen components at the new boundary's name.
    if (picked.length > 0) {
      setComponents((prev) =>
        prev.map((c) => (picked.includes(c.id) ? { ...c, environment: name } : c))
      )
    }
    setShowAddEnvModal(false)
    setNewEnv({ name: "", type: "Internal", desc: "", memberComponents: [] })
    toast.success("Trust boundary registered")
  }

  // Toggle a component's membership in one environment. We treat membership
  // as a property of the environment (env.memberComponents) so the per-env
  // checkbox list is the single source of truth; the component's own
  // `environment` field is kept in sync to whichever env was checked last.
  const toggleEnvMember = (envId: string, componentId: string) => {
    type Membership = { envName: string; checked: boolean }
    let nextMembership: Membership | null = null
    setEnvironments((prev) =>
      prev.map((e) => {
        if (e.id !== envId) return e
        const has = e.memberComponents.includes(componentId)
        nextMembership = { envName: e.name, checked: !has } as Membership
        return {
          ...e,
          memberComponents: has
            ? e.memberComponents.filter((id) => id !== componentId)
            : [...e.memberComponents, componentId],
        }
      })
    )
    const membership = nextMembership as Membership | null
    if (membership?.checked) {
      // When a box is checked, set the component's environment to this env
      // and remove the component from every other env's membership list.
      setComponents((prev) =>
        prev.map((c) => (c.id === componentId ? { ...c, environment: membership.envName } : c))
      )
      setEnvironments((prev) =>
        prev.map((e) =>
          e.id === envId
            ? e
            : { ...e, memberComponents: e.memberComponents.filter((id) => id !== componentId) }
        )
      )
    }
  }

  const [autoDiscoverLoading, setAutoDiscoverLoading] = useState(false)

  // Calls the backend Surface Discovery skill for this image and replaces
  // the inventory with the AI-generated payload (components + environments
  // + cross-zone trust boundaries — boundaries are persisted but no longer
  // surfaced in the UI).
  const handleAutoDiscover = async () => {
    if (!apiEnabled) {
      toast.error("Auto-discover requires an active assessment image")
      return
    }
    setAutoDiscoverLoading(true)
    try {
      const res = await api.post(
        `/threat_modeling/${assessmentId}/surface-map/${imageId}/generate?save=true&overwrite=true`
      )
      const sm = res?.data?.surface_map
      if (sm) {
        const comps = Array.isArray(sm.components) ? sm.components.map(migrateTMComponent) : []
        const bounds = Array.isArray(sm.trust_boundaries) ? sm.trust_boundaries.map(migrateTMBoundary) : []
        const envs = Array.isArray(sm.environments) ? sm.environments.map(migrateTMEnvironment) : []
        setComponents(comps)
        setBoundaries(bounds)
        setEnvironments(envs)
        skipNextPersistRef.current = true
        toast.success(`Discovered ${comps.length} components across ${envs.length} trust zones`)
      } else {
        toast.error("Surface discovery returned an empty payload")
      }
    } catch (err) {
      console.error("surface discovery failed", err)
      toast.error("Auto-discover failed. Check server logs.")
    } finally {
      setAutoDiscoverLoading(false)
    }
  }

  // Bulk component-type setter (Surface Discovery taxonomy)
  const handleBulkCompTypeChange = (type: TMComponentType) => {
    setComponents((prev) => prev.map((c) => selectedCompIds.includes(c.id) ? { ...c, type } : c))
    toast.success(`Type set to ${type}`)
  }

  const handleBulkCompAuthNChange = (authn: TMAuthN) => {
    setComponents((prev) => prev.map((c) => selectedCompIds.includes(c.id) ? { ...c, authn } : c))
    toast.success(`AuthN set to ${authn}`)
  }

  const handleBulkCompAuthZChange = (authz: TMAuthZ) => {
    setComponents((prev) => prev.map((c) => selectedCompIds.includes(c.id) ? { ...c, authz } : c))
    toast.success(`AuthZ set to ${authz}`)
  }

  const componentTypeIcon = (type: TMComponentType) => {
    if (type === "Data") return <Database className="size-3.5 text-indigo-500 dark:text-indigo-400" />
    if (type === "External") return <Globe className="size-3.5 text-rose-500 dark:text-rose-400" />
    if (type === "Client") return <Users className="size-3.5 text-emerald-500 dark:text-emerald-400" />
    if (type === "Edge") return <ShieldAlert className="size-3.5 text-amber-500 dark:text-amber-400" />
    if (type === "Infrastructure") return <Layers className="size-3.5 text-sky-500 dark:text-sky-400" />
    return <Server className="size-3.5 text-muted-foreground" />
  }

  // While Phase A is still running, the surface_map row doesn't exist yet.
  // Show a "generating…" placeholder instead of an empty inventory so the
  // user knows to wait rather than assume something failed.
  const isGeneratingInventory =
    initialized &&
    components.length === 0 &&
    boundaries.length === 0 &&
    environments.length === 0 &&
    (imageState === "PROCESSING" || imageState === "PENDING")

  if (isGeneratingInventory) {
    const stageMeta = STAGES.find((s) => s.id === imageStage)
    const stageLabel = stageMeta?.label ?? imageStage ?? "Analysing diagram"
    const StageIcon = stageMeta?.icon ?? Loader2
    return (
      <TooltipProvider delayDuration={150}>
        <Card className="overflow-hidden py-0 gap-0">
          <CardHeader className="border-b bg-muted/30 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="size-9 grid place-items-center rounded-lg border bg-background text-primary">
                <ShieldCheck className="size-4" />
              </div>
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-sm">
                  ThreatModeller Inventory
                  <Badge variant="secondary" className="gap-1 text-[10px] font-medium">
                    <Loader2 className="size-3 animate-spin" />
                    Generating
                  </Badge>
                </CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Waiting for Phase A to finish extracting components.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-5 py-10">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative">
                <div className="size-14 grid place-items-center rounded-full border-2 border-primary/30 bg-primary/5">
                  <StageIcon className={cn("size-6 text-primary", StageIcon === Loader2 && "animate-spin")} />
                </div>
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-primary/40"
                  animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{stageLabel}</p>
                <p className="text-xs text-muted-foreground">
                  Components, environments, and trust boundaries will appear here once the
                  backend finishes analysing the diagram.
                </p>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                <span>This usually takes 15–60 seconds per image.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
    <Card className="overflow-hidden py-0 gap-0">
      <CardHeader className="border-b bg-muted/30 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="size-9 grid place-items-center rounded-lg border bg-background text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              ThreatModeller Inventory
              <Badge variant="secondary" className="text-[10px] font-medium">AI Generated</Badge>
              {apiEnabled && (
                <span
                  className={cn(
                    "group inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-tight backdrop-blur-sm transition-all",
                    saveState === "saving" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 shadow-[0_0_0_3px_rgba(245,158,11,0.06)]",
                    saveState === "saved" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shadow-[0_0_0_3px_rgba(16,185,129,0.06)]",
                    saveState === "error" && "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 shadow-[0_0_0_3px_rgba(244,63,94,0.06)]",
                    saveState === "idle" && "border-border bg-muted/50 text-muted-foreground",
                  )}
                  title="Surface map sync status"
                  aria-live="polite"
                >
                  <span className="relative flex size-1.5">
                    {saveState === "saving" && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
                    )}
                    <span
                      className={cn(
                        "relative inline-flex size-1.5 rounded-full",
                        saveState === "saving" && "bg-amber-500",
                        saveState === "saved" && "bg-emerald-500",
                        saveState === "error" && "bg-rose-500",
                        saveState === "idle" && "bg-muted-foreground/60",
                      )}
                    />
                  </span>
                  {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Synced"}
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Components, trust boundaries & environments identified by AI from the diagram. Edits autosave.
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <div className="flex flex-wrap items-center gap-2">
            {apiEnabled && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleAutoDiscover}
                disabled={autoDiscoverLoading}
              >
                {autoDiscoverLoading ? <Loader2 className="animate-spin" /> : <Wand2 />}
                {autoDiscoverLoading ? "Discovering…" : "Auto-discover with AI"}
              </Button>
            )}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6 p-5">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid size-9 place-items-center rounded-md border bg-background text-primary">
              <Server className="size-4" />
            </div>
            <div>
              <div className="text-lg font-semibold leading-none">{components.length}</div>
              <div className="text-[11px] text-muted-foreground">Components</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid size-9 place-items-center rounded-md border bg-background text-primary">
              <Layers className="size-4" />
            </div>
            <div>
              <div className="text-lg font-semibold leading-none">{environments.length}</div>
              <div className="text-[11px] text-muted-foreground">Trust Boundaries</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid size-9 place-items-center rounded-md border bg-background text-primary">
              <Globe className="size-4" />
            </div>
            <div>
              <div className="text-lg font-semibold leading-none">{publicCount}</div>
              <div className="text-[11px] text-muted-foreground">Publicly Exposed</div>
            </div>
          </div>
        </div>

        {/* COMPONENTS SECTION */}
        <section className="space-y-3">
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-0.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Server className="size-4 text-primary" /> Component Inventory
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Inline-edit parameters or batch-update via checkboxes.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={compSearch}
                  onChange={(e) => setCompSearch(e.target.value)}
                  placeholder="Search components…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Button type="button" size="sm" onClick={() => setShowAddCompModal(true)}>
                <Plus /> Add Component
              </Button>
            </div>
          </div>

          {selectedCompIds.length > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="grid size-7 place-items-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                  <CheckSquare className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">{selectedCompIds.length} components selected</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Batch update or remove selected entries.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Set Trust <ChevronDown className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Trust Level</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TM_TRUST_LEVELS.map((tr) => (
                      <DropdownMenuItem key={tr} onClick={() => handleBulkCompTrustChange(tr)}>
                        {tr}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Set Type <ChevronDown className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Component Type</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TM_COMPONENT_TYPES.map((t) => (
                      <DropdownMenuItem key={t} onClick={() => handleBulkCompTypeChange(t)}>
                        {t}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Set Exposure <ChevronDown className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Exposure</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TM_EXPOSURES.map((ex) => (
                      <DropdownMenuItem key={ex} onClick={() => handleBulkCompExposureChange(ex)}>
                        {ex}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Set AuthN <ChevronDown className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Authentication</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TM_AUTHN_OPTIONS.map((a) => (
                      <DropdownMenuItem key={a} onClick={() => handleBulkCompAuthNChange(a)}>
                        {a}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Set AuthZ <ChevronDown className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Authorization</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TM_AUTHZ_OPTIONS.map((a) => (
                      <DropdownMenuItem key={a} onClick={() => handleBulkCompAuthZChange(a)}>
                        {a}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" variant="destructive" size="sm" onClick={handleBulkCompDelete}>
                  <Trash /> Delete
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCompIds([])}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-10 text-center">
                    <Checkbox
                      aria-label="Select all components"
                      checked={compHeaderState}
                      onCheckedChange={handleSelectAllComponents}
                    />
                  </TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead>
                    Type
                    <EnumInfo title="Component Type" options={TM_COMPONENT_TYPES} info={TM_INFO_COMPONENT_TYPE} />
                  </TableHead>
                  <TableHead>
                    Trust Level
                    <EnumInfo title="Trust Level" options={TM_TRUST_LEVELS} info={TM_INFO_TRUST} />
                  </TableHead>
                  <TableHead>
                    Exposure
                    <EnumInfo title="Exposure" options={TM_EXPOSURES} info={TM_INFO_EXPOSURE} />
                  </TableHead>
                  <TableHead>
                    AuthN
                    <EnumInfo title="Authentication" options={TM_AUTHN_OPTIONS} info={TM_INFO_AUTHN} />
                  </TableHead>
                  <TableHead>
                    AuthZ
                    <EnumInfo title="Authorization" options={TM_AUTHZ_OPTIONS} info={TM_INFO_AUTHZ} />
                  </TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredComponents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No components. Paste Mermaid above or click <span className="font-medium text-foreground">Add Component</span>.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredComponents.map((c) => {
                    const isChecked = selectedCompIds.includes(c.id)
                    return (
                      <TableRow key={c.id} data-state={isChecked ? "selected" : undefined}>
                        <TableCell className="text-center">
                          <Checkbox
                            aria-label={`Select ${c.name}`}
                            checked={isChecked}
                            onCheckedChange={() => handleToggleComponentSelection(c.id)}
                          />
                        </TableCell>
                        <TableCell className="max-w-sm whitespace-normal align-top">
                          <div className="flex items-start gap-2.5">
                            <div className="mt-0.5 grid size-7 place-items-center rounded-md border bg-muted/40">
                              {componentTypeIcon(c.type)}
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <Input
                                value={c.name}
                                onChange={(e) => updateComponentField(c.id, "name", e.target.value)}
                                className="h-7 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none hover:bg-muted/40 focus-visible:bg-background focus-visible:ring-1"
                              />
                              <Textarea
                                value={c.desc}
                                onChange={(e) => updateComponentField(c.id, "desc", e.target.value)}
                                rows={2}
                                placeholder="Describe this component…"
                                className="min-h-12 resize-none border-transparent bg-transparent px-1 py-1 text-[11px] text-muted-foreground shadow-none hover:bg-muted/40 focus-visible:bg-background focus-visible:ring-1"
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Select value={c.type} onValueChange={(v) => updateComponentField(c.id, "type", v as TMComponentType)}>
                            <SelectTrigger size="sm" className="h-7 w-[130px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TM_COMPONENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="align-top">
                          <Select value={c.trustLevel} onValueChange={(v) => updateComponentField(c.id, "trustLevel", v as TMTrustLevel)}>
                            <SelectTrigger size="sm" className={cn("h-7 w-[120px] text-xs font-semibold", getTMTrustClass(c.trustLevel))}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TM_TRUST_LEVELS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="align-top">
                          <Select value={c.exposure} onValueChange={(v) => updateComponentField(c.id, "exposure", v as TMExposure)}>
                            <SelectTrigger size="sm" className={cn("h-7 w-[130px] text-xs font-semibold", getTMExposureClass(c.exposure))}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TM_EXPOSURES.map((ex) => <SelectItem key={ex} value={ex}>{ex}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="align-top">
                          <Select value={c.authn} onValueChange={(v) => updateComponentField(c.id, "authn", v as TMAuthN)}>
                            <SelectTrigger size="sm" className="h-7 w-36 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TM_AUTHN_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="align-top">
                          <Select value={c.authz} onValueChange={(v) => updateComponentField(c.id, "authz", v as TMAuthZ)}>
                            <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TM_AUTHZ_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => deleteComponent(c.id)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${c.name}`}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <Separator />

        {/* ENVIRONMENTS SECTION */}
        <section className="space-y-3">
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-0.5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="size-4 text-primary" /> Trust Boundaries
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Logical trust zones (VPCs, accounts, clusters, namespaces, tiers). Components belong to one boundary.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={envSearch}
                  onChange={(e) => setEnvSearch(e.target.value)}
                  placeholder="Search trust boundaries…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Button type="button" size="sm" onClick={() => setShowAddEnvModal(true)}>
                <Plus /> Add Trust Boundary
              </Button>
            </div>
          </div>

          {selectedEnvIds.length > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="grid size-7 place-items-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                  <CheckSquare className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-none">{selectedEnvIds.length} trust boundaries selected</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Batch update trust type or remove entries.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      Set Type <ChevronDown className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Environment Type</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TM_ENVIRONMENT_TYPES.map((t) => (
                      <DropdownMenuItem key={t} onClick={() => handleBulkEnvTypeChange(t)}>
                        {t}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" variant="destructive" size="sm" onClick={handleBulkEnvDelete}>
                  <Trash /> Delete
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedEnvIds([])}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-10 text-center">
                    <Checkbox
                      aria-label="Select all trust boundaries"
                      checked={envHeaderState}
                      onCheckedChange={handleSelectAllEnvironments}
                    />
                  </TableHead>
                  <TableHead>Trust Boundary</TableHead>
                  <TableHead>
                    Type
                    <EnumInfo title="Trust Boundary Type" options={TM_ENVIRONMENT_TYPES} info={TM_INFO_ENV_TYPE} />
                  </TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-40">Components</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEnvironments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No trust boundaries. Click <span className="font-medium text-foreground">Auto-discover with AI</span> to regenerate, or add one with <span className="font-medium text-foreground">Add Trust Boundary</span>.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEnvironments.map((env) => {
                    const isChecked = selectedEnvIds.includes(env.id)
                    const memberSet = new Set(env.memberComponents)
                    return (
                      <TableRow key={env.id} data-state={isChecked ? "selected" : undefined}>
                        <TableCell className="text-center">
                          <Checkbox
                            aria-label={`Select ${env.name}`}
                            checked={isChecked}
                            onCheckedChange={() => handleToggleEnvironmentSelection(env.id)}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={env.name}
                            onChange={(e) => updateEnvironmentField(env.id, "name", e.target.value)}
                            className="h-7 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none hover:bg-muted/40 focus-visible:bg-background focus-visible:ring-1"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Select value={env.type} onValueChange={(v) => updateEnvironmentField(env.id, "type", v as TMEnvironmentType)}>
                            <SelectTrigger size="sm" className={cn("h-7 w-[140px] text-xs font-semibold", getTMEnvClass(env.type))}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TM_ENVIRONMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="align-top">
                          <Textarea
                            value={env.desc}
                            onChange={(e) => updateEnvironmentField(env.id, "desc", e.target.value)}
                            rows={2}
                            placeholder="Describe this trust boundary (VPC, account, region, namespace…)"
                            className="min-h-12 resize-none border-transparent bg-transparent px-1 py-1 text-[11px] text-muted-foreground shadow-none hover:bg-muted/40 focus-visible:bg-background focus-visible:ring-1"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="outline" size="sm" className="h-7 w-full justify-between text-xs">
                                <span className="truncate">
                                  {memberSet.size} of {components.length}
                                </span>
                                <ChevronDown className="text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                              <DropdownMenuLabel className="text-[11px]">
                                Components in &ldquo;{env.name}&rdquo;
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {components.length === 0 ? (
                                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                                  No components yet.
                                </div>
                              ) : (
                                components.map((comp) => (
                                  <DropdownMenuCheckboxItem
                                    key={comp.id}
                                    checked={memberSet.has(comp.id)}
                                    onCheckedChange={() => toggleEnvMember(env.id, comp.id)}
                                    onSelect={(e) => e.preventDefault()}
                                    className="text-xs"
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      {componentTypeIcon(comp.type)}
                                      <span className="truncate">{comp.name || comp.id}</span>
                                    </span>
                                  </DropdownMenuCheckboxItem>
                                ))
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => deleteEnvironment(env.id)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${env.name}`}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </section>

      </CardContent>

      {/* ADD COMPONENT DIALOG */}
      <Dialog open={showAddCompModal} onOpenChange={setShowAddCompModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Component</DialogTitle>
            <DialogDescription>
              Add a custom component to the inventory. Manual entries survive Mermaid re-syncs.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={addComponentHandler} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tm-new-comp-name">Component Name</Label>
              <Input
                id="tm-new-comp-name"
                required
                value={newComp.name}
                onChange={(e) => setNewComp({ ...newComp, name: e.target.value })}
                placeholder="e.g., custom-vault-hsm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-env">Trust Boundary</Label>
                <Input
                  id="tm-new-comp-env"
                  list="tm-env-options"
                  value={newComp.environment}
                  onChange={(e) => setNewComp({ ...newComp, environment: e.target.value })}
                  placeholder="e.g., VPC-prod / k8s-cluster-1"
                />
                <p className="text-[10px] text-muted-foreground">
                  Choose an existing environment or type a new one to register it.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-type" className="flex items-center">
                  Component Type
                  <EnumInfo title="Component Type" options={TM_COMPONENT_TYPES} info={TM_INFO_COMPONENT_TYPE} />
                </Label>
                <Select value={newComp.type} onValueChange={(v) => setNewComp({ ...newComp, type: v as TMComponentType })}>
                  <SelectTrigger id="tm-new-comp-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TM_COMPONENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-trust" className="flex items-center">
                  Trust Level
                  <EnumInfo title="Trust Level" options={TM_TRUST_LEVELS} info={TM_INFO_TRUST} />
                </Label>
                <Select value={newComp.trustLevel} onValueChange={(v) => setNewComp({ ...newComp, trustLevel: v as TMTrustLevel })}>
                  <SelectTrigger id="tm-new-comp-trust">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TM_TRUST_LEVELS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-exposure" className="flex items-center">
                  Exposure
                  <EnumInfo title="Exposure" options={TM_EXPOSURES} info={TM_INFO_EXPOSURE} />
                </Label>
                <Select value={newComp.exposure} onValueChange={(v) => setNewComp({ ...newComp, exposure: v as TMExposure })}>
                  <SelectTrigger id="tm-new-comp-exposure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TM_EXPOSURES.map((ex) => <SelectItem key={ex} value={ex}>{ex}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-authn" className="flex items-center">
                  <KeyRound className="mr-1 size-3.5 text-muted-foreground" />
                  Authentication
                  <EnumInfo title="Authentication (AuthN)" options={TM_AUTHN_OPTIONS} info={TM_INFO_AUTHN} />
                </Label>
                <Select value={newComp.authn} onValueChange={(v) => setNewComp({ ...newComp, authn: v as TMAuthN })}>
                  <SelectTrigger id="tm-new-comp-authn">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TM_AUTHN_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-authz" className="flex items-center">
                  <Fingerprint className="mr-1 size-3.5 text-muted-foreground" />
                  Authorization
                  <EnumInfo title="Authorization (AuthZ)" options={TM_AUTHZ_OPTIONS} info={TM_INFO_AUTHZ} />
                </Label>
                <Select value={newComp.authz} onValueChange={(v) => setNewComp({ ...newComp, authz: v as TMAuthZ })}>
                  <SelectTrigger id="tm-new-comp-authz">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TM_AUTHZ_OPTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tm-new-comp-desc">Description</Label>
              <Textarea
                id="tm-new-comp-desc"
                rows={3}
                value={newComp.desc}
                onChange={(e) => setNewComp({ ...newComp, desc: e.target.value })}
                placeholder="Summarize the core security properties of this component…"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddCompModal(false)}>
                Cancel
              </Button>
              <Button type="submit">Confirm Registration</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ADD TRUST BOUNDARY DIALOG */}
      <Dialog open={showAddEnvModal} onOpenChange={setShowAddEnvModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Trust Boundary</DialogTitle>
            <DialogDescription>
              Define a logical trust zone (VPC, account, cluster, namespace, tier) and pick which components live inside it.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={addEnvironmentHandler} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tm-new-env-name">Trust Boundary Name</Label>
              <Input
                id="tm-new-env-name"
                required
                value={newEnv.name}
                onChange={(e) => setNewEnv({ ...newEnv, name: e.target.value })}
                placeholder="e.g., VPC-prod-us-east-1 / k8s-cluster-payments"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tm-new-env-type" className="flex items-center">
                Trust Type
                <EnumInfo title="Trust Boundary Type" options={TM_ENVIRONMENT_TYPES} info={TM_INFO_ENV_TYPE} />
              </Label>
              <Select value={newEnv.type} onValueChange={(v) => setNewEnv({ ...newEnv, type: v as TMEnvironmentType })}>
                <SelectTrigger id="tm-new-env-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TM_ENVIRONMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                External = internet-facing, Semi-Trusted = DMZ/perimeter, Internal = private, Restricted = CDE/PCI/secrets.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tm-new-env-desc">Description</Label>
              <Textarea
                id="tm-new-env-desc"
                rows={3}
                value={newEnv.desc}
                onChange={(e) => setNewEnv({ ...newEnv, desc: e.target.value })}
                placeholder="Account ID, region, CIDR, owner team, compliance tags…"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Components in this Trust Boundary</Label>
                <span className="text-[10px] text-muted-foreground">
                  {newEnv.memberComponents.length} of {components.length} selected
                </span>
              </div>
              {components.length === 0 ? (
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  No components yet. Add components first, then assign them here.
                </p>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/10 p-2">
                  {components.map((comp) => {
                    const checked = newEnv.memberComponents.includes(comp.id)
                    return (
                      <label
                        key={comp.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const isChecked = v === true
                            setNewEnv((prev) => ({
                              ...prev,
                              memberComponents: isChecked
                                ? [...prev.memberComponents, comp.id]
                                : prev.memberComponents.filter((id) => id !== comp.id),
                            }))
                          }}
                        />
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {componentTypeIcon(comp.type)}
                          <span className="truncate font-medium">{comp.name || comp.id}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{comp.type}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                A component can only belong to one trust boundary. Checking it here moves it from any previous boundary.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddEnvModal(false)}>
                Cancel
              </Button>
              <Button type="submit">Confirm Trust Boundary</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Shared <datalist> for environment autocomplete across inputs */}
      <datalist id="tm-env-options">
        {knownEnvironmentNames.map((n) => <option key={n} value={n} />)}
      </datalist>
    </Card>
    </TooltipProvider>
  )
}

// --- Mermaid Diagram Editor ---
const DiagramEditor = ({
  code,
  onCodeChange,
  persistKey,
  assessmentId,
  imageState,
  imageStage,
}: {
  code: string;
  onCodeChange: (v: string) => void;
  persistKey?: string;
  assessmentId?: string;
  imageState?: string;
  imageStage?: string;
}) => {
  const { resolvedTheme } = useTheme()
  const mermaidTheme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light"
  const [svg, setSvg] = useState("")
  const [copied, setCopied] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const zoomIn = () => setZoom(prev => Math.min(prev + 0.5, 5))
  const zoomOut = () => setZoom(prev => Math.max(prev - 0.5, 0.25))
  const zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  useEffect(() => {
    if (!isExpanded) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExpanded(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isExpanded])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    panStart.current = { x: pan.x, y: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({ x: panStart.current.x + e.clientX - dragStart.current.x, y: panStart.current.y + e.clientY - dragStart.current.y })
  }, [isDragging])

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(prev => Math.min(Math.max(prev + (e.deltaY > 0 ? -0.1 : 0.1), 0.25), 5))
  }, [])

  useEffect(() => {
    if (!code) return
    const render = async () => {
      try {
        setRenderError(null)
        // Palette selection now lives in @/lib/mermaid — one source of
        // truth for light / dark theme variables. Pass the resolved
        // theme so we don't rely on the `.dark` class being present at
        // render time (avoids flash on hydration).
        const svg = await renderMermaidSvg(code, {
          themeMode: mermaidTheme,
          fontFamily: "Inter, system-ui, sans-serif",
        })

        setSvg(svg)
      } catch (e) {
        setRenderError(e instanceof Error ? e.message : "Invalid Syntax")
      }
    }
    const timeout = setTimeout(render, 400)
    return () => clearTimeout(timeout)
  }, [code, mermaidTheme])

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Maximize2 size={14} className="text-muted-foreground" /> Architecture Diagram
          </div>
          <div className="flex items-center gap-1">
            <div className="hidden sm:flex items-center gap-1 mr-2 text-[10px] text-muted-foreground"><Move size={10} /> Drag to pan</div>
            <button
              onClick={() => setIsExpanded(true)}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Expand diagram"
            >
              <Maximize2 size={14} />
            </button>
            <button onClick={zoomOut} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"><ZoomOut size={14} /></button>
            <button onClick={zoomReset} className="px-2 py-1 rounded-md hover:bg-muted text-xs font-medium text-muted-foreground transition-colors min-w-10 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={zoomIn} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"><ZoomIn size={14} /></button>
          </div>
        </div>
        <div ref={containerRef} className="overflow-hidden bg-white dark:bg-[#0d1117]"
          style={{ minHeight: "400px", cursor: isDragging ? "grabbing" : "grab" }}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}>
          {renderError ? (
            <div className="p-8 flex items-center justify-center" style={{ minHeight: "400px" }}>
              <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-sm flex items-center gap-3">
                <AlertCircle size={16} className="shrink-0" />
                <span>Diagram syntax error — edit the code below to fix</span>
              </div>
            </div>
          ) : (
            <div className="w-full flex items-center justify-center" style={{ minHeight: "400px" }}>
              <div style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: isDragging ? "none" : "transform 0.2s ease",
                userSelect: "none",
              }} dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
        <button onClick={() => setShowCode(!showCode)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Terminal size={14} className="text-muted-foreground" /> Edit Diagram Code
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{showCode ? "Hide" : "Show"}</span>
            <motion.div animate={{ rotate: showCode ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight size={13} className="text-muted-foreground" />
            </motion.div>
          </div>
        </button>
        <AnimatePresence>
          {showCode && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-[#0f172a] border-b border-slate-700/50">
                <span className="text-[11px] text-muted-foreground font-mono">architecture.mermaid</span>
                <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="text-[11px] font-medium text-muted-foreground hover:text-indigo-400 flex items-center gap-1.5 transition-colors">
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="bg-[#0f172a] p-5">
                <textarea value={code} onChange={(e) => onCodeChange(e.target.value)}
                  className="w-full min-h-[180px] font-mono text-sm text-slate-300 bg-transparent outline-none resize-none leading-relaxed"
                  spellCheck={false} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ThreatModelInventory
        code={code}
        persistKey={persistKey}
        assessmentId={assessmentId}
        imageId={persistKey}
        imageState={imageState}
        imageStage={imageStage}
      />

      {/* Expanded diagram overlay */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-110 bg-background/95 backdrop-blur-sm p-4 sm:p-6"
          >
            <div className="h-full w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Maximize2 size={14} className="text-muted-foreground" /> Expanded Architecture Diagram
                </div>
                <div className="flex items-center gap-1">
                  <div className="hidden sm:flex items-center gap-1 mr-2 text-[10px] text-muted-foreground">
                    <Move size={10} /> Drag to pan
                  </div>
                  <button onClick={zoomOut} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <ZoomOut size={14} />
                  </button>
                  <button onClick={zoomReset} className="px-2 py-1 rounded-md hover:bg-muted text-xs font-medium text-muted-foreground transition-colors min-w-10 text-center tabular-nums">
                    {Math.round(zoom * 100)}%
                  </button>
                  <button onClick={zoomIn} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={() => setIsExpanded(false)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Close expanded view"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div
                className="flex-1 overflow-hidden bg-white dark:bg-[#0d1117]"
                style={{ cursor: isDragging ? "grabbing" : "grab" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              >
                {renderError ? (
                  <div className="h-full w-full p-8 flex items-center justify-center">
                    <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-sm flex items-center gap-3">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>Diagram syntax error — edit the code below to fix</span>
                    </div>
                  </div>
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <div
                      style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: "center center",
                        transition: isDragging ? "none" : "transform 0.2s ease",
                        userSelect: "none",
                      }}
                      dangerouslySetInnerHTML={{ __html: svg }}
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// --- Section Header ---
const SectionHeader = ({ icon: Icon, iconBg, title, subtitle }: {
  icon: any; iconBg: string; title: string; subtitle: string
}) => (
  <div className="flex items-center gap-3 mb-4">
    <div className={`p-2 rounded-lg ${iconBg}`}>
      <Icon size={18} />
    </div>
    <div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  </div>
)


// ------------------ Main Page ------------------

export default function AssessmentPage() {
  const { id } = useParams()
  const router = useRouter()

  const [assessmentState, setAssessmentState] = useState<string>("PENDING")
  const [assessmentStage, setAssessmentStage] = useState<string>("INITIALIZING")
  const [images, setImages] = useState<ImageData[]>([])
  const [activeImageIdx, setActiveImageIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [userAnswers, setUserAnswers] = useState<Record<string, Record<number, string>>>({})
  const [mermaidDiagrams, setMermaidDiagrams] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryingImageId, setRetryingImageId] = useState<string | null>(null)
  const [showFailedModal, setShowFailedModal] = useState(false)
  const [isAutoAnswering, setIsAutoAnswering] = useState<string | null>(null)
  const [usageData, setUsageData] = useState<{ total_calls: number; total_tokens_billed: number; total_estimated_cost: number; total_duration_ms: number } | null>(null)
  const [activeTab, setActiveTab] = useState<string>("diagram")

  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeImage = images[activeImageIdx] || null

  const { highLevelSummary, componentBreakdown, questions, componentDocs } = useMemo(() => {
    if (!activeImage) return { highLevelSummary: null, componentBreakdown: [], questions: [], componentDocs: [] }
    const rawQs = activeImage.clarification
    let parsedQs: any[]
    if (Array.isArray(rawQs)) parsedQs = rawQs
    else if (rawQs && typeof rawQs === "object" && Array.isArray((rawQs as any).questions)) parsedQs = (rawQs as any).questions
    else parsedQs = []
    return {
      highLevelSummary: activeImage.analysis_summary?.summary || null,
      componentBreakdown: activeImage.component_details?.components || [],
      questions: parsedQs.map((q: any) => ({
        question: typeof q === "string" ? q : q.question || "",
        answer: typeof q === "string" ? "" : q.answer || "",
        auto_answered: typeof q === "string" ? false : Boolean(q.auto_answered),
      })),
      componentDocs: activeImage.component_docs || [],
    }
  }, [activeImage])

  useEffect(() => {
    images.forEach(img => {
      if (img.flow_diagram?.mermaid && !mermaidDiagrams[img.image_id])
        setMermaidDiagrams(prev => ({ ...prev, [img.image_id]: img.flow_diagram!.mermaid! }))
    })
  }, [images])

  // Note: the Studio intentionally does NOT auto-redirect to the Summary
  // step when input is required — that would trap users who click
  // "Back to Studio" from the Summary page. The Next Step button (and
  // the unansweredCount badge below) is enough of a nudge.

  // Count of unanswered clarification questions for the active image — kept
  // for the Next Step button label / badge in the studio footer.
  const unansweredCount = useMemo(() => {
    if (!activeImage || !questions.length) return 0
    const imgId = activeImage.image_id
    return questions.reduce((n: number, q: any, idx: number) => {
      const v = userAnswers[imgId]?.[idx] ?? q.answer ?? ""
      return n + (v.trim().length === 0 ? 1 : 0)
    }, 0)
  }, [activeImage, questions, userAnswers])

  useEffect(() => {
    if (activeImage && questions.length > 0) {
      const imgId = activeImage.image_id
      if (!userAnswers[imgId]) {
        const initialMap: Record<number, string> = {}
        questions.forEach((q: any, idx: number) => { if (q.answer) initialMap[idx] = q.answer })
        setUserAnswers(prev => ({ ...prev, [imgId]: { ...initialMap, ...prev[imgId] } }))
      }
    }
  }, [activeImage, questions])

  useEffect(() => {
    if (assessmentState === "FAILED") setShowFailedModal(true)
  }, [assessmentState])

  const fetchData = async () => {
    try {
      const json = await api.get(`/assessment/${id}/progress`)
      if (json.status === 200) {
        const { state, stage, images: imgArr } = json.data
        setAssessmentState(state)
        setAssessmentStage(stage)
        setImages(imgArr || [])
        setLoading(false)
        // Pause polling at any "user-action-required" or terminal state.
        // AWAITING_REVIEW means the user needs to click "Next" to start Phase B.
        if (
          state === "FAILED" ||
          state === "NEEDS_INPUT" ||
          state === "COMPLETED" ||
          state === "AWAITING_REVIEW"
        ) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          fetchUsageData()
        }
      }
    } catch (e) { console.error(e) }
  }

  const fetchUsageData = async () => {
    try {
      const json = await api.get(`/threat_modeling/${id}/usage`)
      if (json.status === 200 && json.data) setUsageData(json.data)
    } catch { /* optional */ }
  }

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(fetchData, 4000)
  }

  useEffect(() => {
    fetchData()
    startPolling()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [id])

  const handleRetryAll = async () => {
    setIsRetrying(true)
    try {
      await api.post(`/assessment/${id}/retry-analysis`, {}, { retryOnPost: true })
      setAssessmentState("PROCESSING")
      setShowFailedModal(false)
      startPolling()
      toast.success("Analysis restarted for all failed images")
    } catch (e: any) { toast.error(e?.message || "Failed to restart analysis") }
    finally { setIsRetrying(false) }
  }

  const [isContinuing, setIsContinuing] = useState(false)

  // Phase A finished — trigger Phase B (summary + clarification questions).
  // Called from the "Next" CTA when the assessment is in AWAITING_REVIEW.
  // After the backend acknowledges, we navigate to the Summary page right
  // away so the user sees a loading screen there (driven by polling) instead
  // of waiting on the Studio page until questions are ready.
  const handleContinueAnalysis = async () => {
    setIsContinuing(true)
    try {
      const res = await api.post(`/assessment/${id}/continue`, {}, { retryOnPost: true })
      const count = res?.data?.count ?? 0
      toast.success(
        count > 0
          ? `Generating summary & questions for ${count} image${count === 1 ? "" : "s"}…`
          : "Generating summary & questions…",
      )
      setAssessmentState("PROCESSING")
      startPolling()
      router.push(`/dashboard/assessment/${id}/summary`)
    } catch (e: any) {
      toast.error(e?.message || "Failed to continue analysis")
    } finally {
      setIsContinuing(false)
    }
  }

  const handleRetryImage = async (imageId: string) => {
    setRetryingImageId(imageId)
    try {
      await api.post(`/assessment/${id}/images/${imageId}/retry`, {}, { retryOnPost: true })
      startPolling()
      toast.success("Image re-analysis started")
    } catch (e: any) { toast.error(e?.message || "Failed to retry image analysis") }
    finally { setRetryingImageId(null) }
  }

  const handleAutoAnswer = async (imageId: string) => {
    setIsAutoAnswering(imageId)
    try {
      const result = await api.post(`/assessment/${id}/images/${imageId}/auto-answer`, {}, { retryOnPost: true })
      // Backend returns the updated list under `clarifications` (see
      // AssessmentService.auto_answer_image). Fall back to the legacy
      // `clarification_questions` key in case the API shape changes.
      const list: any[] | undefined =
        result?.data?.clarifications ?? result?.data?.clarification_questions
      if (Array.isArray(list)) {
        const autoAnswers: Record<number, string> = {}
        list.forEach((q: any, idx: number) => { if (q?.answer) autoAnswers[idx] = q.answer })
        setUserAnswers(prev => ({ ...prev, [imageId]: { ...prev[imageId], ...autoAnswers } }))
        const answered = Object.values(autoAnswers).filter(a => a.trim()).length
        toast.success(`Auto-answered ${answered} of ${list.length} questions`)
      }
      await fetchData()
    } catch (e: any) { toast.error(e?.message || "Auto-answer failed — try answering manually") }
    finally { setIsAutoAnswering(null) }
  }

  const handlePersistData = async (shouldFinalize = false) => {
    if (shouldFinalize) setIsSubmitting(true); else setIsSaving(true)
    try {
      for (const img of images) {
        if (img.state === "NEEDS_INPUT" || img.state === "COMPLETED") {
          const imgId = img.image_id
          const imgAnswers = userAnswers[imgId] || {}
          const rawQs = img.clarification
          let qList: any[]
          if (Array.isArray(rawQs)) qList = rawQs
          else if (rawQs && typeof rawQs === "object" && Array.isArray((rawQs as any).questions)) qList = (rawQs as any).questions
          else continue
          if (qList.length === 0) continue
          const formattedAnswers = qList.map((q: any, index: number) => ({
            question: typeof q === "string" ? q : q.question || "",
            answer: imgAnswers[index] || (typeof q === "string" ? "" : q.answer || ""),
          }))
          await api.post(`/assessment/${id}/images/${imgId}/answer`, {
            clarification_questions: formattedAnswers,
            mermaid_code: mermaidDiagrams[imgId] || "",
          })
        }
      }
      if (shouldFinalize) { toast.success("Answers saved — starting threat modeling"); router.push(`/dashboard/threat/${id}`) }
      else { toast.success("Draft saved successfully"); await fetchData() }
    } catch (e: any) { toast.error(e?.message || "Failed to save answers") }
    finally { setIsSubmitting(false); setIsSaving(false) }
  }

  // Silent auto-save: saves draft without state transitions or toasts
  const handleAutoSave = useCallback(async () => {
    try {
      setIsSaving(true);
      for (const img of images) {
        if (img.state === "NEEDS_INPUT" || img.state === "COMPLETED") {
          const imgId = img.image_id;
          const imgAnswers = userAnswers[imgId] || {};
          // Only save if there are user-entered answers for this image
          if (Object.keys(imgAnswers).length === 0) continue;
          const rawQs = img.clarification;
          let qList: any[];
          if (Array.isArray(rawQs)) qList = rawQs;
          else if (rawQs && typeof rawQs === "object" && Array.isArray((rawQs as any).questions)) qList = (rawQs as any).questions;
          else continue;
          if (qList.length === 0) continue;
          const formattedAnswers = qList.map((q: any, index: number) => ({
            question: typeof q === "string" ? q : q.question || "",
            answer: imgAnswers[index] || (typeof q === "string" ? "" : q.answer || ""),
          }));
          await api.put(`/assessment/${id}/images/${imgId}/save-answers`, {
            clarification_questions: formattedAnswers,
          });
        }
      }
    } catch {
      // Silent failure for auto-save
    } finally {
      setIsSaving(false);
    }
  }, [images, userAnswers, id]);

  // Auto-save: debounce 2s after any answer change
  useEffect(() => {
    // Only auto-save if there are any user answers
    const hasAnswers = Object.values(userAnswers).some(imgAnswers => Object.keys(imgAnswers).length > 0);
    if (!hasAnswers) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      handleAutoSave();
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [userAnswers, handleAutoSave]);

  const onImageSelect = useCallback((idx: number) => setActiveImageIdx(idx), [])

  const anyImageFailed = images.some(img => img.state === "FAILED")
  const isProcessing = assessmentState === "PROCESSING"
  const isFailed = assessmentState === "FAILED"
  const activeMermaid = activeImage ? mermaidDiagrams[activeImage.image_id] || "" : ""

  // --- Blanc Studio-style canvas: edit `activeMermaid`, click "Render Diagram"
  //     to push it onto `renderedMermaid` (what `MermaidChart` actually draws).
  const [renderedMermaid, setRenderedMermaid] = useState<string>("")

  // Track which images have already had their canvas auto-hydrated so user
  // edits to the textarea don't get clobbered on every keystroke (the
  // mermaidDiagrams map updates as they type).
  const autoRenderedRef = useRef<Set<string>>(new Set())

  // Auto-render the diagram the first time we see Mermaid for the active
  // image — the user shouldn't have to click "Render Diagram" on initial
  // load. We watch the server-side mermaid (flow_diagram?.mermaid) so this
  // also fires when polling delivers the diagram mid-session.
  useEffect(() => {
    if (!activeImage) { setRenderedMermaid(""); return }
    const imgId = activeImage.image_id
    const serverMermaid = activeImage.flow_diagram?.mermaid?.trim() || ""

    if (!autoRenderedRef.current.has(imgId)) {
      // First time we see this image — auto-render its server diagram if
      // one has arrived. If it hasn't, leave the canvas empty; this effect
      // will re-fire as soon as polling delivers it.
      if (serverMermaid) {
        autoRenderedRef.current.add(imgId)
        setRenderedMermaid(serverMermaid)
      } else {
        setRenderedMermaid("")
      }
      return
    }

    // Image was previously auto-rendered. We only land here when the user
    // switches BACK to it — restore whatever they had in the editor (which
    // captures any uncommitted edits) so the canvas matches their last view.
    setRenderedMermaid(mermaidDiagrams[imgId] || serverMermaid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImage?.image_id, activeImage?.flow_diagram?.mermaid])

  // --- Live render: as the user types, push the source onto the canvas
  // after a short debounce so we don't re-run mermaid.parse on every
  // keystroke. The explicit "Render" button below still works for an
  // immediate re-render.
  useEffect(() => {
    if (!activeMermaid) return
    if (renderedMermaid === activeMermaid) return
    const handle = setTimeout(() => {
      setRenderedMermaid(activeMermaid)
    }, 400)
    return () => clearTimeout(handle)
  }, [activeMermaid, renderedMermaid])

  // Track the canvas render status (loading/ok/error + parse-error line)
  // so the editor pane can show an inline banner that jumps to the line.
  const [renderStatus, setRenderStatus] = useState<MermaidRenderStatus>({ state: "idle" })
  const editorRef = useRef<CodeEditorHandle | null>(null)

  const renderDiagram = useCallback(() => {
    const src = activeMermaid.trim()
    if (!src) { toast.error("Paste Mermaid JS before rendering."); return }
    setRenderedMermaid(src)
    setActiveTab("diagram")
  }, [activeMermaid])

  const copyMermaid = useCallback(async () => {
    if (!renderedMermaid) { toast.error("Render the diagram before copying."); return }
    await navigator.clipboard.writeText(renderedMermaid)
    toast.success("Mermaid source copied.")
  }, [renderedMermaid])

  // --- Loading ---
  if (loading)
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <ShieldAlert size={20} className="text-primary-foreground" />
          </div>
          <motion.div
            className="absolute -inset-1.5 rounded-lg border-2 border-primary/20"
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Loading assessment</p>
          <p className="text-xs text-muted-foreground mt-1">Fetching the latest data…</p>
        </div>
      </div>
    )

  // --- Phase A loading (summary-page-style card) ---
  // Keep the user on this page with a stage-aware loader until BOTH Phase A
  // steps finish — Mermaid extraction AND component analysis. Revealing the
  // studio the moment Mermaid is ready (as the old splash did) leaves the
  // ThreatModeller Inventory empty and confusing while COMPONENT_ANALYSIS
  // is still running in the background.
  //
  // Gate: active image is PENDING/PROCESSING and its stage is still one of
  // the two Phase-A stages. As soon as either changes (state transitions
  // out, or stage moves past COMPONENT_ANALYSIS into SUMMARIZING/
  // CLARIFICATION which belongs to the summary page), the studio opens.
  const activeImg = images[activeImageIdx]
  const activeImgState = activeImg?.state || assessmentState
  const activeImgStage = activeImg?.stage
  const isPhaseAExtracting =
    (activeImgState === "PENDING" || activeImgState === "PROCESSING") &&
    (!activeImgStage ||
      activeImgStage === "IMAGE_PROCESSING" ||
      activeImgStage === "COMPONENT_ANALYSIS")

  if (isPhaseAExtracting) {
    const phaseAStages = [
      {
        id: "IMAGE_PROCESSING",
        label: "Generating Mermaid diagram",
        description: "Converting your architecture image into editable Mermaid syntax",
        icon: Eye,
      },
      {
        id: "COMPONENT_ANALYSIS",
        label: "Extracting components & boundaries",
        description: "Identifying services, data stores, and trust boundaries",
        icon: Layers,
      },
    ] as const
    const activeIdx = Math.max(
      0,
      phaseAStages.findIndex((s) => s.id === activeImgStage),
    )
    return (
      <div className="min-h-[calc(100vh-var(--header-height))] bg-background flex flex-col items-center justify-center px-4 py-10">
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
                  <CardTitle className="text-base">Preparing your diagram</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    This usually takes 15–60 seconds — please keep this tab open.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              {phaseAStages.map((stage, idx) => {
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
              <span className="font-mono tabular-nums">
                {activeIdx + 1} / {phaseAStages.length}
              </span>
            </div>
          </Card>
        </motion.div>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <FailedModal open={showFailedModal} onClose={() => setShowFailedModal(false)} onRetry={handleRetryAll} isRetrying={isRetrying} errorMessage={activeImage?.error_message} />

      <main className="flex h-[calc(100vh-var(--header-height))] min-h-[640px] flex-col bg-background">
        {/* --- Header --- */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/50 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard/assessment/my_assessment"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldAlert className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold leading-tight">Assessment Studio</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {images.length} diagram{images.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            {images.length > 1 && (
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">Image</Label>
                <Select
                  value={activeImage?.image_id ?? undefined}
                  onValueChange={(value) => {
                    const idx = images.findIndex((img) => img.image_id === value)
                    if (idx >= 0) onImageSelect(idx)
                  }}
                >
                  <SelectTrigger size="sm" className="h-8 w-48 text-xs">
                    <SelectValue placeholder="Pick an image" />
                  </SelectTrigger>
                  <SelectContent>
                    {images.map((img, idx) => {
                      const info = STATE_INFO[img.state] || STATE_INFO.PENDING
                      return (
                        <SelectItem key={img.image_id} value={img.image_id}>
                          Image {idx + 1} · {info.label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon-sm" onClick={copyMermaid}>
                    <Clipboard className="size-4" />
                    <span className="sr-only">Copy Mermaid</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy Mermaid</TooltipContent>
              </Tooltip>
              {!isFailed ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetryAll}
                        disabled={isRetrying || isSaving}
                        className="h-8"
                      >
                        {isRetrying ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                        {isRetrying ? "Retrying…" : "Retry"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Re-run all stages</TooltipContent>
                  </Tooltip>
                  {assessmentState === "AWAITING_REVIEW" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          onClick={handleContinueAnalysis}
                          disabled={isContinuing}
                          className="h-8"
                        >
                          {isContinuing ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Sparkles />
                          )}
                          {isContinuing ? "Generating…" : "Generate Summary & Questions"}
                          {!isContinuing && <ChevronRight className="size-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Run summary &amp; clarification on the extracted components</TooltipContent>
                    </Tooltip>
                  ) : (assessmentState === "PROCESSING" || assessmentState === "PENDING") ? (
                    // Phase A/B in flight — surface the live stage on the button
                    // so the user sees WHICH step is running, not just "please wait".
                    (() => {
                      const stageMeta = STAGES.find((s) => s.id === assessmentStage)
                      const stageLabel = stageMeta?.label ?? assessmentStage ?? "Processing"
                      const stateLabel = STATE_INFO[assessmentState]?.label ?? assessmentState
                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" disabled className="h-8 shadow-sm gap-2">
                              <Loader2 className="size-3.5 animate-spin" />
                              {stateLabel} · {stageLabel}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {stageMeta?.tooltip ?? "Backend pipeline is running — the Next button will unlock automatically."}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })()
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          onClick={() => router.push(`/dashboard/assessment/${id}/summary`)}
                          disabled={isSubmitting || (questions.length === 0 && !highLevelSummary)}
                          className="h-8 shadow-sm"
                        >
                          Next Step
                          <ChevronRight className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Review summary and answer clarification questions</TooltipContent>
                    </Tooltip>
                  )}
                </>
              ) : (
                <Button size="sm" onClick={handleRetryAll} disabled={isRetrying} className="h-8 shadow-sm">
                  {isRetrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {isRetrying ? "Retrying…" : "Retry All Stages"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* --- Failed / Image-error banners --- */}
        {isFailed && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 lg:px-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-destructive">
              <XCircle className="size-4 shrink-0" />
              <span className="font-medium">Analysis failed</span>
              <span className="text-destructive/70">
                {anyImageFailed
                  ? `${images.filter((i) => i.state === "FAILED").length} of ${images.length} image(s) failed`
                  : "Something went wrong during analysis"}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowFailedModal(true)} className="h-7 text-xs">
              View Details
            </Button>
          </div>
        )}
        {activeImage?.state === "FAILED" && activeImage.error_message && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 lg:px-6 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span className="font-medium">{activeImage.error_message}</span>
          </div>
        )}

        {/* --- Split Layout: editor | canvas + inventory ---
            The Mermaid editor only shows on the Diagram tab so the
            ThreatModeller Inventory can use the full canvas width. */}
        <div
          className={
            activeTab === "diagram"
              ? "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)]"
              : "grid min-h-0 flex-1 grid-cols-1"
          }
        >
          {/* Left: Mermaid editor (Diagram tab only) */}
          {activeTab === "diagram" && (
          <aside className="min-h-0 border-b bg-card/30 lg:border-b-0 lg:border-r">
            <div className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileJson className="size-4" />
                  Mermaid JS
                </div>
                <div className="flex items-center gap-1.5">
                  {renderStatus.state === "loading" && (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Loader2 className="size-2.5 animate-spin" />
                      rendering
                    </Badge>
                  )}
                  {renderStatus.state === "ok" && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                    >
                      <CheckCircle2 className="size-2.5" />
                      live
                    </Badge>
                  )}
                  {renderStatus.state === "error" && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-destructive/40 bg-destructive/10 text-[10px] text-destructive"
                    >
                      <AlertCircle className="size-2.5" />
                      parse error
                    </Badge>
                  )}
                  <Badge variant="outline">{activeMermaid.length} chars</Badge>
                </div>
              </div>

              <CodeEditor
                ref={editorRef}
                value={activeMermaid}
                onChange={(next) => {
                  if (!activeImage) return
                  setMermaidDiagrams((prev) => ({ ...prev, [activeImage.image_id]: next }))
                }}
                disabled={!activeImage}
                errorLine={renderStatus.state === "error" ? renderStatus.line : undefined}
                placeholder={
                  isProcessing
                    ? "AI is building the diagram — it will appear here when ready."
                    : "Paste or edit Mermaid JS here"
                }
                className="min-h-80 lg:min-h-0"
              />

              {/* Live parse-error banner — jumps the editor to the offending line. */}
              {renderStatus.state === "error" && (
                <button
                  type="button"
                  onClick={() => {
                    if (renderStatus.line) editorRef.current?.focusLine(renderStatus.line)
                  }}
                  className="group flex w-full items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left text-[11px] text-destructive transition-colors hover:bg-destructive/10"
                  title={renderStatus.line ? `Jump to line ${renderStatus.line}` : "Mermaid parse error"}
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-semibold">
                      Parse error{typeof renderStatus.line === "number" ? ` on line ${renderStatus.line}` : ""}
                      {typeof renderStatus.line === "number" && (
                        <span className="ml-1.5 text-[10px] font-normal text-destructive/70 group-hover:underline">
                          jump to line
                        </span>
                      )}
                    </p>
                    <p className="whitespace-pre-wrap text-destructive/80 line-clamp-4">
                      {renderStatus.message}
                    </p>
                  </div>
                </button>
              )}

              <Button onClick={renderDiagram} disabled={!activeMermaid.trim()} className="w-full">
                <WandSparkles className="size-4" />
                Render Diagram
              </Button>

              {/* Slim LLM usage footer */}
              {usageData && usageData.total_calls > 0 && (
                <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground space-y-1.5">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Zap className="size-3 text-amber-500" />
                    AI Usage
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Coins className="size-3 text-violet-500" />
                      <span className="tabular-nums text-foreground/80">{usageData.total_tokens_billed.toLocaleString()}</span>
                      <span className="text-muted-foreground/70">tokens</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <DollarSign className="size-3 text-emerald-500" />
                      <span className="tabular-nums text-foreground/80">${usageData.total_estimated_cost.toFixed(4)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Timer className="size-3 text-sky-500" />
                      <span className="tabular-nums text-foreground/80">{(usageData.total_duration_ms / 1000).toFixed(1)}s</span>
                    </span>
                    <span className="inline-flex items-center gap-1 ml-auto">
                      <span className="tabular-nums text-foreground/80">{usageData.total_calls}</span>
                      <span className="text-muted-foreground/70">calls</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          </aside>
          )}

          {/* Right: Diagram canvas + Inventory tabs */}
          <section className="min-h-0 bg-muted/20 p-3">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex h-full min-h-0 flex-col gap-3"
            >
              <TabsList className="self-start">
                <TabsTrigger value="diagram">Diagram</TabsTrigger>
                <TabsTrigger value="inventory">
                  ThreatModeller Inventory
                  {activeImage && (
                    <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
                      live
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="diagram"
                className="min-h-0 flex-1 overflow-hidden rounded-md border bg-background shadow-sm"
              >
                {renderedMermaid ? (
                  <MermaidCanvas
                    chart={renderedMermaid}
                    className="h-full"
                    onStatusChange={setRenderStatus}
                  />
                ) : isProcessing || assessmentState === "PENDING" ? (
                  <div className="relative flex h-full min-h-[420px] flex-col items-center justify-center gap-6 overflow-hidden px-6 text-center">
                    {/* Soft radial halo behind the logo */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,var(--color-primary)_0%,transparent_60%)]/12"
                    />
                    {/* Grid texture */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 opacity-[0.08] mask-[radial-gradient(ellipse_at_center,black_30%,transparent_75%)] bg-[radial-gradient(circle,currentColor_1px,transparent_1px)] bg-size-[22px_22px] text-muted-foreground"
                    />

                    {/* Animated Blanc logo */}
                    <div className="relative grid size-28 place-items-center">
                      {/* Outer pulsing ring */}
                      <motion.span
                        aria-hidden
                        className="absolute inset-0 rounded-full border border-primary/30"
                        animate={{ scale: [1, 1.18, 1], opacity: [0.55, 0, 0.55] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                      />
                      {/* Inner pulsing ring */}
                      <motion.span
                        aria-hidden
                        className="absolute inset-2 rounded-full border border-primary/40"
                        animate={{ scale: [1, 1.12, 1], opacity: [0.7, 0.15, 0.7] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 0.4 }}
                      />
                      {/* Conic gradient sweep */}
                      <motion.span
                        aria-hidden
                        className="absolute inset-0 rounded-full"
                        style={{
                          background:
                            "conic-gradient(from 0deg, transparent 0deg, var(--primary) 90deg, transparent 180deg)",
                          maskImage:
                            "radial-gradient(circle at center, transparent 56%, black 58%, black 62%, transparent 64%)",
                          WebkitMaskImage:
                            "radial-gradient(circle at center, transparent 56%, black 58%, black 62%, transparent 64%)",
                        }}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                      />
                      {/* Logo plate */}
                      <motion.div
                        animate={{ scale: [1, 1.04, 1] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                        className={cn(
                          "relative grid size-16 place-items-center overflow-hidden rounded-full bg-black",
                          "ring-1 ring-black/80 dark:ring-white/15",
                          "shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_10px_30px_-12px_rgba(124,58,237,0.55)]",
                        )}
                      >
                        <Image
                          src="/brand.png"
                          alt="Blanc Threat Modeling Studio"
                          width={64}
                          height={64}
                          priority
                          className="size-full object-cover"
                        />
                        {/* Shimmer overlay sweeping across the logo */}
                        <motion.span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-linear-to-r from-transparent via-white/35 to-transparent"
                          animate={{ x: ["0%", "300%"] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.4 }}
                        />
                      </motion.div>
                    </div>

                    {/* Copy */}
                    <div className="relative max-w-sm space-y-1.5">
                      <p className="text-sm font-semibold text-foreground">
                        Extracting Mermaid from your diagram
                      </p>
                      <p className="text-xs font-medium text-primary">
                        {STAGES.find((s) => s.id === activeImage?.stage)?.label ||
                          (assessmentState === "PENDING" ? "Queued" : "Analyzing your architecture")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Blanc is reading your architecture image and converting it into editable Mermaid JS. The diagram will appear here as soon as it's ready.
                      </p>
                    </div>

                    {/* Indeterminate progress bar */}
                    <div className="relative h-1 w-44 overflow-hidden rounded-full bg-primary/10">
                      <motion.span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-linear-to-r from-primary via-violet-500 to-fuchsia-500"
                        animate={{ x: ["-110%", "330%"] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground">
                    Paste Mermaid JS on the left and click Render Diagram.
                  </div>
                )}
              </TabsContent>

              <TabsContent value="inventory" className="min-h-0 flex-1 overflow-auto">
                {activeImage ? (
                  <ThreatModelInventory
                    code={renderedMermaid}
                    persistKey={activeImage.image_id}
                    assessmentId={typeof id === "string" ? id : Array.isArray(id) ? id[0] : undefined}
                    imageId={activeImage.image_id}
                    imageState={activeImage.state}
                    imageStage={activeImage.stage}
                  />
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground">
                    No image selected.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </main>
    </TooltipProvider>
  )
}
