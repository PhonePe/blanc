"use client"

import * as React from "react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// Icons
import {
  RefreshCcw,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  ClipboardCheck,
  ArrowRight,
  Users,
  XCircle,
  Shield,
  CalendarDays,
  Building2,
  User,
} from "lucide-react"
import { PageHero, PageShell } from "@/components/dashboard-shell"

// --- Types ---

type Reviewer = {
  reviewer_id: string
  reviewer_name: string | null
  reviewer_email: string | null
  status: string
  comment: string | null
  reviewed_at: string | null
}

type AssessmentUnderReview = {
  assessment_id: string
  app_name: string
  framework: string
  team: string
  org_name: string
  state: string
  created_at: string | null
  updated_at: string | null
  reviewers: Reviewer[]
}


// --- Review Status Badge ---

const ReviewStatusBadge = ({ status }: { status: string }) => {
  switch (status?.toUpperCase()) {
    case "APPROVED":
      return (
        <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 px-2 py-0.5">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Approved
        </Badge>
      )
    case "REJECTED":
      return (
        <Badge variant="outline" className="bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 px-2 py-0.5">
          <XCircle className="h-3 w-3 mr-1" /> Rejected
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 px-2 py-0.5">
          <Clock className="h-3 w-3 mr-1" /> Pending
        </Badge>
      )
  }
}

// --- Reviewer Avatars ---

const ReviewerAvatars = ({ reviewers }: { reviewers: Reviewer[] }) => {
  const approved = reviewers.filter(r => r.status?.toUpperCase() === "APPROVED").length
  const rejected = reviewers.filter(r => r.status?.toUpperCase() === "REJECTED").length
  const pending = reviewers.filter(r => !["APPROVED", "REJECTED"].includes(r.status?.toUpperCase())).length

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {reviewers.slice(0, 4).map((r, i) => {
                const statusColor =
                  r.status?.toUpperCase() === "APPROVED"
                    ? "ring-emerald-400 bg-emerald-100 text-emerald-700 dark:text-emerald-300"
                    : r.status?.toUpperCase() === "REJECTED"
                    ? "ring-rose-400 bg-rose-100 text-rose-700 dark:text-rose-300"
                    : "ring-amber-400 bg-amber-100 text-amber-700 dark:text-amber-300"

                return (
                  <div
                    key={r.reviewer_id || i}
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ring-2 ring-offset-1",
                      statusColor
                    )}
                  >
                    {r.reviewer_name?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                )
              })}
              {reviewers.length > 4 && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold bg-muted text-muted-foreground ring-2 ring-slate-300 ring-offset-1">
                  +{reviewers.length - 4}
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{reviewers.length}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1.5 text-xs">
            <p className="font-semibold">Reviewers ({reviewers.length})</p>
            {approved > 0 && <p className="text-emerald-600 dark:text-emerald-400">{approved} approved</p>}
            {rejected > 0 && <p className="text-rose-600 dark:text-rose-400">{rejected} rejected</p>}
            {pending > 0 && <p className="text-amber-600 dark:text-amber-400">{pending} pending</p>}
            <hr className="border-border my-1" />
            {reviewers.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="truncate">{r.reviewer_name || r.reviewer_email || "Unknown"}</span>
                <span className={cn(
                  "font-semibold uppercase text-[10px]",
                  r.status?.toUpperCase() === "APPROVED" ? "text-emerald-600 dark:text-emerald-400" :
                  r.status?.toUpperCase() === "REJECTED" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
                )}>
                  {r.status || "PENDING"}
                </span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// --- Format Date ---

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "—"
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return dateStr
  }
}

// --- Main Page ---

export default function AssessmentsUnderReviewPage() {
  const [assessments, setAssessments] = useState<AssessmentUnderReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const fetchAssessments = async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await api.get(`/reviews/assessments-under-review`)
      setAssessments(json.data?.assessments || [])
    } catch (err) {
      setError("Failed to load assessments. Please check your connection.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAssessments()
  }, [])

  const filtered = assessments.filter((a) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      a.app_name?.toLowerCase().includes(q) ||
      a.framework?.toLowerCase().includes(q) ||
      a.team?.toLowerCase().includes(q) ||
      a.org_name?.toLowerCase().includes(q)
    )
  })

  return (
    <PageShell accent="amber" maxWidth="7xl">
      <PageHero
        icon={ClipboardCheck}
        title="Under Review"
        description="Assessments assigned to you for security review."
        rightSlot={
          <Badge variant="outline" className="h-8 px-3 text-sm bg-primary/5 text-primary border-primary/20">
            {loading ? "..." : `${filtered.length} assessment${filtered.length !== 1 ? "s" : ""}`}
          </Badge>
        }
      />
      <div className="flex flex-col gap-8">
        {/* Header replaced by PageHero above */}

        {/* Toolbar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center bg-card p-4 rounded-xl border shadow-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by app, framework, team, or org..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchAssessments} disabled={loading}>
            <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Table */}
        <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead>Framework</TableHead>
                <TableHead>Team / Org</TableHead>
                <TableHead>Reviewers</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-12 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length > 0 ? (
                filtered.map((a) => (
                  <TableRow
                    key={a.assessment_id}
                    className="group hover:bg-muted/50 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-indigo-500 shrink-0" />
                        <span className="font-medium text-foreground">
                          {a.app_name || "Untitled"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs bg-muted">
                        {a.framework || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm space-y-0.5">
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {a.team || "—"}
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          {a.org_name || "—"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ReviewerAvatars reviewers={a.reviewers} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatDate(a.updated_at)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild className="h-8">
                        <Link href={`/dashboard/threat/${a.assessment_id}`}>
                          Review <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-48 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <ClipboardCheck className="h-10 w-10 text-slate-300" />
                      <div>
                        <p className="font-medium text-muted-foreground">No assessments under review</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          You have not been assigned any assessments for review yet.
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageShell>
  )
}
