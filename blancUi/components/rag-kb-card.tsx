"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Scale,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { API_BASE } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/dashboard-shell";

export const MAX_BYTES = 25 * 1024 * 1024;

export type KBAccent = "indigo" | "rose" | "emerald";

export type KBConfig = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  accent: KBAccent;
  tags: string[];
};

export const KB_REGISTRY: Record<string, KBConfig> = {
  knowledge_base: {
    id: "knowledge_base",
    title: "Core Intelligence",
    subtitle: "General Knowledge Base",
    description:
      "Standard operating procedures, product specs, and general business documentation.",
    icon: BookOpen,
    accent: "indigo",
    tags: ["Product", "Wiki", "Docs"],
  },
  security_related_knowledgebase: {
    id: "security_related_knowledgebase",
    title: "Security Shield",
    subtitle: "Infrastructure & Cyber",
    description:
      "Security protocols, threat models, network architecture, and vulnerability reports.",
    icon: ShieldCheck,
    accent: "rose",
    tags: ["Auth", "Network", "Pentest"],
  },
  compliance_related_knowledgebase: {
    id: "compliance_related_knowledgebase",
    title: "Regulator Guard",
    subtitle: "Compliance & Governance",
    description:
      "Legal frameworks, audit logs, GDPR/ISO standards, and regulatory requirements.",
    icon: Scale,
    accent: "emerald",
    tags: ["Legal", "Audit", "ISO"],
  },
};

const ACCENT_STYLES: Record<
  KBAccent,
  {
    strip: string;
    iconWrap: string;
    iconRing: string;
    badge: string;
    dragBorder: string;
    dragBg: string;
    dragIconBg: string;
    dragIconShadow: string;
    dragRing: string;
    spinner: string;
  }
> = {
  indigo: {
    strip: "bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500",
    iconWrap:
      "bg-linear-to-br from-indigo-500 via-indigo-500 to-violet-600 text-white",
    iconRing: "ring-indigo-500/30",
    badge:
      "border-indigo-500/30 bg-indigo-500/5 text-indigo-700 dark:text-indigo-300",
    dragBorder: "border-indigo-500/60",
    dragBg: "bg-indigo-500/5",
    dragIconBg: "bg-indigo-500 text-white",
    dragIconShadow: "shadow-indigo-500/30",
    dragRing: "ring-indigo-500/40",
    spinner: "text-indigo-500",
  },
  rose: {
    strip: "bg-linear-to-r from-rose-500 via-pink-500 to-fuchsia-500",
    iconWrap:
      "bg-linear-to-br from-rose-500 via-rose-500 to-pink-600 text-white",
    iconRing: "ring-rose-500/30",
    badge:
      "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
    dragBorder: "border-rose-500/60",
    dragBg: "bg-rose-500/5",
    dragIconBg: "bg-rose-500 text-white",
    dragIconShadow: "shadow-rose-500/30",
    dragRing: "ring-rose-500/40",
    spinner: "text-rose-500",
  },
  emerald: {
    strip: "bg-linear-to-r from-emerald-500 via-teal-500 to-sky-500",
    iconWrap:
      "bg-linear-to-br from-emerald-500 via-emerald-500 to-teal-600 text-white",
    iconRing: "ring-emerald-500/30",
    badge:
      "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    dragBorder: "border-emerald-500/60",
    dragBg: "bg-emerald-500/5",
    dragIconBg: "bg-emerald-500 text-white",
    dragIconShadow: "shadow-emerald-500/30",
    dragRing: "ring-emerald-500/40",
    spinner: "text-emerald-500",
  },
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function KBUploadCard({
  kb,
  index = 0,
}: {
  kb: KBConfig;
  index?: number;
}) {
  const Icon = kb.icon;
  const styles = ACCENT_STYLES[kb.accent];

  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState("");
  const [notes, setNotes] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onSelectFile = useCallback((f: File | null) => {
    setError(null);
    if (!f) return setFile(null);
    if (f.type !== "application/pdf") {
      setError("Only PDF files are allowed.");
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File too large. Max 25 MB.");
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelectFile(e.target.files?.[0] || null);
  };
  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    onSelectFile(e.dataTransfer.files?.[0] ?? null);
  };
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const canSubmit = useMemo(
    () => !!file && projectName.trim().length > 0 && !uploading,
    [file, projectName, uploading],
  );

  const clearFile = () => setFile(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a PDF first.");
      return;
    }
    if (!projectName.trim()) {
      setError("Project name is required.");
      return;
    }

    try {
      setUploading(true);
      setProgress(10);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_name", projectName);
      formData.append("kb_type", kb.id);
      if (notes.trim()) formData.append("notes", notes);

      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null;

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/create-rag`);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 70);
          setProgress(Math.max(10, Math.min(70, pct)));
        }
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress(100);
          toast.success(`Indexed into ${kb.title}.`);
          setUploading(false);
          setFile(null);
          setProjectName("");
          setNotes("");
          setTimeout(() => setProgress(0), 800);
        } else {
          setError(xhr.responseText || "Upload failed");
          setUploading(false);
          setProgress(0);
        }
      };

      xhr.onerror = () => {
        setError("Network error while uploading.");
        setUploading(false);
        setProgress(0);
      };

      xhr.send(formData);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.08 + index * 0.06, ease: EASE }}
    >
      <Card className="gap-0 overflow-hidden border-border/70 py-0 shadow-sm">
        <motion.div
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.15 + index * 0.06, ease: EASE }}
          style={{ transformOrigin: "left" }}
          className={cn("h-[3px] w-full", styles.strip)}
        />

        <CardHeader className="gap-3 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <motion.div
                initial={{ scale: 0.85, rotate: -8, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{
                  delay: 0.05 + index * 0.06,
                  type: "spring" as const,
                  stiffness: 260,
                  damping: 18,
                }}
                whileHover={{ rotate: -4, scale: 1.05 }}
                className={cn(
                  "relative grid size-11 shrink-0 place-items-center rounded-2xl shadow-md ring-1",
                  styles.iconWrap,
                  styles.iconRing,
                )}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-b from-white/25 to-transparent"
                />
                <Icon className="relative size-5" />
              </motion.div>
              <div className="min-w-0">
                <CardTitle className="text-base">{kb.title}</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  {kb.description}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {kb.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </CardHeader>
        <Separator className="bg-border/60" />

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <Label htmlFor={`projectName-${kb.id}`} className="text-xs">
                Project name
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Input
                id={`projectName-${kb.id}`}
                placeholder="e.g. Payments Service Threat Model"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                required
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`notes-${kb.id}`} className="text-xs">
                Notes
                <span className="ml-1 text-muted-foreground/60">
                  (optional)
                </span>
              </Label>
              <Textarea
                id={`notes-${kb.id}`}
                placeholder="Any context, tags, or description to store with this RAG corpus."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">
                PDF file
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <motion.label
                htmlFor={`pdf-${kb.id}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                animate={{ scale: dragActive ? 1.01 : 1 }}
                transition={{ type: "spring" as const, stiffness: 300, damping: 22 }}
                className={cn(
                  "relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                  dragActive
                    ? cn(styles.dragBorder, styles.dragBg)
                    : "border-border/60 hover:bg-muted/50",
                )}
              >
                <motion.div
                  animate={{
                    y: dragActive ? -2 : 0,
                    scale: dragActive ? 1.05 : 1,
                  }}
                  transition={{ type: "spring" as const, stiffness: 280, damping: 18 }}
                  className={cn(
                    "relative grid size-12 place-items-center rounded-xl transition-colors",
                    dragActive
                      ? cn(
                          "shadow-md",
                          styles.dragIconBg,
                          styles.dragIconShadow,
                        )
                      : "bg-muted text-foreground/80",
                  )}
                >
                  <Upload className="size-5" />
                  {dragActive && (
                    <motion.span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute -inset-1 rounded-xl ring-2",
                        styles.dragRing,
                      )}
                      animate={{
                        scale: [1, 1.1, 1],
                        opacity: [0.7, 0, 0.7],
                      }}
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
                  id={`pdf-${kb.id}`}
                  type="file"
                  accept="application/pdf"
                  onChange={handleInputChange}
                  className="hidden"
                />
              </motion.label>

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
                      <Loader2
                        className={cn(
                          "size-3.5 animate-spin",
                          styles.spinner,
                        )}
                      />
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
                  <CheckCircle2 />
                  Create RAG
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </motion.div>
  );
}
