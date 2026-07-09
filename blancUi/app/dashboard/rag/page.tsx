"use client"

import React, { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { API_BASE } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { EASE, FooterPill, PageBackground } from "@/components/dashboard-shell"

const MAX_BYTES = 25 * 1024 * 1024

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function CreateRagPage() {
  const router = useRouter()

  const [file, setFile] = useState<File | null>(null)
  const [projectName, setProjectName] = useState("")
  const [notes, setNotes] = useState("")
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)

  const onSelectFile = useCallback((f: File | null) => {
    setError(null)
    if (!f) return setFile(null)
    if (f.type !== "application/pdf") {
      setError("Only PDF files are allowed.")
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setError("File too large. Max 25 MB.")
      setFile(null)
      return
    }
    setFile(f)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelectFile(e.target.files?.[0] || null)
  }

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    onSelectFile(e.dataTransfer.files?.[0] ?? null)
  }
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }
  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  const canSubmit = useMemo(
    () => !!file && projectName.trim().length > 0 && !uploading,
    [file, projectName, uploading],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!file) {
      setError("Choose a PDF first.")
      return
    }
    if (!projectName.trim()) {
      setError("Project name is required.")
      return
    }

    try {
      setUploading(true)
      setProgress(10)

      const formData = new FormData()
      formData.append("file", file)
      formData.append("project_name", projectName)
      if (notes.trim()) formData.append("notes", notes)

      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null

      const xhr = new XMLHttpRequest()
      xhr.open("POST", `${API_BASE}/create-rag`)
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 70)
          setProgress(Math.max(10, Math.min(70, pct)))
        }
      }

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return
        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress(90)
          try {
            const data = JSON.parse(xhr.responseText || "{}")
            const id =
              data.jobId || data.id || data.ragId || data.assessmentId
            setProgress(100)
            router.push(id ? `/rag/${id}` : "/rag")
          } catch {
            setProgress(100)
            router.push("/rag")
          }
        } else {
          setError(xhr.responseText || "Upload failed")
          setUploading(false)
          setProgress(0)
        }
      }

      xhr.onerror = () => {
        setError("Network error while uploading.")
        setUploading(false)
        setProgress(0)
      }

      xhr.send(formData)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong."
      setError(message)
      setUploading(false)
      setProgress(0)
    }
  }

  const clearFile = () => setFile(null)

  const stepReady = {
    name: projectName.trim().length > 0,
    file: !!file,
  }

  return (
    <div className="relative min-h-[calc(100vh-var(--header-height))] overflow-hidden bg-background">
      <PageBackground accent="indigo" />

      <div className="mx-auto max-w-5xl px-6 py-10 lg:py-12">
        {/* --- Breadcrumb / Back link --- */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-6"
        >
          <Link
            href="/dashboard/admin"
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Admin
            <span className="text-muted-foreground/40">/</span>
            <span className="font-medium text-foreground">Knowledge Base</span>
          </Link>
        </motion.div>

        {/* --- Hero --- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="mb-8 flex flex-wrap items-start justify-between gap-4"
        >
          <div className="flex items-center gap-4">
            <motion.div
              initial={{ scale: 0.85, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ delay: 0.05, type: "spring" as const, stiffness: 260, damping: 18 }}
              whileHover={{ rotate: -4, scale: 1.05 }}
              className="relative grid size-12 place-items-center rounded-2xl bg-linear-to-br from-indigo-500 via-indigo-500 to-violet-600 text-white shadow-md ring-1 ring-indigo-500/30"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-b from-white/25 to-transparent"
              />
              <BookOpen className="relative size-5" />
            </motion.div>
            <div>
              <Badge
                variant="outline"
                className="mb-2 gap-1 rounded-full border-indigo-500/30 bg-indigo-500/5 px-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300"
              >
                <Sparkles className="size-2.5" />
                Retrieval · Augmented · Generation
              </Badge>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">
                Create RAG from PDF
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a PDF to start building your Retrieval-Augmented
                Generation index.
              </p>
            </div>
          </div>

          {/* Step indicator */}
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.3 }}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 shadow-xs backdrop-blur"
          >
            <StepDot done={stepReady.name} label="Name" />
            <span className="text-muted-foreground/40">·</span>
            <StepDot done={stepReady.file} label="File" />
            <span className="text-muted-foreground/40">·</span>
            <StepDot done={uploading || progress === 100} label="Upload" pulse={uploading} />
          </motion.div>
        </motion.div>

        {/* --- Main grid --- */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Form card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08, ease: EASE }}
          >
            <Card className="gap-0 overflow-hidden border-border/70 py-0 shadow-sm">
              {/* Top accent strip */}
              <motion.div
                aria-hidden
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
                style={{ transformOrigin: "left" }}
                className="h-[3px] w-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
              />
              <CardHeader className="gap-1 pt-6">
                <CardTitle className="text-base">Document upload</CardTitle>
                <CardDescription className="text-xs">
                  Provide a name and notes, then attach a PDF (max 25 MB).
                </CardDescription>
              </CardHeader>
              <Separator className="bg-border/60" />

              <form onSubmit={handleSubmit}>
                <CardContent className="space-y-6 pt-6">
                  {/* Project name */}
                  <div className="space-y-2">
                    <Label htmlFor="projectName" className="text-xs">
                      Project name
                      <span className="ml-1 text-destructive">*</span>
                    </Label>
                    <Input
                      id="projectName"
                      placeholder="e.g. Payments Service Threat Model"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      required
                      className="h-10"
                    />
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <Label htmlFor="notes" className="text-xs">
                      Notes
                      <span className="ml-1 text-muted-foreground/60">
                        (optional)
                      </span>
                    </Label>
                    <Textarea
                      id="notes"
                      placeholder="Any context, tags, or description to store with this RAG corpus."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="resize-none"
                    />
                  </div>

                  {/* Drop zone */}
                  <div className="space-y-2">
                    <Label className="text-xs">
                      PDF file
                      <span className="ml-1 text-destructive">*</span>
                    </Label>
                    <motion.label
                      htmlFor="pdf"
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      animate={{
                        scale: dragActive ? 1.01 : 1,
                      }}
                      transition={{ type: "spring" as const, stiffness: 300, damping: 22 }}
                      className={cn(
                        "relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                        dragActive
                          ? "border-indigo-500/60 bg-indigo-500/5"
                          : "border-border/60 hover:bg-muted/50",
                      )}
                    >
                      {/* Glow on drag */}
                      <AnimatePresence>
                        {dragActive && (
                          <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            aria-hidden
                            className="pointer-events-none absolute inset-0 bg-linear-to-br from-indigo-500/10 via-transparent to-violet-500/10"
                          />
                        )}
                      </AnimatePresence>

                      <motion.div
                        animate={{
                          y: dragActive ? -2 : 0,
                          scale: dragActive ? 1.05 : 1,
                        }}
                        transition={{ type: "spring" as const, stiffness: 280, damping: 18 }}
                        className={cn(
                          "relative grid size-12 place-items-center rounded-xl transition-colors",
                          dragActive
                            ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/30"
                            : "bg-muted text-foreground/80",
                        )}
                      >
                        <Upload className="size-5" />
                        {dragActive && (
                          <motion.span
                            aria-hidden
                            className="pointer-events-none absolute -inset-1 rounded-xl ring-2 ring-indigo-500/40"
                            animate={{ scale: [1, 1.1, 1], opacity: [0.7, 0, 0.7] }}
                            transition={{ duration: 1.6, repeat: Infinity }}
                          />
                        )}
                      </motion.div>
                      <div className="relative text-sm">
                        <span className="font-medium text-foreground">
                          Click to upload
                        </span>{" "}
                        <span className="text-muted-foreground">
                          or drag &amp; drop
                        </span>
                      </div>
                      <div className="relative text-xs text-muted-foreground">
                        Only PDF · max 25 MB
                      </div>
                      <input
                        ref={inputRef}
                        id="pdf"
                        type="file"
                        accept="application/pdf"
                        onChange={handleInputChange}
                        className="hidden"
                      />
                    </motion.label>

                    {/* File preview */}
                    <AnimatePresence>
                      {file && (
                        <motion.div
                          key="file-preview"
                          initial={{ opacity: 0, y: 8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.98 }}
                          transition={{ duration: 0.25, ease: EASE }}
                          className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                              <FileText className="size-4" />
                            </div>
                            <div className="min-w-0 text-sm">
                              <div className="truncate font-medium text-foreground">
                                {file.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatBytes(file.size)} · PDF
                              </div>
                            </div>
                          </div>
                          {!uploading && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={clearFile}
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label="Remove file"
                            >
                              <X className="size-4" />
                            </Button>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Progress */}
                  <AnimatePresence>
                    {uploading && (
                      <motion.div
                        key="progress"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        className="space-y-2 overflow-hidden"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                            <Loader2 className="size-3.5 animate-spin text-indigo-500" />
                            Uploading &amp; processing…
                          </span>
                          <motion.span
                            key={progress}
                            initial={{ opacity: 0, y: -3 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="tabular-nums font-semibold text-foreground"
                          >
                            {progress}%
                          </motion.span>
                        </div>
                        <Progress value={progress} className="h-1.5" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Error */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        key="error"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Alert variant="destructive">
                          <AlertTitle>Upload failed</AlertTitle>
                          <AlertDescription className="wrap-break-word">
                            {error}
                          </AlertDescription>
                        </Alert>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>

                <Separator className="bg-border/60" />
                <CardFooter className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lock className="size-3" />
                    Uploaded via{" "}
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      multipart/form-data
                    </Badge>
                  </div>
                  <Button
                    type="submit"
                    disabled={!canSubmit}
                    className="h-9 shadow-sm"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Creating…
                      </>
                    ) : (
                      <>
                        <Sparkles />
                        Create RAG
                      </>
                    )}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </motion.div>

          {/* Right column — tips */}
          <motion.aside
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.18, ease: EASE }}
            className="space-y-4"
          >
            <Card className="gap-2 border-border/60 bg-card/70 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Zap className="size-4 text-amber-500" />
                  What happens next
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <TipRow num={1} title="Parse">
                  Your PDF is split into chunks and OCR'd if needed.
                </TipRow>
                <TipRow num={2} title="Embed">
                  Text chunks are converted to vector embeddings.
                </TipRow>
                <TipRow num={3} title="Index">
                  Vectors are stored so future queries can retrieve relevant
                  passages.
                </TipRow>
              </CardContent>
            </Card>

            <Card className="gap-2 border-border/60 bg-card/70 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  Tips for best results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p className="flex gap-2">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-foreground/40" />
                  Use a clear, descriptive project name — you'll see it in
                  search results.
                </p>
                <p className="flex gap-2">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-foreground/40" />
                  Prefer text-based PDFs over scanned images for higher quality.
                </p>
                <p className="flex gap-2">
                  <span className="mt-1 size-1 shrink-0 rounded-full bg-foreground/40" />
                  Add notes to help teammates discover this corpus later.
                </p>
              </CardContent>
            </Card>
          </motion.aside>
        </div>
      </div>

      <FooterPill label="Blanc RAG · v1" tone="indigo" />
    </div>
  )
}

// --- helpers ----------------------------------------------------------------
function StepDot({
  done,
  label,
  pulse,
}: {
  done: boolean
  label: string
  pulse?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex size-2">
        {pulse && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400 opacity-70" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full transition-colors",
            done ? "bg-emerald-500" : "bg-muted-foreground/30",
          )}
        />
      </span>
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
          done ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </span>
  )
}

function TipRow({
  num,
  title,
  children,
}: {
  num: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-indigo-500/10 text-[10px] font-bold tabular-nums text-indigo-600 dark:text-indigo-300">
        {num}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed">{children}</p>
      </div>
    </div>
  )
}
