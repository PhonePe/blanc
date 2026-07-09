"use client"

import React, { useEffect, useState, useMemo } from "react"
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

// Icons
import {
  Loader2,
  Plus,
  Search,
  CheckCircle2,
  FileQuestion,
  FolderOpen,
  ChevronRight,
  Trash2,
  Pencil,
  FolderPlus,
  Layers,
  Sparkles,
  Database,
  ListTree,
  Hash,
  Building2,
  Smartphone,
  Wand2,
  ArrowUpDown,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api-client"
import { toast } from "sonner"
import { EASE, FooterPill, PageBackground } from "@/components/dashboard-shell"

// -- Types --
type EntityType = "ORG" | "APP"

type Question = {
  id: string
  question: string
  options: string | null
  entity_type: EntityType
  category_id: string
}

type GroupedCategory = {
  category_id: string
  category_name: string
  order: number | null
  questions: Question[]
}

type CategoryData = {
  id: string
  name: string
  entity_type: EntityType
  order: number | null
}

// -- Main Component --
export default function QuestionsAdminPage() {
  // View state
  const [activeTab, setActiveTab] = useState<"view" | "add" | "categories">(
    "view"
  )
  const [entityFilter, setEntityFilter] = useState<EntityType>("ORG")
  const [searchQuery, setSearchQuery] = useState("")
  const [groupedData, setGroupedData] = useState<GroupedCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  )

  // Add form state
  const [newQuestion, setNewQuestion] = useState("")
  const [newOptions, setNewOptions] = useState("")
  const [newEntityType, setNewEntityType] = useState<EntityType>("ORG")
  const [newCategoryId, setNewCategoryId] = useState("")
  const [bulkJson, setBulkJson] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Category management state
  const [allCategories, setAllCategories] = useState<CategoryData[]>([])
  const [catEntityFilter, setCatEntityFilter] = useState<EntityType | "ALL">(
    "ALL"
  )
  const [catLoading, setCatLoading] = useState(false)
  const [newCatName, setNewCatName] = useState("")
  const [newCatEntityType, setNewCatEntityType] = useState<EntityType>("ORG")
  const [newCatOrder, setNewCatOrder] = useState("")
  const [catSubmitting, setCatSubmitting] = useState(false)
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [editCatName, setEditCatName] = useState("")
  const [editCatOrder, setEditCatOrder] = useState("")

  // -- Fetch grouped questions --
  const fetchGrouped = async (et: EntityType) => {
    setLoading(true)
    try {
      const json = await api.get(`/questions/grouped?entity_type=${et}`)
      setGroupedData(json?.data || [])
      const ids = new Set<string>(
        (json?.data || []).map((c: GroupedCategory) => c.category_id)
      )
      setExpandedCategories(ids)
    } catch (e: any) {
      toast.error(e?.message || "Failed to load questions")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGrouped(entityFilter)
  }, [entityFilter])

  // -- Derived data --
  const totalQuestions = useMemo(
    () => groupedData.reduce((sum, cat) => sum + cat.questions.length, 0),
    [groupedData]
  )

  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return groupedData
    const q = searchQuery.toLowerCase()
    return groupedData
      .map((cat) => ({
        ...cat,
        questions: cat.questions.filter(
          (question) =>
            question.question.toLowerCase().includes(q) ||
            question.id.toLowerCase().includes(q)
        ),
      }))
      .filter(
        (cat) =>
          cat.questions.length > 0 ||
          cat.category_name.toLowerCase().includes(q)
      )
  }, [groupedData, searchQuery])

  // Filtered question count after search
  const filteredCount = useMemo(
    () => filteredData.reduce((sum, c) => sum + c.questions.length, 0),
    [filteredData]
  )

  // Cross-entity totals for stats strip
  const orgCount = useMemo(() => {
    if (entityFilter === "ORG") return totalQuestions
    return allCategories.filter((c) => c.entity_type === "ORG").length // best effort
  }, [entityFilter, totalQuestions, allCategories])

  // -- All category ids for dropdown (filtered by selected entity type) --
  const categoryOptions = useMemo(() => {
    return allCategories
      .filter((c) => c.entity_type === newEntityType)
      .map((c) => ({ id: c.id, name: c.name }))
  }, [allCategories, newEntityType])

  // -- Toggle category expand --
  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  const expandAll = () => {
    setExpandedCategories(
      new Set(filteredData.map((c) => c.category_id))
    )
  }

  const collapseAll = () => {
    setExpandedCategories(new Set())
  }

  // -- Single question submit --
  const handleAddSingle = async () => {
    if (!newQuestion.trim() || !newCategoryId) {
      toast.error("Question text and category are required")
      return
    }
    setSubmitting(true)
    try {
      const body = {
        question: newQuestion.trim(),
        options: newOptions.trim() || null,
        entity_type: newEntityType,
        category_id: newCategoryId,
      }
      await api.post("/questions", body)
      toast.success("Question created")
      setNewQuestion("")
      setNewOptions("")
      fetchGrouped(entityFilter)
      setActiveTab("view")
    } catch (e: any) {
      toast.error(e?.message || "Failed to create question")
    } finally {
      setSubmitting(false)
    }
  }

  // -- Bulk submit --
  const handleAddBulk = async () => {
    if (!bulkJson.trim()) {
      toast.error("Please enter questions JSON")
      return
    }
    let parsed: any
    try {
      parsed = JSON.parse(bulkJson)
    } catch {
      toast.error("Invalid JSON format")
      return
    }

    const questions = Array.isArray(parsed) ? parsed : parsed.questions
    if (!Array.isArray(questions) || questions.length === 0) {
      toast.error('Expected an array or { "questions": [...] }')
      return
    }

    setSubmitting(true)
    try {
      const res = await api.post("/questions/bulk", { questions })
      toast.success(res?.message || `${questions.length} question(s) created`)
      setBulkJson("")
      fetchGrouped(entityFilter)
      setActiveTab("view")
    } catch (e: any) {
      toast.error(e?.message || "Bulk create failed")
    } finally {
      setSubmitting(false)
    }
  }

  // -- Category CRUD --
  const fetchCategories = async () => {
    setCatLoading(true)
    try {
      const json = await api.get("/categories")
      setAllCategories(json?.data || [])
    } catch (e: any) {
      toast.error(e?.message || "Failed to load categories")
    } finally {
      setCatLoading(false)
    }
  }

  // Filtered list for the Categories tab display
  const filteredCategories = useMemo(() => {
    if (catEntityFilter === "ALL") return allCategories
    return allCategories.filter((c) => c.entity_type === catEntityFilter)
  }, [allCategories, catEntityFilter])

  useEffect(() => {
    if (activeTab === "categories" || activeTab === "add") fetchCategories()
  }, [activeTab])

  // Load categories at mount so the stats strip is populated
  useEffect(() => {
    fetchCategories()
  }, [])

  // Reset category selection when entity type changes in Add form
  useEffect(() => {
    setNewCategoryId("")
  }, [newEntityType])

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) {
      toast.error("Category name is required")
      return
    }
    setCatSubmitting(true)
    try {
      await api.post("/categories", {
        name: newCatName.trim(),
        entity_type: newCatEntityType,
        order: newCatOrder ? parseFloat(newCatOrder) : null,
      })
      toast.success("Category created")
      setNewCatName("")
      setNewCatOrder("")
      fetchCategories()
      fetchGrouped(entityFilter)
    } catch (e: any) {
      toast.error(e?.message || "Failed to create category")
    } finally {
      setCatSubmitting(false)
    }
  }

  const startEditCategory = (cat: CategoryData) => {
    setEditingCatId(cat.id)
    setEditCatName(cat.name)
    setEditCatOrder(cat.order != null ? String(cat.order) : "")
  }

  const handleUpdateCategory = async () => {
    if (!editingCatId) return
    setCatSubmitting(true)
    try {
      await api.put(`/categories/${editingCatId}`, {
        name: editCatName.trim() || undefined,
        order: editCatOrder ? parseFloat(editCatOrder) : undefined,
      })
      toast.success("Category updated")
      setEditingCatId(null)
      fetchCategories()
      fetchGrouped(entityFilter)
    } catch (e: any) {
      toast.error(e?.message || "Failed to update category")
    } finally {
      setCatSubmitting(false)
    }
  }

  const handleDeleteCategory = async (catId: string) => {
    if (!confirm("Delete this category? It must have 0 questions.")) return
    try {
      await api.delete(`/categories/${catId}`)
      toast.success("Category deleted")
      fetchCategories()
      fetchGrouped(entityFilter)
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete category")
    }
  }

  // Stats derived strictly from loaded data
  const orgCats = allCategories.filter((c) => c.entity_type === "ORG").length
  const appCats = allCategories.filter((c) => c.entity_type === "APP").length

  // -- Render --
  return (
    <div className="relative min-h-[calc(100vh-var(--header-height))] overflow-hidden bg-background">
      <PageBackground accent="indigo" />

      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* --- Hero --- */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE }}
          className="mb-8"
        >
          <nav className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Admin</span>
            <ChevronRight className="size-3 text-muted-foreground/60" />
            <span className="font-medium text-foreground">Questions</span>
          </nav>

          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
            <div className="flex items-start gap-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.85, rotate: -6 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{
                  type: "spring" as const,
                  stiffness: 280,
                  damping: 18,
                  delay: 0.1,
                }}
                className="relative"
              >
                <div className="absolute inset-0 -z-10 rounded-2xl bg-indigo-500/20 blur-xl" />
                <div className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 via-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/30 ring-1 ring-inset ring-white/20">
                  <FileQuestion className="size-6 text-white" />
                </div>
              </motion.div>

              <div className="space-y-2">
                <Badge
                  variant="secondary"
                  className="gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                >
                  <Sparkles className="size-3" />
                  Admin · Question Manager
                </Badge>
                <div>
                  <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                    Manage onboarding questions
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                    View, create and organise the question bank used across
                    ORG and APP onboarding workflows.
                  </p>
                </div>
              </div>
            </div>

            {/* Health pill */}
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.2 }}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Question bank online
            </motion.div>
          </div>
        </motion.div>

        {/* --- Stats strip --- */}
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={<Building2 className="size-4" />}
            label="ORG categories"
            value={orgCats}
            accent="indigo"
            delay={0.05}
          />
          <StatCard
            icon={<Smartphone className="size-4" />}
            label="APP categories"
            value={appCats}
            accent="sky"
            delay={0.1}
          />
          <StatCard
            icon={<ListTree className="size-4" />}
            label={`${entityFilter} questions`}
            value={totalQuestions}
            accent="violet"
            delay={0.15}
          />
          <StatCard
            icon={<Database className="size-4" />}
            label="Total categories"
            value={allCategories.length}
            accent="emerald"
            delay={0.2}
          />
        </div>

        {/* --- Tabs --- */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as any)}
          className="space-y-6"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="h-10 bg-muted/60 p-1 backdrop-blur">
              <TabsTrigger value="view" className="gap-2">
                <ListTree className="size-3.5" />
                View
              </TabsTrigger>
              <TabsTrigger value="add" className="gap-2">
                <Plus className="size-3.5" />
                Add
              </TabsTrigger>
              <TabsTrigger value="categories" className="gap-2">
                <Layers className="size-3.5" />
                Categories
              </TabsTrigger>
            </TabsList>

            {/* View toolbar */}
            {activeTab === "view" && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="flex flex-wrap items-center gap-2"
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search questions…"
                    className="h-9 w-64 pl-9 pr-8"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* Entity segmented control */}
                <div className="relative flex h-9 items-center rounded-md border border-border bg-muted/40 p-0.5">
                  {(["ORG", "APP"] as const).map((et) => (
                    <button
                      key={et}
                      onClick={() => setEntityFilter(et)}
                      className={cn(
                        "relative z-10 inline-flex h-8 min-w-16 items-center justify-center gap-1.5 rounded-sm px-3 text-xs font-medium transition-colors",
                        entityFilter === et
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {entityFilter === et && (
                        <motion.span
                          layoutId="entity-active"
                          transition={{
                            type: "spring" as const,
                            stiffness: 360,
                            damping: 30,
                          }}
                          className="absolute inset-0 -z-10 rounded-sm bg-card shadow-sm ring-1 ring-inset ring-border"
                        />
                      )}
                      {et === "ORG" ? (
                        <Building2 className="size-3.5" />
                      ) : (
                        <Smartphone className="size-3.5" />
                      )}
                      {et}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {/* --- VIEW TAB --- */}
          <TabsContent value="view" className="mt-0 space-y-3">
            {/* Sub-toolbar: counts + expand controls */}
            {!loading && filteredData.length > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="inline-flex items-center gap-1.5">
                  <span>
                    <span className="font-medium tabular-nums text-foreground">
                      {filteredCount}
                    </span>{" "}
                    of{" "}
                    <span className="tabular-nums">{totalQuestions}</span>{" "}
                    question{totalQuestions !== 1 ? "s" : ""}
                  </span>
                  <span className="text-muted-foreground/60">·</span>
                  <span>
                    <span className="font-medium tabular-nums text-foreground">
                      {filteredData.length}
                    </span>{" "}
                    categor{filteredData.length === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={expandAll}
                    className="h-7 gap-1.5 px-2 text-xs"
                  >
                    <ArrowUpDown className="size-3" />
                    Expand all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={collapseAll}
                    className="h-7 gap-1.5 px-2 text-xs"
                  >
                    Collapse all
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <Card className="border-dashed">
                <CardContent className="flex items-center justify-center py-20">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : filteredData.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <FolderOpen className="size-6" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {searchQuery
                      ? "No questions match your search"
                      : `No questions found for ${entityFilter}`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {searchQuery
                      ? "Try a different keyword or clear the search."
                      : "Add a question or category to get started."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredData.map((cat, idx) => {
                  const isExpanded = expandedCategories.has(cat.category_id)
                  return (
                    <motion.div
                      key={cat.category_id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.3,
                        ease: EASE,
                        delay: 0.03 * idx,
                      }}
                    >
                      <Card className="overflow-hidden border-border/60 transition-shadow hover:shadow-md hover:shadow-foreground/5">
                        <button
                          onClick={() => toggleCategory(cat.category_id)}
                          className="group flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <motion.div
                              animate={{ rotate: isExpanded ? 90 : 0 }}
                              transition={{ duration: 0.2, ease: EASE }}
                              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-indigo-500/10 group-hover:text-indigo-600 dark:group-hover:text-indigo-300"
                            >
                              <ChevronRight className="size-4" />
                            </motion.div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {cat.category_name}
                              </p>
                              <p className="truncate font-mono text-[10px] text-muted-foreground">
                                {cat.category_id}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {cat.order != null && (
                              <Badge
                                variant="outline"
                                className="rounded-full font-mono text-[10px]"
                              >
                                #{cat.order}
                              </Badge>
                            )}
                            <Badge
                              variant="secondary"
                              className="rounded-full border-indigo-500/20 bg-indigo-500/10 font-mono text-[10px] text-indigo-600 dark:text-indigo-300"
                            >
                              {cat.questions.length} Q
                              {cat.questions.length !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                        </button>

                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25, ease: EASE }}
                              className="overflow-hidden"
                            >
                              <Separator />
                              <div className="divide-y divide-border/60">
                                {cat.questions.map((q, qIdx) => (
                                  <div
                                    key={q.id}
                                    className="group/q flex items-start gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-muted/30"
                                  >
                                    <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] font-semibold tabular-nums text-muted-foreground group-hover/q:bg-indigo-500/10 group-hover/q:text-indigo-600 dark:group-hover/q:text-indigo-300">
                                      {qIdx + 1}
                                    </span>
                                    <div className="min-w-0 flex-1 space-y-2">
                                      <p className="leading-snug text-foreground">
                                        {q.question}
                                      </p>
                                      {q.options && (
                                        <div className="flex flex-wrap gap-1.5">
                                          {q.options
                                            .split(",")
                                            .map((opt, i) => (
                                              <Badge
                                                key={i}
                                                variant="secondary"
                                                className="rounded-full text-[10px] font-medium"
                                              >
                                                {opt.trim()}
                                              </Badge>
                                            ))}
                                        </div>
                                      )}
                                    </div>
                                    <span
                                      className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground/80"
                                      title={q.id}
                                    >
                                      {q.id.slice(0, 8)}…
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </Card>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* --- ADD TAB --- */}
          <TabsContent value="add" className="mt-0">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Single Question */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <Card className="relative h-full overflow-hidden border-border/60">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
                    className="absolute inset-x-0 top-0 h-0.5 origin-left bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
                  />
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500/15 to-violet-500/15 text-indigo-600 ring-1 ring-inset ring-indigo-500/20 dark:text-indigo-300">
                        <Plus className="size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          Add a single question
                        </CardTitle>
                        <CardDescription>
                          Create one question under an existing category.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">
                          Entity type
                        </Label>
                        <Select
                          value={newEntityType}
                          onValueChange={(v) =>
                            setNewEntityType(v as EntityType)
                          }
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ORG">
                              <span className="inline-flex items-center gap-2">
                                <Building2 className="size-3.5" />
                                ORG
                              </span>
                            </SelectItem>
                            <SelectItem value="APP">
                              <span className="inline-flex items-center gap-2">
                                <Smartphone className="size-3.5" />
                                APP
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-medium">
                          Category
                        </Label>
                        <Select
                          value={newCategoryId}
                          onValueChange={setNewCategoryId}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select category…" />
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions.length === 0 && (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                No categories for {newEntityType}
                              </div>
                            )}
                            {categoryOptions.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {categoryOptions.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            Add one in the Categories tab first.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Question text <span className="text-rose-500">*</span>
                      </Label>
                      <Textarea
                        value={newQuestion}
                        onChange={(e) => setNewQuestion(e.target.value)}
                        placeholder="e.g. What authentication method does this app use?"
                        className="min-h-28 resize-y"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Options{" "}
                        <span className="font-normal text-muted-foreground">
                          · comma-separated, leave empty for free text
                        </span>
                      </Label>
                      <Input
                        value={newOptions}
                        onChange={(e) => setNewOptions(e.target.value)}
                        placeholder="e.g. OAuth2, SAML, API Key, None"
                        className="h-10"
                      />
                      {newOptions.trim() && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {newOptions
                            .split(",")
                            .map((o) => o.trim())
                            .filter(Boolean)
                            .map((opt, i) => (
                              <Badge
                                key={i}
                                variant="secondary"
                                className="rounded-full text-[10px]"
                              >
                                {opt}
                              </Badge>
                            ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="border-t border-border/60 bg-muted/30 py-3">
                    <Button
                      onClick={handleAddSingle}
                      disabled={
                        submitting ||
                        !newQuestion.trim() ||
                        !newCategoryId
                      }
                      className="w-full gap-2 bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500"
                    >
                      {submitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Create question
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>

              {/* Bulk Questions */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
              >
                <Card className="relative h-full overflow-hidden border-border/60">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
                    className="absolute inset-x-0 top-0 h-0.5 origin-left bg-linear-to-r from-slate-500 via-slate-600 to-slate-700"
                  />
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-slate-500/15 to-slate-700/15 text-slate-700 ring-1 ring-inset ring-slate-500/20 dark:text-slate-200">
                        <Wand2 className="size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          Bulk add via JSON
                        </CardTitle>
                        <CardDescription>
                          Paste a JSON array to create many questions at once.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Questions JSON
                      </Label>
                      <Textarea
                        value={bulkJson}
                        onChange={(e) => setBulkJson(e.target.value)}
                        placeholder={`[\n  {\n    "question": "What auth method?",\n    "options": "OAuth2,SAML,None",\n    "entity_type": "APP",\n    "category_id": "cat-id-here"\n  }\n]`}
                        className="min-h-60 resize-y font-mono text-xs"
                      />
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          Format:
                        </span>{" "}
                        an array of objects, or{" "}
                        <code className="rounded bg-card px-1 py-0.5 font-mono text-[10px] text-foreground">
                          {`{ "questions": [...] }`}
                        </code>
                        . Each object needs{" "}
                        <code className="rounded bg-card px-1 py-0.5 font-mono text-[10px] text-foreground">
                          question
                        </code>
                        ,{" "}
                        <code className="rounded bg-card px-1 py-0.5 font-mono text-[10px] text-foreground">
                          entity_type
                        </code>{" "}
                        (ORG/APP) and{" "}
                        <code className="rounded bg-card px-1 py-0.5 font-mono text-[10px] text-foreground">
                          category_id
                        </code>
                        .{" "}
                        <code className="rounded bg-card px-1 py-0.5 font-mono text-[10px] text-foreground">
                          options
                        </code>{" "}
                        is optional.
                      </p>
                    </div>
                  </CardContent>
                  <CardFooter className="border-t border-border/60 bg-muted/30 py-3">
                    <Button
                      onClick={handleAddBulk}
                      disabled={submitting || !bulkJson.trim()}
                      variant="default"
                      className="w-full gap-2"
                    >
                      {submitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Wand2 className="size-4" />
                      )}
                      Bulk create
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
            </div>
          </TabsContent>

          {/* --- CATEGORIES TAB --- */}
          <TabsContent value="categories" className="mt-0">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Create */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="lg:col-span-1"
              >
                <Card className="relative overflow-hidden border-border/60">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
                    className="absolute inset-x-0 top-0 h-0.5 origin-left bg-linear-to-r from-emerald-500 via-teal-500 to-sky-500"
                  />
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-emerald-500/15 to-teal-500/15 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
                        <FolderPlus className="size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          New category
                        </CardTitle>
                        <CardDescription>
                          Group related questions together.
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Category name <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="e.g. Authentication & Access Control"
                        className="h-10"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Entity type
                      </Label>
                      <Select
                        value={newCatEntityType}
                        onValueChange={(v) =>
                          setNewCatEntityType(v as EntityType)
                        }
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ORG">
                            <span className="inline-flex items-center gap-2">
                              <Building2 className="size-3.5" />
                              ORG
                            </span>
                          </SelectItem>
                          <SelectItem value="APP">
                            <span className="inline-flex items-center gap-2">
                              <Smartphone className="size-3.5" />
                              APP
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Display order{" "}
                        <span className="font-normal text-muted-foreground">
                          · optional
                        </span>
                      </Label>
                      <div className="relative">
                        <Hash className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="number"
                          value={newCatOrder}
                          onChange={(e) => setNewCatOrder(e.target.value)}
                          placeholder="1, 2, 3…"
                          className="h-10 pl-9"
                        />
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="border-t border-border/60 bg-muted/30 py-3">
                    <Button
                      onClick={handleCreateCategory}
                      disabled={catSubmitting || !newCatName.trim()}
                      className="w-full gap-2 bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25 hover:from-emerald-500 hover:to-teal-500"
                    >
                      {catSubmitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Create category
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>

              {/* List */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE, delay: 0.05 }}
                className="lg:col-span-2"
              >
                <Card className="relative overflow-hidden border-border/60">
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500/15 to-violet-500/15 text-indigo-600 ring-1 ring-inset ring-indigo-500/20 dark:text-indigo-300">
                        <Layers className="size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          All categories
                        </CardTitle>
                        <CardDescription>
                          {filteredCategories.length} categor
                          {filteredCategories.length === 1 ? "y" : "ies"}{" "}
                          shown
                        </CardDescription>
                      </div>
                    </div>

                    {/* Entity segmented */}
                    <div className="relative flex h-9 shrink-0 items-center rounded-md border border-border bg-muted/40 p-0.5">
                      {(["ALL", "ORG", "APP"] as const).map((et) => (
                        <button
                          key={et}
                          onClick={() => setCatEntityFilter(et)}
                          className={cn(
                            "relative z-10 inline-flex h-8 min-w-12 items-center justify-center rounded-sm px-2.5 text-[11px] font-medium transition-colors",
                            catEntityFilter === et
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {catEntityFilter === et && (
                            <motion.span
                              layoutId="cat-entity-active"
                              transition={{
                                type: "spring" as const,
                                stiffness: 360,
                                damping: 30,
                              }}
                              className="absolute inset-0 -z-10 rounded-sm bg-card shadow-sm ring-1 ring-inset ring-border"
                            />
                          )}
                          {et}
                        </button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {catLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredCategories.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="mb-3 flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                          <FolderOpen className="size-5" />
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          No categories found
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Use the form on the left to create one.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <AnimatePresence initial={false}>
                          {filteredCategories.map((cat, idx) => {
                            const isEditing = editingCatId === cat.id
                            return (
                              <motion.div
                                key={cat.id}
                                layout
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                transition={{
                                  duration: 0.25,
                                  ease: EASE,
                                  delay: 0.02 * idx,
                                }}
                                className={cn(
                                  "rounded-lg border border-border/60 bg-card/60 px-4 py-3 transition-colors",
                                  isEditing
                                    ? "ring-1 ring-indigo-500/30"
                                    : "hover:bg-muted/30"
                                )}
                              >
                                {isEditing ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Input
                                      value={editCatName}
                                      onChange={(e) =>
                                        setEditCatName(e.target.value)
                                      }
                                      className="h-9 flex-1 min-w-48 text-sm"
                                      placeholder="Category name"
                                      autoFocus
                                    />
                                    <Input
                                      type="number"
                                      value={editCatOrder}
                                      onChange={(e) =>
                                        setEditCatOrder(e.target.value)
                                      }
                                      placeholder="Order"
                                      className="h-9 w-24 text-sm"
                                    />
                                    <Button
                                      size="sm"
                                      onClick={handleUpdateCategory}
                                      disabled={catSubmitting}
                                      className="h-9 gap-1.5 bg-linear-to-br from-indigo-500 to-violet-600 text-white"
                                    >
                                      {catSubmitting ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                      ) : (
                                        <CheckCircle2 className="size-3.5" />
                                      )}
                                      Save
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setEditingCatId(null)}
                                      className="h-9"
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <div
                                        className={cn(
                                          "flex size-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
                                          cat.entity_type === "ORG"
                                            ? "bg-indigo-500/10 text-indigo-600 ring-indigo-500/20 dark:text-indigo-300"
                                            : "bg-sky-500/10 text-sky-600 ring-sky-500/20 dark:text-sky-300"
                                        )}
                                      >
                                        {cat.entity_type === "ORG" ? (
                                          <Building2 className="size-4" />
                                        ) : (
                                          <Smartphone className="size-4" />
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-foreground">
                                          {cat.name}
                                        </p>
                                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                          <Badge
                                            variant="outline"
                                            className="h-4 rounded px-1.5 text-[10px]"
                                          >
                                            {cat.entity_type}
                                          </Badge>
                                          {cat.order != null && (
                                            <span className="font-mono text-[10px] text-muted-foreground">
                                              order {cat.order}
                                            </span>
                                          )}
                                          <span
                                            className="truncate font-mono text-[10px] text-muted-foreground/80"
                                            title={cat.id}
                                          >
                                            {cat.id.slice(0, 8)}…
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          startEditCategory(cat)
                                        }
                                        className="size-8 p-0 hover:text-indigo-600 dark:hover:text-indigo-300"
                                        aria-label="Edit"
                                      >
                                        <Pencil className="size-3.5" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          handleDeleteCategory(cat.id)
                                        }
                                        className="size-8 p-0 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                                        aria-label="Delete"
                                      >
                                        <Trash2 className="size-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </motion.div>
                            )
                          })}
                        </AnimatePresence>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <FooterPill label="Blanc Questions · v1" tone="indigo" />
    </div>
  )
}

// ------------- Helpers -------------

type AccentKey = "indigo" | "violet" | "sky" | "emerald"

const ACCENT: Record<
  AccentKey,
  { plate: string; ring: string; text: string }
> = {
  indigo: {
    plate: "from-indigo-500/15 to-violet-500/15",
    ring: "ring-indigo-500/20",
    text: "text-indigo-600 dark:text-indigo-300",
  },
  violet: {
    plate: "from-violet-500/15 to-fuchsia-500/15",
    ring: "ring-violet-500/20",
    text: "text-violet-600 dark:text-violet-300",
  },
  sky: {
    plate: "from-sky-500/15 to-blue-500/15",
    ring: "ring-sky-500/20",
    text: "text-sky-600 dark:text-sky-300",
  },
  emerald: {
    plate: "from-emerald-500/15 to-teal-500/15",
    ring: "ring-emerald-500/20",
    text: "text-emerald-600 dark:text-emerald-400",
  },
}

function StatCard({
  icon,
  label,
  value,
  accent,
  delay = 0,
}: {
  icon: React.ReactNode
  label: string
  value: number
  accent: AccentKey
  delay?: number
}) {
  const a = ACCENT[accent]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE, delay }}
    >
      <Card className="relative overflow-hidden border-border/60 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-foreground/5">
        <CardContent className="flex items-center gap-3 p-4">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br ring-1 ring-inset",
              a.plate,
              a.ring,
              a.text
            )}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </p>
            <motion.p
              key={value}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="font-mono text-xl font-semibold tabular-nums"
            >
              {value}
            </motion.p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
