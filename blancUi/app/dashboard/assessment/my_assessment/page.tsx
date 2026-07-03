"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api-client"

// UI Components
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { toast } from "sonner"

// Icons
import {
  RefreshCcw,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  LayoutList,
  Plus,
  ArrowRight,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Loader2,
  User,
  LayoutGrid,
} from "lucide-react"
import { PageHero, PageShell } from "@/components/dashboard-shell"

// --- Types ---

type ViewMode = "self" | "all"

type Assessment = {
  assessment_id: string
  assessment_type: string
  team: string
  app_name: string
  interface: string
  operating_system: string
  state: string 
  stage: string 
  feature_name: string
  feature_version: string
  creator_email?: string
  framework?: string
  error_message?: string
}

const ITEMS_PER_PAGE = 10

// --- Status Component ---

const StatusBadge = ({ state, stage }: { state: string, stage: string }) => {
  const s = state || "UNKNOWN"

  switch (s) {
    case "COMPLETED":
      return (
        <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 pl-1 pr-2 py-1">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Completed
        </Badge>
      )
    case "REVIEW":
      return (
        <Badge variant="outline" className="bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800 pl-1 pr-2 py-1">
          <Clock className="h-3.5 w-3.5 mr-1" /> In Review
        </Badge>
      )
    case "APPROVED":
      return (
        <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 pl-1 pr-2 py-1">
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approved
        </Badge>
      )
    case "CHANGES_REQUESTED":
      return (
        <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 pl-1 pr-2 py-1">
          <AlertCircle className="h-3.5 w-3.5 mr-1" /> Changes Requested
        </Badge>
      )
    case "NEEDS_INPUT":
      return (
        <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 pl-1 pr-2 py-1">
          <HelpCircle className="h-3.5 w-3.5 mr-1" /> Needs Input
        </Badge>
      )
    case "PROCESSING":
      return (
        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 pl-1 pr-2 py-1">
          <RefreshCcw className="h-3.5 w-3.5 mr-1 animate-spin" /> {stage?.replace(/_/g, " ")}
        </Badge>
      )
    case "FAILED":
      return (
        <Badge variant="outline" className="bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 pl-1 pr-2 py-1">
          <AlertCircle className="h-3.5 w-3.5 mr-1" /> Failed
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground border-border pl-1 pr-2 py-1">
          {s.toLowerCase()}
        </Badge>
      )
  }
}

export default function AssessmentTablePage() {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("self")

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 400)
    return () => clearTimeout(timer)
  }, [query])

  const fetchAssessments = async (page = 1) => {
    setLoading(true)
    setError(null)
    try {
      const skip = (page - 1) * ITEMS_PER_PAGE
      const params = new URLSearchParams({ skip: String(skip), limit: String(ITEMS_PER_PAGE) })
      if (debouncedQuery.trim()) params.set("search", debouncedQuery.trim())
      if (viewMode === "self") params.set("self_only", "true")
      const json = await api.get(`/assessment/list?${params.toString()}`)
      
      const dataList = json.data?.assessments || json.assessments || []
      const totalCount = json.data?.total ?? json.total ?? 0
      
      setAssessments(dataList)
      setTotalPages(Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE)))
    } catch (err) {
      setError("Failed to load assessments. Please check your connection.")
    } finally {
      setLoading(false)
    }
  }

  const handleRetry = async (assessmentId: string) => {
    setRetryingId(assessmentId)
    try {
      await api.post(`/assessment/${assessmentId}/retry-analysis`, {}, { retryOnPost: true })
      toast.success("Analysis restarted successfully")
      fetchAssessments(currentPage)
    } catch (err: any) {
      toast.error(err?.message || "Failed to restart analysis")
    } finally {
      setRetryingId(null)
    }
  }

  const switchViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    setAssessments([])
    setCurrentPage(1)
    setQuery("")
    setDebouncedQuery("")
    setError(null)
  }

  useEffect(() => {
    fetchAssessments(currentPage)
  }, [currentPage, debouncedQuery, viewMode])

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedQuery])

  const getViewHref = (a: Assessment) => {
    const threatPageStates = ["COMPLETED", "REVIEW", "APPROVED", "CHANGES_REQUESTED"]
    const isAtThreatStage = a.stage === "THREAT_MODELING"
    if (threatPageStates.includes(a.state) || isAtThreatStage) {
      return `/dashboard/threat/${a.assessment_id}`
    }
    return `/dashboard/assessment/${a.assessment_id}`
  }

  return (
    <PageShell accent="blue" maxWidth="7xl">
      <PageHero
        icon={LayoutList}
        title="Assessments"
        description="Monitor security pipeline status and STRIDE modeling."
        rightSlot={
          <Button asChild className="rounded-full shadow-lg shadow-primary/20">
            <Link href="/dashboard/assessment/new">
              <Plus className="mr-2 h-4 w-4" /> New Assessment
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-8">
        {/* View mode toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted w-fit">
          <Button
            variant={viewMode === "self" ? "default" : "ghost"}
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => switchViewMode("self")}
          >
            <User className="h-3.5 w-3.5" /> My Assessments
          </Button>
          <Button
            variant={viewMode === "all" ? "default" : "ghost"}
            size="sm"
            className="h-8 px-3 gap-1.5"
            onClick={() => switchViewMode("all")}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> All Assessments
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center bg-card p-4 rounded-xl border shadow-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by feature name, app, or org..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <Button variant="outline" size="icon" onClick={() => fetchAssessments(currentPage)} disabled={loading}>
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        {/* Table Area */}
        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead>Feature name</TableHead>
                  <TableHead>Feature version</TableHead>
                  <TableHead>Creator Email</TableHead>
                  <TableHead>Current Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}><Skeleton className="h-12 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : assessments.length > 0 ? (
                  assessments.map((a) => (
                    <TableRow key={a.assessment_id} className="group hover:bg-muted/50 transition-colors">
                      <TableCell className="text-sm text-muted-foreground">{a.feature_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.feature_version}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{a.creator_email || "-"}</TableCell>
                      <TableCell><StatusBadge state={a.state} stage={a.stage} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {a.state === "FAILED" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3"
                              onClick={() => handleRetry(a.assessment_id)}
                              disabled={retryingId === a.assessment_id}
                            >
                              {retryingId === a.assessment_id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              Retry
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" asChild className="h-8">
                            <Link href={getViewHref(a)}>
                              View <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        No assessments found. Create one to get started.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {!loading && assessments.length > 0 && (
            <div className="flex items-center justify-end gap-4 py-4">
              <span className="text-sm text-muted-foreground font-medium">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" disabled={currentPage <= 1} onClick={() => setCurrentPage(prev => prev - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(prev => prev + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}
