"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"

// shadcn/ui
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

// Icons
import {
  Loader2,
  CheckCircle2,
  Circle,
  Building2,
  ChevronRight,
  Save,
  Check,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  ClipboardList,
  RefreshCw,
  AlertCircle,
  ListChecks,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api-client"
import { toast } from "sonner"

const EASE = [0.22, 1, 0.36, 1] as const

// ---------- Types ----------
type Question = {
  id: string
  question: string
  options: string | null
  entity_type: "ORG" | "APP"
  category_id: string
}

type OrgData = {
  id: string
  name: string
  status?: string
}

// ---------- Utilities ----------
function parseOptions(options: string | null): string[] {
  if (!options) return []
  return options.split(",").map((v) => v.trim()).filter(Boolean)
}

// ---------- Main Component ----------
export default function OrgOnboardingModern() {
  const router = useRouter()

  // State
  const [isSetupMode, setIsSetupMode] = useState(true)
  const [orgNameInput, setOrgNameInput] = useState("")
  const [resumeOrgIdInput, setResumeOrgIdInput] = useState("")
  const [orgList, setOrgList] = useState<OrgData[]>([])

  const [orgId, setOrgId] = useState<string | null>(null)
  const [displayOrgName, setDisplayOrgName] = useState("")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>({})

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [savingCategory, setSavingCategory] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // ---------- Computed ----------
  const questionsByCategory = useMemo(() => {
    const grouped: Record<string, Question[]> = {}
    for (const q of questions) {
      if (!grouped[q.category_id]) grouped[q.category_id] = []
      grouped[q.category_id].push(q)
    }
    return grouped
  }, [questions])

  const categories = useMemo(
    () => Object.keys(questionsByCategory),
    [questionsByCategory]
  )

  const overallCompletion = useMemo(() => {
    if (!questions.length) return 0
    const answered = questions.filter((q) => {
      const v = answers[q.id]
      return v && v.trim().length > 0
    }).length
    return Math.round((answered / questions.length) * 100)
  }, [questions, answers])

  const totalAnswered = useMemo(() => {
    return questions.filter((q) => {
      const v = answers[q.id]
      return v && v.trim().length > 0
    }).length
  }, [questions, answers])

  const getCategoryStats = (catId: string) => {
    const qs = questionsByCategory[catId] || []
    const total = qs.length
    const answered = qs.filter((q) => {
      const val = answers[q.id]
      return val && val.trim().length > 0
    }).length
    return {
      total,
      answered,
      isComplete: total > 0 && answered === total,
      percent: total > 0 ? Math.round((answered / total) * 100) : 0,
    }
  }

  // ---------- Effects ----------
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const json = await api.get(`/org/all`)
        if (json?.data) setOrgList(json.data)
      } catch {}
    }
    fetchOrgs()
  }, [])

  useEffect(() => {
    if (categories.length === 0) return
    const fetchCategoryNames = async () => {
      const newNames: Record<string, string> = {}
      await Promise.all(
        categories.map(async (catId) => {
          if (categoryNames[catId]) return
          try {
            const json = await api.get(
              `/category/${encodeURIComponent(catId)}/name`
            )
            if (json?.data?.name) newNames[catId] = json.data.name
          } catch {}
        })
      )
      if (Object.keys(newNames).length > 0)
        setCategoryNames((prev) => ({ ...prev, ...newNames }))
    }
    fetchCategoryNames()
  }, [categories, categoryNames])

  useEffect(() => {
    fetchQuestions()
  }, [])

  // ---------- API ----------
  // Returns the fetched list so callers (e.g. `handleCreateOrg`) can
  // decide what to do next when there are zero questions. We do NOT
  // redirect from inside this function — that would make the initial
  // page-load useEffect bounce the user before they can even see the
  // "create org" form.
  const fetchQuestions = async (): Promise<Question[]> => {
    try {
      const json = await api.get(`/questions?entity_type=ORG`)
      const list: Question[] = Array.isArray(json?.data) ? json.data : []
      setQuestions(list)
      const firstCat = list[0]?.category_id
      if (firstCat && !selectedCategory) setSelectedCategory(firstCat)
      return list
    } catch (e: any) {
      toast.error(e?.message || "Failed to load questions")
      return []
    }
  }

  const loadOrgData = async (targetId: string) => {
    try {
      const json = await api.get(`/onboarding/${encodeURIComponent(targetId)}`)
      if (!json?.data) return

      const backendOrgId =
        (json.data as any).organization_id ??
        (json.data as any).organizationId ??
        targetId
      setOrgId(backendOrgId)

      const foundOrg = orgList.find((o) => o.id === targetId)
      setDisplayOrgName(foundOrg?.name || "Organization Profile")

      const newAnswers: Record<string, string> = {}
      const cats = Array.isArray((json.data as any).categories)
        ? (json.data as any).categories
        : []
      for (const cat of cats) {
        if (Array.isArray(cat.responses)) {
          for (const resp of cat.responses) {
            const qid = resp.questionId ?? resp.question_id
            if (qid) newAnswers[qid] = resp.answer ?? ""
          }
        }
      }
      setAnswers(newAnswers)
    } catch (err: any) {
      toast.error(err?.message || "Failed to load organization data")
    }
  }

  const handleCreateOrg = async () => {
    setError(null)
    if (!orgNameInput.trim()) return
    setLoading(true)
    try {
      const json = await api.post(`/org/new`, { name: orgNameInput.trim() })
      if (!json?.data) {
        setError("Creation failed. Please try again.")
        return
      }

      const createdName = json.data.name ?? orgNameInput.trim()
      setOrgId(json.data.id)
      setDisplayOrgName(createdName)

      // Fetch questions first so we can branch based on whether an
      // admin has authored any ORG-level questions yet.
      const list = await fetchQuestions()

      if (list.length === 0) {
        // No questions to answer — pop a confirmation, then bounce to
        // the admin console so someone can seed them. The 2s delay
        // gives the toast time to actually be read.
        toast.success(
          `Organization "${createdName}" created. Redirecting to questions setup…`,
          { duration: 2000 },
        )
        setTimeout(() => {
          router.push("/dashboard/admin/questions?entity_type=ORG")
        }, 2000)
        return
      }

      await loadOrgData(json.data.id)
      setIsSetupMode(false)
    } catch (e: any) {
      toast.error(e?.message || "Network error occurred.")
      setError("Network error occurred.")
    } finally {
      setLoading(false)
    }
  }

  const handleResumeOrg = async () => {
    setError(null)
    if (!resumeOrgIdInput) {
      setError("Please select an organization")
      return
    }
    setLoading(true)
    try {
      await loadOrgData(resumeOrgIdInput)
      setIsSetupMode(false)
    } catch (e: any) {
      toast.error(e?.message || "Network error occurred.")
      setError("Network error occurred.")
    } finally {
      setLoading(false)
    }
  }

  const handleSaveCategory = async () => {
    if (!orgId || !selectedCategory) return
    setSavingCategory(selectedCategory)
    const qs = questionsByCategory[selectedCategory] || []

    const responsePayload = qs
      .filter((q) => answers[q.id])
      .map((q) => ({
        questionId: q.id,
        question: q.question,
        answer: answers[q.id],
      }))

    try {
      const json = await api.post(`/onboarding`, {
        orgId,
        category: selectedCategory,
        response: responsePayload,
      })
      if (json?.code && json.code !== 200) {
        setError(json?.message ?? "Save failed")
        return
      }
      setLastSaved(new Date())
      toast.success("Category saved successfully")
    } catch (e: any) {
      toast.error(e?.message || "Failed to save")
      setError("Network error")
    } finally {
      setSavingCategory(null)
    }
  }

  // ---------- Setup view ----------
  if (isSetupMode) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        {/* Decorative background */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 -left-24 size-[420px] rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute -bottom-32 -right-24 size-[420px] rounded-full bg-violet-500/10 blur-3xl" />
          <div className="absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--color-foreground)_1px,transparent_0)]/4 bg-size-[20px_20px]" />
        </div>

        <div className="container mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="w-full"
          >
            {/* Hero */}
            <div className="mb-8 flex flex-col items-center text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.85, rotate: -6 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{
                  type: "spring" as const,
                  stiffness: 280,
                  damping: 18,
                  delay: 0.1,
                }}
                className="relative mb-5"
              >
                <div className="absolute inset-0 -z-10 rounded-2xl bg-indigo-500/20 blur-xl" />
                <div className="flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 via-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/30 ring-1 ring-inset ring-white/20">
                  <Building2 className="size-7 text-white" />
                </div>
              </motion.div>

              <Badge
                variant="secondary"
                className="mb-3 gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
              >
                <Sparkles className="size-3" />
                Organization · Onboarding
              </Badge>

              <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Set up your organization profile
              </h1>
              <p className="mt-3 max-w-lg text-pretty text-sm text-muted-foreground sm:text-base">
                Start a new profile or pick up where you left off. We&apos;ll guide
                you through each section.
              </p>
            </div>

            {/* Card */}
            <Card className="relative overflow-hidden border-border/60 shadow-xl shadow-foreground/5">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.2 }}
                className="absolute inset-x-0 top-0 h-0.5 origin-left bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
              />
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Choose how to start</CardTitle>
                <CardDescription>
                  Create a brand-new organization or resume an existing one.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-7">
                {/* Option 1: New */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex size-6 items-center justify-center rounded-full bg-indigo-500/15 text-[11px] font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-500/20 dark:text-indigo-300">
                      1
                    </div>
                    <Label className="text-sm font-medium">
                      Start a new profile
                    </Label>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={orgNameInput}
                      onChange={(e) => setOrgNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateOrg()
                      }}
                      placeholder="e.g. Acme Corp"
                      className="h-11"
                    />
                    <Button
                      onClick={handleCreateOrg}
                      disabled={loading || !orgNameInput.trim()}
                      className="h-11 gap-2 bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500"
                    >
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          Create
                          <ArrowRight className="size-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Divider */}
                <div className="relative">
                  <Separator />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="bg-card px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      or
                    </span>
                  </div>
                </div>

                {/* Option 2: Resume */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-inset ring-border">
                      2
                    </div>
                    <Label className="text-sm font-medium">
                      Resume an existing org
                    </Label>
                  </div>
                  <div className="flex gap-2">
                    <Select
                      value={resumeOrgIdInput}
                      onValueChange={(v) => setResumeOrgIdInput(v)}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select an organization…" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgList.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            No organizations yet
                          </div>
                        )}
                        {orgList.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={handleResumeOrg}
                      disabled={loading || !resumeOrgIdInput}
                      className="h-11 gap-2"
                    >
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          <RefreshCw className="size-4" />
                          Resume
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                    >
                      <Alert variant="destructive">
                        <AlertCircle className="size-4" />
                        <AlertDescription className="wrap-break-word">
                          {error}
                        </AlertDescription>
                      </Alert>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>

              <CardFooter className="flex items-center justify-between border-t border-border/60 bg-muted/30 py-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" />
                  Your inputs are saved per category
                </span>
                <span className="font-mono">v2.0</span>
              </CardFooter>
            </Card>
          </motion.div>
        </div>
      </div>
    )
  }

  // ---------- Main view ----------
  return (
    <div className="relative flex h-[calc(100vh-3.5rem)] overflow-hidden bg-muted/30">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 right-1/4 size-[480px] rounded-full bg-indigo-500/6 blur-3xl" />
        <div className="absolute -bottom-32 left-0 size-[420px] rounded-full bg-violet-500/6 blur-3xl" />
      </div>

      {/* Sidebar */}
      <aside className="z-10 flex w-80 shrink-0 flex-col border-r border-border/60 bg-card/80 backdrop-blur-md">
        <div className="space-y-5 border-b border-border/60 p-5">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex items-center gap-3"
          >
            <div className="relative">
              <div className="absolute inset-0 -z-10 rounded-xl bg-indigo-500/20 blur-md" />
              <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 via-indigo-600 to-violet-600 shadow-md shadow-indigo-500/30 ring-1 ring-inset ring-white/20">
                <Building2 className="size-5 text-white" />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Organization
              </p>
              <h3
                className="truncate text-base font-semibold leading-tight"
                title={displayOrgName}
              >
                {displayOrgName}
              </h3>
            </div>
          </motion.div>

          {/* Overall progress */}
          <div className="space-y-2 rounded-xl border border-border/60 bg-background/60 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Completion
              </span>
              <motion.span
                key={overallCompletion}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-300"
              >
                {overallCompletion}%
              </motion.span>
            </div>
            <Progress
              value={overallCompletion}
              className="h-1.5"
              indicatorClassName={cn(
                "bg-linear-to-r from-indigo-500 to-violet-500",
                overallCompletion === 100 &&
                  "bg-linear-to-r from-emerald-500 to-emerald-400"
              )}
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {totalAnswered} of {questions.length} answered
              </span>
              {overallCompletion === 100 && (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" />
                  Complete
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Categories
          </span>
          <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">
            {categories.length}
          </Badge>
        </div>

        <ScrollArea className="flex-1 px-3">
          <div className="space-y-1 pb-4">
            {categories.map((catId, idx) => {
              const stats = getCategoryStats(catId)
              const isSelected = selectedCategory === catId

              return (
                <motion.button
                  key={catId}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.3,
                    ease: EASE,
                    delay: 0.04 * idx,
                  }}
                  onClick={() => setSelectedCategory(catId)}
                  className={cn(
                    "group relative flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isSelected
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="onboarding-active-bg"
                      transition={{
                        type: "spring" as const,
                        stiffness: 320,
                        damping: 28,
                      }}
                      className="absolute inset-0 -z-10 rounded-lg bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/20"
                    />
                  )}
                  {isSelected && (
                    <motion.span
                      layoutId="onboarding-active-bar"
                      transition={{
                        type: "spring" as const,
                        stiffness: 320,
                        damping: 28,
                      }}
                      className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-indigo-500"
                    />
                  )}

                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                        stats.isComplete
                          ? "bg-emerald-500/15 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400"
                          : isSelected
                            ? "bg-indigo-500/15 text-indigo-600 ring-1 ring-inset ring-indigo-500/20 dark:text-indigo-300"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {stats.isComplete ? (
                        <CheckCircle2 className="size-3.5" />
                      ) : (
                        <Circle className="size-3.5" />
                      )}
                    </span>
                    <span className="truncate text-left">
                      {categoryNames[catId] ?? catId}
                    </span>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                      stats.isComplete
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : isSelected
                          ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {stats.answered}/{stats.total}
                  </span>
                </motion.button>
              )
            })}
          </div>
        </ScrollArea>

        <div className="border-t border-border/60 px-5 py-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3" />
            Secure environment
          </span>
        </div>
      </aside>

      {/* Main */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/60 bg-background/70 px-6 backdrop-blur-md">
          <nav className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ClipboardList className="size-3.5" />
              Assessment
            </span>
            <ChevronRight className="size-3 text-muted-foreground/60" />
            <Badge
              variant="outline"
              className="h-5 rounded-md px-1.5 font-normal text-foreground"
            >
              {displayOrgName}
            </Badge>
            <ChevronRight className="size-3 text-muted-foreground/60" />
            <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 font-medium text-indigo-600 ring-1 ring-inset ring-indigo-500/20 dark:text-indigo-300">
              {selectedCategory &&
                (categoryNames[selectedCategory] ?? selectedCategory)}
            </span>
          </nav>

          <AnimatePresence mode="wait">
            {lastSaved && (
              <motion.div
                key={lastSaved.getTime()}
                initial={{ opacity: 0, scale: 0.9, x: 8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <Check className="size-3" />
                Saved at{" "}
                {lastSaved.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        {/* Scrollable form */}
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-4xl px-6 py-10 pb-32">
            <AnimatePresence mode="wait">
              {selectedCategory && (
                <motion.div
                  key={selectedCategory}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="space-y-6"
                >
                  {/* Section heading */}
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                      >
                        <ListChecks className="size-3" />
                        Section
                      </Badge>
                      {(() => {
                        const s = getCategoryStats(selectedCategory)
                        return (
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full font-mono",
                              s.isComplete
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                            )}
                          >
                            {s.answered}/{s.total} answered · {s.percent}%
                          </Badge>
                        )
                      })()}
                    </div>
                    <div>
                      <h1 className="text-balance text-3xl font-semibold tracking-tight">
                        {categoryNames[selectedCategory] ?? selectedCategory}
                      </h1>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Provide details below. Your progress updates
                        automatically.
                      </p>
                    </div>
                    <Separator />
                  </div>

                  {/* Questions */}
                  <div className="space-y-4">
                    {questionsByCategory[selectedCategory]?.map((q, idx) => {
                      const isAnswered =
                        !!answers[q.id] && answers[q.id].trim().length > 0
                      return (
                        <motion.div
                          key={q.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.3,
                            ease: EASE,
                            delay: 0.03 * idx,
                          }}
                        >
                          <Card
                            className={cn(
                              "group relative overflow-hidden border-border/60 transition-all",
                              "hover:border-indigo-500/30 hover:shadow-md hover:shadow-indigo-500/5",
                              isAnswered && "border-emerald-500/30"
                            )}
                          >
                            {/* Left accent */}
                            <motion.span
                              initial={false}
                              animate={{ scaleY: isAnswered ? 1 : 0 }}
                              transition={{ duration: 0.25, ease: EASE }}
                              className="absolute inset-y-0 left-0 w-0.5 origin-center bg-emerald-500"
                            />
                            <CardContent className="space-y-4 p-5">
                              <div className="flex items-start gap-3">
                                <div className="relative flex size-7 shrink-0 items-center justify-center">
                                  <AnimatePresence mode="wait" initial={false}>
                                    {isAnswered ? (
                                      <motion.span
                                        key="check"
                                        initial={{ scale: 0.6, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        exit={{ scale: 0.6, opacity: 0 }}
                                        transition={{
                                          duration: 0.2,
                                          ease: EASE,
                                        }}
                                        className="flex size-7 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400"
                                      >
                                        <Check className="size-4" />
                                      </motion.span>
                                    ) : (
                                      <motion.span
                                        key="num"
                                        initial={{ scale: 0.6, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        exit={{ scale: 0.6, opacity: 0 }}
                                        transition={{
                                          duration: 0.2,
                                          ease: EASE,
                                        }}
                                        className="flex size-7 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-inset ring-border group-hover:bg-indigo-500/10 group-hover:text-indigo-600 dark:group-hover:text-indigo-300"
                                      >
                                        {idx + 1}
                                      </motion.span>
                                    )}
                                  </AnimatePresence>
                                </div>
                                <Label className="pt-1 text-[15px] font-medium leading-snug text-foreground">
                                  {q.question}
                                </Label>
                              </div>

                              <div className="pl-10">
                                {q.options ? (
                                  <Select
                                    value={answers[q.id] ?? ""}
                                    onValueChange={(val) =>
                                      setAnswers((prev) => ({
                                        ...prev,
                                        [q.id]: val,
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-11 w-full">
                                      <SelectValue placeholder="Select an option…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {parseOptions(q.options).map((opt, i) => (
                                        <SelectItem key={i} value={opt}>
                                          {opt}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Textarea
                                    value={answers[q.id] ?? ""}
                                    onChange={(e) =>
                                      setAnswers((prev) => ({
                                        ...prev,
                                        [q.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Type your detailed answer here…"
                                    className="min-h-32 resize-y"
                                  />
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      )
                    })}
                  </div>

                  <div className="h-10" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* Sticky action bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.1 }}
            className="pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/95 px-4 py-3 shadow-xl shadow-foreground/10 backdrop-blur-xl"
          >
            <div className="flex min-w-0 items-center gap-3">
              {selectedCategory &&
                (() => {
                  const s = getCategoryStats(selectedCategory)
                  return (
                    <>
                      <div className="hidden sm:block">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Section progress
                        </p>
                        <p className="font-mono text-sm font-semibold tabular-nums">
                          {s.answered}
                          <span className="text-muted-foreground">
                            /{s.total}
                          </span>
                        </p>
                      </div>
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          initial={false}
                          animate={{ width: `${s.percent}%` }}
                          transition={{ duration: 0.35, ease: EASE }}
                          className={cn(
                            "h-full rounded-full bg-linear-to-r from-indigo-500 to-violet-500",
                            s.isComplete &&
                              "bg-linear-to-r from-emerald-500 to-emerald-400"
                          )}
                        />
                      </div>
                      <span className="hidden font-mono text-[11px] tabular-nums text-muted-foreground sm:inline">
                        {s.percent}%
                      </span>
                    </>
                  )
                })()}
            </div>

            <Button
              size="lg"
              onClick={handleSaveCategory}
              disabled={savingCategory === selectedCategory}
              className="h-11 min-w-40 gap-2 bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500"
            >
              {savingCategory === selectedCategory ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {savingCategory === selectedCategory
                ? "Saving…"
                : "Save section"}
            </Button>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
