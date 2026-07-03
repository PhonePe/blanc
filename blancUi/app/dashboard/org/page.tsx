"use client"

import React, { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"

// Icons
import {
  Loader2,
  CheckCircle2,
  Circle,
  LayoutDashboard,
  Building2,
  ChevronRight,
  Save,
  Check,
  Briefcase,
  ArrowRight
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api-client"
import { toast } from "sonner"


// ---------- Types ----------
type ApiResponse<T = any> = {
  status?: string
  code?: number
  message?: string
  data?: T
}

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

type CategoryNameData = {
  id: string
  name: string
}

type CategoryProgress = {
  category: string
  answered_questions: number
  total_questions: number
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED"
}

type OnboardingCategory = CategoryProgress & {
  responses: {
    questionId: string
    question?: string
    answer?: string
  }[]
}

type OnboardingProgressData = {
  organization_id?: string
  organizationId?: string
  id?: string
  categories: OnboardingCategory[]
}

// ---------- Utilities ----------
function parseOptions(options: string | null): string[] {
  if (!options) return []
  return options.split(",").map((v) => v.trim()).filter(Boolean)
}

async function fetchJsonSafe<T = any>(input: RequestInfo, init?: RequestInit, timeoutMs = 8000): Promise<T | null> {
  const controller = new AbortController()
  const sig = controller.signal
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(input, { ...init, signal: sig })
    const json = await res.json().catch(() => null)
    clearTimeout(t)
    return json as T
  } catch (e) {
    clearTimeout(t)
    return null
  }
}

// ---------- Main Component ----------
export default function OrgOnboardingModern() {
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

  // ---------- Computed Logic (Frontend Source of Truth) ----------

  const questionsByCategory = useMemo(() => {
    const grouped: Record<string, Question[]> = {}
    for (const q of questions) {
      if (!grouped[q.category_id]) grouped[q.category_id] = []
      grouped[q.category_id].push(q)
    }
    return grouped
  }, [questions])

  const categories = useMemo(() => Object.keys(questionsByCategory), [questionsByCategory])

  // Real-time Overall Completion
  const overallCompletion = useMemo(() => {
    if (!questions.length) return 0
    const answeredCount = questions.filter(q => {
      const val = answers[q.id]
      return val && val.trim().length > 0
    }).length
    return Math.round((answeredCount / questions.length) * 100)
  }, [questions, answers])

  // Real-time Category Stats Helper
  const getCategoryStats = (catId: string) => {
    const qs = questionsByCategory[catId] || []
    const total = qs.length
    const answered = qs.filter(q => {
      const val = answers[q.id]
      return val && val.trim().length > 0
    }).length
    return { total, answered, isComplete: total > 0 && answered === total }
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
            const json = await api.get(`/category/${encodeURIComponent(catId)}/name`)
            if (json?.data?.name) newNames[catId] = json.data.name
          } catch {}
        })
      )
      if (Object.keys(newNames).length > 0) setCategoryNames((prev) => ({ ...prev, ...newNames }))
    }
    fetchCategoryNames()
  }, [categories, categoryNames])

  useEffect(() => { fetchQuestions() }, [])

  // ---------- API Calls ----------
  const fetchQuestions = async () => {
    try {
      const json = await api.get(`/questions?entity_type=ORG`)
      if (json?.data) {
        setQuestions(json.data)
        const firstCat = json.data[0]?.category_id
        if (firstCat && !selectedCategory) setSelectedCategory(firstCat)
      }
    } catch (e: any) { toast.error(e?.message || "Failed to load questions") }
  }

  const loadOrgData = async (targetId: string) => {
    try {
      const json = await api.get(`/onboarding/${encodeURIComponent(targetId)}`)
      if (!json?.data) return

      const backendOrgId = (json.data as any).organization_id ?? (json.data as any).organizationId ?? targetId
      setOrgId(backendOrgId)

      // Find org name from list if possible, or fallback
      const foundOrg = orgList.find(o => o.id === targetId)
      setDisplayOrgName(foundOrg?.name || "Organization Profile")

      const newAnswers: Record<string, string> = {}

      // Populate answers from backend
      const cats = Array.isArray((json.data as any).categories) ? (json.data as any).categories : []
      for (const cat of cats) {
        if (Array.isArray(cat.responses)) {
          for (const resp of cat.responses) {
            const qid = resp.questionId ?? resp.question_id
            if (qid) newAnswers[qid] = resp.answer ?? ""
          }
        }
      }
      setAnswers(newAnswers)
    } catch (err: any) { toast.error(err?.message || "Failed to load organization data") }
  }

  const handleCreateOrg = async () => {
    setError(null)
    if (!orgNameInput.trim()) return
    setLoading(true)
    try {
      const json = await api.post(`/org/new`, { name: orgNameInput.trim() })
      if (!json?.data) { setError("Creation failed. Please try again."); return }

      setOrgId(json.data.id)
      setDisplayOrgName(json.data.name ?? orgNameInput.trim())
      await fetchQuestions()
      await loadOrgData(json.data.id)
      setIsSetupMode(false)
    } catch (e: any) { toast.error(e?.message || "Network error"); setError("Network error occurred.") }
    finally { setLoading(false) }
  }

  const handleResumeOrg = async () => {
    setError(null)
    if (!resumeOrgIdInput) { setError("Please select an organization"); return }
    setLoading(true)
    try {
      await loadOrgData(resumeOrgIdInput)
      setIsSetupMode(false)
    } catch (e: any) { toast.error(e?.message || "Network error"); setError("Network error occurred.") }
    finally { setLoading(false) }
  }

  const handleSaveCategory = async () => {
    if (!orgId || !selectedCategory) return
    setSavingCategory(selectedCategory)
    const qs = questionsByCategory[selectedCategory] || []

    // FIX: Include the 'question' text in the payload as required by schema
    const responsePayload = qs
      .filter((q) => answers[q.id])
      .map((q) => ({
        questionId: q.id,
        question: q.question, // Added this field
        answer: answers[q.id]
      }))

    try {
      const json = await api.post(`/onboarding`, { orgId, category: selectedCategory, response: responsePayload })
      if (json?.code && json.code !== 200) {
        setError(json?.message ?? "Save failed");
        return
      }

      setLastSaved(new Date())
      toast.success("Category saved")
    } catch (e: any) { toast.error(e?.message || "Failed to save"); setError("Network error") }
    finally { setSavingCategory(null) }
  }

  // ---------- VIEW: Setup (Login/Create) ----------
  if (isSetupMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50/30 p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-lg"
        >
          <div className="flex justify-center mb-6">
            <div className="h-12 w-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <Building2 size={24} />
            </div>
          </div>
          <Card className="border-border shadow-xl overflow-hidden">
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-2xl font-bold text-foreground">Organization Onboarding</CardTitle>
              <CardDescription className="text-muted-foreground">Initialize a new profile or continue an existing session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8 pt-6 px-8">

              {/* Option 1: New */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">1</div>
                    <Label className="text-sm font-semibold text-foreground">Start New Profile</Label>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={orgNameInput}
                    onChange={(e) => setOrgNameInput(e.target.value)}
                    placeholder="Enter Organization Name"
                    className="h-11 border-border focus-visible:ring-indigo-500"
                  />
                  <Button onClick={handleCreateOrg} disabled={loading} className="h-11 px-6 bg-indigo-600 hover:bg-indigo-700 transition-colors">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4"/>}
                  </Button>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-3 text-muted-foreground font-medium">Or</span>
                </div>
              </div>

              {/* Option 2: Resume */}
              <div className="space-y-3">
                 <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold">2</div>
                    <Label className="text-sm font-semibold text-foreground">Resume Existing</Label>
                </div>
                <div className="flex gap-2">
                  <Select value={resumeOrgIdInput} onValueChange={(v) => setResumeOrgIdInput(v)}>
                    <SelectTrigger className="h-11 border-border focus:ring-indigo-500">
                      <SelectValue placeholder="Select Organization..." />
                    </SelectTrigger>
                    <SelectContent>
                      {orgList.map(org => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={handleResumeOrg} disabled={loading} className="h-11 border-border hover:bg-muted text-foreground">
                    Resume
                  </Button>
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-100 flex items-center gap-2"
                >
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  {error}
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  // ---------- VIEW: Main Dashboard ----------
  return (
    <div className="flex h-screen bg-muted font-sans text-foreground overflow-hidden">

      {/* Sidebar - Slate & Indigo Theme */}
      <aside className="w-80 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shadow-2xl z-20">

        {/* Sidebar Header with Org Name */}
        <div className="p-6 pb-4 bg-slate-950/50">
          <div className="flex items-center gap-3 text-white mb-6">
            <div className="h-10 w-10 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-900/50">
               <Briefcase className="h-5 w-5 text-white" />
            </div>
            <div className="overflow-hidden">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Organization</p>
                <h3 className="font-bold text-lg leading-tight truncate text-white" title={displayOrgName}>
                    {displayOrgName}
                </h3>
            </div>
          </div>

          {/* Global Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Completion</span>
              <span className="text-indigo-400">{overallCompletion}%</span>
            </div>
            <Progress value={overallCompletion} className="h-2 bg-slate-800" indicatorClassName="bg-indigo-500" />
          </div>
        </div>

        <ScrollArea className="flex-1 px-3 py-4">
          <div className="space-y-1">
            <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categories</div>
            {categories.map((catId) => {
              const stats = getCategoryStats(catId)
              const isSelected = selectedCategory === catId

              return (
                <button
                  key={catId}
                  onClick={() => setSelectedCategory(catId)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-3 rounded-md text-sm transition-all duration-200 group relative border border-transparent",
                    isSelected
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/20 font-medium border-indigo-500"
                      : "hover:bg-slate-800 hover:text-white text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {stats.isComplete ? (
                      <CheckCircle2 className={cn("h-4 w-4", isSelected ? "text-indigo-200" : "text-emerald-500")} />
                    ) : (
                      <Circle className={cn("h-4 w-4", isSelected ? "text-indigo-300" : "text-muted-foreground")} />
                    )}
                    <span className="truncate max-w-[140px] text-left">
                      {categoryNames[catId] ?? catId}
                    </span>
                  </div>

                  {/* Count Badge */}
                  <span className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full font-mono",
                    isSelected ? "bg-indigo-500 text-white" : "bg-slate-800 text-muted-foreground"
                  )}>
                    {stats.answered}/{stats.total}
                  </span>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-slate-800 bg-slate-900 text-xs text-muted-foreground flex justify-center">
            <span className="opacity-50">Secure Environment &bull; v2.0</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-muted/50">
        {/* Header */}
        <header className="h-16 bg-card border-b border-border flex items-center justify-between px-8 sticky top-0 z-10 shadow-sm flex-none">
          <div className="flex items-center gap-3">
            <div className="flex items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Assessment
              </span>
              <ChevronRight className="h-4 w-4 mx-2 text-slate-300" />
              <Badge variant="outline" className="text-foreground border-border font-normal px-2 py-0.5 rounded-sm bg-muted">
                  {displayOrgName}
              </Badge>
              <ChevronRight className="h-4 w-4 mx-2 text-slate-300" />
              <span className="text-indigo-700 dark:text-indigo-300 font-semibold bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded">
                {selectedCategory && (categoryNames[selectedCategory] ?? selectedCategory)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
             {lastSaved && (
                <span className="text-xs text-muted-foreground flex items-center gap-1.5 bg-muted px-3 py-1 rounded-full">
                  <Check className="h-3 w-3 text-emerald-500" />
                  Saved at {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
             )}
          </div>
        </header>

        {/* Scrollable Form Area - FIXED: Height Calculation */}
        <ScrollArea className="h-[calc(100vh-4rem)] w-full">
          <div className="max-w-4xl mx-auto py-10 px-8 pb-32">
            <AnimatePresence mode="wait">
              {selectedCategory && (
                <motion.div
                  key={selectedCategory}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-8"
                >
                  <div className="space-y-2 mb-8 border-b border-border pb-6">
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                      {categoryNames[selectedCategory] ?? selectedCategory}
                    </h1>
                    <p className="text-muted-foreground text-lg">
                      Provide details below. Your progress updates automatically.
                    </p>
                  </div>

                  <div className="space-y-6">
                    {questionsByCategory[selectedCategory]?.map((q, idx) => (
                      <Card key={q.id} className="border border-border shadow-sm hover:shadow-md hover:border-indigo-100 transition-all duration-200 group bg-card">
                        <CardContent className="pt-6 pb-6">
                          <div className="space-y-4">
                            <Label className="text-base font-medium text-foreground leading-normal flex gap-3">
                               <span className="flex-shrink-0 h-6 w-6 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center font-bold mt-0.5 group-hover:bg-indigo-100 dark:bg-indigo-900/50 group-hover:text-indigo-600 dark:text-indigo-400 transition-colors">
                                 {idx + 1}
                               </span>
                               {q.question}
                            </Label>

                            <div className="pl-9">
                              {q.options ? (
                                <Select
                                  value={answers[q.id] ?? ""}
                                  onValueChange={(val) => setAnswers(prev => ({...prev, [q.id]: val}))}
                                >
                                  <SelectTrigger className="w-full h-12 bg-muted border-border focus:ring-indigo-500 focus:border-indigo-500 transition-all">
                                    <SelectValue placeholder="Select an option..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {parseOptions(q.options).map((opt, i) => (
                                      <SelectItem key={i} value={opt}>{opt}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Textarea
                                  value={answers[q.id] ?? ""}
                                  onChange={(e) => setAnswers(prev => ({...prev, [q.id]: e.target.value}))}
                                  placeholder="Type your detailed answer here..."
                                  className="min-h-[120px] resize-none bg-muted border-border focus-visible:ring-indigo-500 focus-visible:border-indigo-500 transition-all"
                                />
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="h-12" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* Sticky Footer Action Bar */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border bg-card/80 backdrop-blur-md flex justify-end items-center gap-6 z-20">
          <div className="text-sm text-muted-foreground mr-auto pl-4 flex items-center gap-2">
             {selectedCategory && (() => {
               const stats = getCategoryStats(selectedCategory)
               const percentage = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0
               return (
                 <>
                   <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${percentage}%`}} />
                   </div>
                   <span className="font-medium text-foreground ml-2">{stats.answered}</span>
                   <span className="text-muted-foreground">/</span>
                   <span className="font-medium text-foreground">{stats.total}</span>
                   <span className="ml-1">answered</span>
                 </>
               )
             })()}
          </div>
          <Button
            size="lg"
            onClick={handleSaveCategory}
            disabled={savingCategory === selectedCategory}
            className="min-w-[160px] bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 text-white transition-all transform active:scale-95"
          >
            {savingCategory === selectedCategory ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {savingCategory === selectedCategory ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </main>
    </div>
  )
}