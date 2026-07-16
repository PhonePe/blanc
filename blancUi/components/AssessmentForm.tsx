"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  CheckCircle2,
  Loader2,
  X,
  Building2,
  ImageIcon,
  Check,
  HelpCircle,
  Search,
  Tag,
  Hash,
  Users,
  Layers,
  ZoomIn,
  ZoomOut,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

// ----------------------- Sub-components -----------------------
function ImageThumbnail({ file }: { file: File }) {
  const [src, setSrc] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1">
          <Skeleton className="absolute inset-0 h-full w-full" />
          <Loader2 className="relative z-20 h-4 w-4 animate-spin text-muted-foreground" />
          <span className="relative z-20 text-[9px] font-medium text-muted-foreground">
            Rendering...
          </span>
        </div>
      )}
      {src && (
        <img
          src={src}
          alt={file.name}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            isLoading ? "opacity-0" : "opacity-100",
          )}
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
      )}
    </div>
  );
}

function SectionDivider({
  label,
  icon: Icon,
  hint,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {hint ? (
        <span className="text-[10px] normal-case tracking-normal text-muted-foreground/70">
          · {hint}
        </span>
      ) : null}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function UploadStepHeader({
  step,
  title,
  icon: Icon,
  required,
  optional,
  status,
}: {
  /**
   * Numeric badge shown left of the title. Optional — omit in single-step
   * flows (e.g. mermaid mode where only Supporting Documents is visible)
   * so the header reads as a plain section title, not "Step 3 of N".
   */
  step?: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  required?: boolean;
  optional?: boolean;
  status?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {step ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-foreground font-mono text-[10px] font-semibold text-background dark:bg-white dark:text-black">
            {step}
          </span>
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
          <span className="truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {required && <span className="text-xs text-foreground">*</span>}
          {optional && (
            <span className="text-[11px] font-normal text-muted-foreground">
              (optional)
            </span>
          )}
        </div>
      </div>
      {status ? (
        <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
          {status}
        </Badge>
      ) : null}
    </div>
  );
}

// ----------------------- Types -----------------------
type Organization = { id: string; name: string };
type Application = { id: string; name: string; org_id: string };

type ExtractedImage = {
  page: number;
  index: number;
  ext: string;
  width: number;
  height: number;
  data_url: string;
  selected: boolean;
};

type ExistingAssessment = {
  assessment_id: string;
  feature_name: string;
  feature_version: string;
  app_name: string;
};

const DIAGRAM_OPTIONS = [
  { value: "flowchart TD", label: "Flowchart", description: "Top-down data / control flow diagram", icon: "🔀" },
  { value: "sequenceDiagram", label: "Sequence Diagram", description: "Interaction between components over time", icon: "🔄" },
  { value: "C4Context", label: "C4 Context", description: "High-level system context boundary diagram", icon: "🏗️" },
];


// ----------------------- Helpers -----------------------
function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="ml-1 inline h-3.5 w-3.5 cursor-help text-muted-foreground hover:text-foreground" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function bumpVersion(existing: string, type: "major" | "minor"): string {
  const match = existing.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) return type === "major" ? "2.0.0" : "1.1.0";
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = match[3] !== undefined ? parseInt(match[3], 10) : 0;
  if (type === "major") return `${major + 1}.0.0`;
  return `${major}.${minor + 1}.${patch}`;
}

// ----------------------- Schema -----------------------
const formSchema = z.object({
  org_name: z.string().min(1, "Organization is required"),
  app_name: z.string().min(1, "App Name is required"),
  assessment_name: z.string().min(2, "Assessment name is required"),
  version_type: z.enum(["major", "minor", "new"]).optional(),
  feature_version: z.string().min(1, "Version is required"),
  team: z.string().min(1, "Team name is required"),
  pod: z.string().optional(),
  sub_pod: z.string().optional(),
  // Optional at schema level — the mermaid-mode caller submits without
  // uploads. onSubmit enforces "images OR mermaidTexts" at runtime.
  images: z.any().optional(),
});

export interface AssessmentFormProps {
  /** Mermaid diagrams (one or more) to submit instead of uploaded images.
   *  When set, the form hides the image-upload section entirely and
   *  posts `mermaid_texts[]` to /assessment/new. */
  mermaidTexts?: string[];
  /** Called after a successful mermaid-mode submit — the Blanc Studio
   *  parent uses this to close its dialog. Image-mode callers can
   *  ignore it (the form router.pushes on its own). */
  onSubmitted?: (assessmentId: string) => void;
}

export function AssessmentForm({ mermaidTexts, onSubmitted }: AssessmentFormProps = {}) {
  const isMermaidMode = !!(mermaidTexts && mermaidTexts.length > 0);
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(false);

  // Data
  const [orgs, setOrgs] = React.useState<Organization[]>([]);
  const [apps, setApps] = React.useState<Application[]>([]);
  const [metadataLoaded, setMetadataLoaded] = React.useState(false);
  const [diagramTypes, setDiagramTypes] = React.useState<string[]>([]);
  const [existingAssessments, setExistingAssessments] = React.useState<ExistingAssessment[]>([]);
  const [assessmentSearchResults, setAssessmentSearchResults] = React.useState<ExistingAssessment[]>([]);
  const [isSearching, setIsSearching] = React.useState(false);
  const [showSearchResults, setShowSearchResults] = React.useState(false);
  const [matchedExisting, setMatchedExisting] = React.useState<ExistingAssessment | null>(null);

  // Upload: images (multiple) + single PDF (optional)
  const [pdfInputFile, setPdfInputFile] = React.useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = React.useState<string | null>(null);

  // PDF extraction
  const [extractedImages, setExtractedImages] = React.useState<ExtractedImage[]>([]);
  const [isExtractingPdf, setIsExtractingPdf] = React.useState(false);

  // Supporting documents (optional, multiple PDFs)
  const [supportingDocs, setSupportingDocs] = React.useState<File[]>([]);

  // Diagram type dialog
  const [diagramDialogOpen, setDiagramDialogOpen] = React.useState(false);
  const [diagramDialogIdx, setDiagramDialogIdx] = React.useState<number>(0);
  const [previewImage, setPreviewImage] = React.useState<ExtractedImage | null>(null);
  const [previewZoom, setPreviewZoom] = React.useState(1);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      org_name: "",
      app_name: "",
      assessment_name: "",
      version_type: "new",
      feature_version: "1.0.0",
      team: "",
      pod: "",
      sub_pod: "",
      images: null,
    },
  });

  // Watchers
  const imagesRef = form.watch("images");
  const selectedImages: File[] = imagesRef ? Array.from(imagesRef as FileList) : [];
  const selectedOrgName = form.watch("org_name");
  const assessmentName = form.watch("assessment_name");

  const filteredApps = React.useMemo(
    () =>
      selectedOrgName
        ? apps.filter((a) => a.org_id === orgs.find((o) => o.name === selectedOrgName)?.id)
        : apps,
    [apps, orgs, selectedOrgName],
  );
  const appName = form.watch("app_name");
  const versionType = form.watch("version_type");

  // Auto-generated fields
  const artifactName = React.useMemo(() => {
    if (!assessmentName) return "";
    const dtLabel = diagramTypes[0]
      ? DIAGRAM_OPTIONS.find((d) => d.value === diagramTypes[0])?.label || diagramTypes[0]
      : "Assessment";
    return `${assessmentName} - ${dtLabel}`;
  }, [assessmentName, diagramTypes]);

  const artifactId = React.useMemo(() => {
    if (!assessmentName) return "";
    const slug = assessmentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `BLANC-${slug}-${Date.now().toString(36).slice(-4)}`;
  }, [assessmentName]);

  // Clean up PDF preview URL on unmount
  React.useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  // ---------- PDF extraction ----------
  const handleExtractPdfImages = async (file: File) => {
    setIsExtractingPdf(true);
    setExtractedImages([]);
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await api.post(`/assessment/extract-pdf-images`, fd);
      const rawImages = res?.data?.images || res?.images || [];
      const images: ExtractedImage[] = rawImages.map((img: any) => ({
        ...img,
        selected: false,
      }));
      if (images.length === 0) {
        toast.warning("No images found in the PDF");
      } else {
        setExtractedImages(images);
        toast.success(`Found ${images.length} image(s) in PDF`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to extract images from PDF");
    } finally {
      setIsExtractingPdf(false);
    }
  };

  const addExtractedImagesToForm = () => {
    const selected = extractedImages.filter((img) => img.selected);
    if (selected.length === 0) {
      toast.error("Please select at least one image");
      return;
    }
    const dt = new DataTransfer();
    selectedImages.forEach((f) => dt.items.add(f));
    const newDiagramTypes = [...diagramTypes];

    selected.forEach((img) => {
      const byteString = atob(img.data_url.split(",")[1]);
      const mimeString = img.data_url.split(",")[0].split(":")[1].split(";")[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let j = 0; j < byteString.length; j++) ia[j] = byteString.charCodeAt(j);
      const blob = new Blob([ab], { type: mimeString });
      const file = new window.File(
        [blob],
        `pdf_extract_p${img.page}_${img.index}.${img.ext}`,
        { type: mimeString },
      );
      dt.items.add(file);
      newDiagramTypes.push("");
    });

    form.setValue("images", dt.files, { shouldValidate: true });
    setDiagramTypes(newDiagramTypes);
    setExtractedImages([]);
    toast.success(`Added ${selected.length} image(s) from PDF`);
  };

  const openExtractedImagePreview = (image: ExtractedImage) => {
    setPreviewImage(image);
    setPreviewZoom(1);
  };

  const updatePreviewZoom = (delta: number) => {
    setPreviewZoom((prev) => Math.max(0.5, Math.min(3, Number((prev + delta).toFixed(2)))));
  };

  // ---------- Fetch metadata ----------
  React.useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [orgRes, appRes] = await Promise.all([
          api.get(`/org/all`),
          api.get(`/app/all`),
        ]);
        if (orgRes?.data) setOrgs(orgRes.data);
        if (appRes?.data) setApps(appRes.data);
      } catch (err) {
        console.error("Failed to fetch metadata", err);
      } finally {
        setMetadataLoaded(true);
      }
    };
    fetchMetadata();
  }, []);

  // ---------- Fetch existing assessments for autocomplete ----------
  React.useEffect(() => {
    const fetchAssessments = async () => {
      try {
        const res = await api.get(`/assessment/list?skip=0&limit=200`);
        const list = res?.data?.assessments || res?.assessments || [];
        setExistingAssessments(
          list.map((a: any) => ({
            assessment_id: a.assessment_id,
            feature_name: a.feature_name || "",
            feature_version: a.feature_version || "",
            app_name: a.app_name || "",
          })),
        );
      } catch {
        // non-critical
      }
    };
    fetchAssessments();
  }, []);

  // ---------- Assessment name search ----------
  React.useEffect(() => {
    if (!assessmentName || assessmentName.length < 2) {
      setAssessmentSearchResults([]);
      setMatchedExisting(null);
      setShowSearchResults(false);
      return;
    }
    setIsSearching(true);
    const query = assessmentName.toLowerCase();
    const results = existingAssessments.filter(
      (a) =>
        a.feature_name.toLowerCase().includes(query) &&
        (!appName || a.app_name === appName),
    );
    setAssessmentSearchResults(results);
    setShowSearchResults(results.length > 0);

    // Exact match check
    const exact = existingAssessments.find(
      (a) => a.feature_name.toLowerCase() === query,
    );
    setMatchedExisting(exact || null);
    setIsSearching(false);
  }, [assessmentName, existingAssessments, appName]);

  // ---------- Auto-calculate version ----------
  React.useEffect(() => {
    if (matchedExisting && versionType && versionType !== "new") {
      const newVer = bumpVersion(matchedExisting.feature_version, versionType);
      form.setValue("feature_version", newVer);
    } else if (!matchedExisting) {
      form.setValue("version_type", "new");
      form.setValue("feature_version", "1.0.0");
    }
  }, [matchedExisting, versionType, form]);

  // ---------- Submit ----------
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // Runtime "images OR mermaid_texts" gate — the schema only enforces
    // the shape, not the presence.
    if (!isMermaidMode && !(values.images && values.images.length > 0)) {
      toast.error("At least one architecture diagram image is required.");
      return;
    }

    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("assessment_type", "SECURITY");
      formData.append("team", values.team);
      formData.append("org_name", values.org_name);
      formData.append("app_name", values.app_name);
      formData.append("feature_name", values.assessment_name);
      formData.append("feature_version", values.feature_version);

      if (isMermaidMode) {
        // Mermaid mode — one mermaid text per DocumentAnalysis row.
        // Infer diagram_type from the first mermaid header (sequenceDiagram
        // vs flowchart). Backend applies it to every row uniformly.
        const first = (mermaidTexts![0] || "").trimStart();
        const diagramType = first.startsWith("sequenceDiagram")
          ? "sequenceDiagram"
          : "flowchart TD";
        formData.append("diagram_type", diagramType);
        for (const text of mermaidTexts!) {
          formData.append("mermaid_texts", text);
        }
      } else if (values.images && values.images.length > 0) {
        if (
          diagramTypes.length < values.images.length ||
          diagramTypes.slice(0, values.images.length).some((dt: string) => !dt)
        ) {
          setIsLoading(false);
          toast.error("Please select a diagram type for each uploaded image.");
          return;
        }
        for (let i = 0; i < values.images.length; i++) {
          formData.append("images", values.images[i]);
          formData.append("diagram_type", diagramTypes[i]);
        }
      }

      // Source PDF (used only in image mode to extract diagrams from a PDF).
      if (!isMermaidMode && pdfInputFile) {
        formData.append("pdf", pdfInputFile);
      }

      // Supporting documents for RAG (optional, multiple PDFs) — orthogonal
      // to input mode; keep them available in both flows.
      if (supportingDocs.length > 0) {
        for (const doc of supportingDocs) {
          formData.append("supporting_docs", doc);
        }
      }

      const data = await api.post(`/assessment/new`, formData);
      toast.success("Assessment created successfully");
      const assessmentId = data.data.assessment_id;
      if (onSubmitted) {
        onSubmitted(assessmentId);
      } else {
        router.push(`/dashboard/assessment/${assessmentId}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to create assessment");
    } finally {
      setIsLoading(false);
    }
  };

  // Animation
  const expandVariants = {
    hidden: { height: 0, opacity: 0, marginTop: 0 },
    visible: { height: "auto", opacity: 1, marginTop: 12, transition: { duration: 0.3 } },
    exit: { height: 0, opacity: 0, marginTop: 0, transition: { duration: 0.2 } },
  };

  // Derived status hints
  const pdfStatus = pdfInputFile ? "Attached" : null;
  const imagesStatus =
    selectedImages.length > 0
      ? `${selectedImages.length} ${selectedImages.length === 1 ? "image" : "images"}`
      : null;
  const docsStatus =
    supportingDocs.length > 0
      ? `${supportingDocs.length} ${supportingDocs.length === 1 ? "doc" : "docs"}`
      : null;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
      >
        {/* max-w-3xl fits the full image-upload flow; mermaid mode gets a
            tighter cap so the compact single-section form doesn't stretch
            across the reduced dialog width. */}
        <div className={cn("mx-auto flex w-full flex-col gap-6", isMermaidMode ? "max-w-lg" : "max-w-3xl")}>
          {/* ------------ Card 01 · Application Context ------------ */}
          <Card id="context" className="scroll-mt-24 overflow-hidden border-border/70 shadow-xs">
            <span
              aria-hidden
              className="block h-1 w-full bg-foreground dark:bg-white"
            />
            <CardHeader className="gap-2 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground text-background ring-1 ring-border dark:bg-white dark:text-black">
                    <Building2 className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        01
                      </span>
                      <CardTitle className="text-lg font-semibold tracking-tight">
                        Application Context
                      </CardTitle>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Identify the app, version, and ownership.
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 rounded-full border-border bg-muted px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground"
                >
                  Required
                </Badge>
              </div>

            </CardHeader>
            <Separator />
            <CardContent className="space-y-7 p-6">
              {metadataLoaded && orgs.length === 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Setup required</AlertTitle>
                  <AlertDescription>
                    No organizations or applications have been onboarded yet.
                    Ask an administrator to add one first from the{" "}
                    <Link
                      href="/dashboard/admin"
                      className="font-medium underline underline-offset-2"
                    >
                      admin console
                    </Link>{" "}
                    (Org Onboarding → App Onboarding), then reload this page.
                  </AlertDescription>
                </Alert>
              )}

              {/* -- Organization -- */}
              <div className="space-y-4">
                <SectionDivider label="Organization" />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="org_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          Organization
                          <InfoTip text="Select the business unit or cross-functional organization this assessment belongs to." />
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="h-10">
                              <SelectValue placeholder="Select organization" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {orgs.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No organizations configured yet.
                              </div>
                            ) : (
                              orgs.map((org) => (
                                <SelectItem key={org.id} value={org.name}>
                                  {org.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="app_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          App Name
                          <InfoTip text="The application vertical this assessment covers. Choose the product line that best matches your feature." />
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="h-10">
                              <SelectValue placeholder="Select application" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {filteredApps.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No applications configured for this organization.
                              </div>
                            ) : (
                              filteredApps.map((app) => (
                                <SelectItem key={app.id} value={app.name}>
                                  {app.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* -- Feature -- */}
              <div className="space-y-4">
                <SectionDivider label="Feature" />

                <FormField
                  control={form.control}
                  name="assessment_name"
                  render={({ field }) => (
                    <FormItem className="relative">
                      <FormLabel className="flex items-center gap-1">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                        Assessment Name
                        <InfoTip text="If this is a feature, enter the feature name. If an assessment with this name already exists you can create a new version (major or minor bump)." />
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="e.g. User Authentication, Payment Flow"
                            className="h-10 pl-9"
                            {...field}
                            onFocus={() =>
                              assessmentSearchResults.length > 0 &&
                              setShowSearchResults(true)
                            }
                            onBlur={() =>
                              setTimeout(() => setShowSearchResults(false), 200)
                            }
                          />
                          {isSearching && (
                            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </FormControl>

                      <AnimatePresence>
                        {showSearchResults &&
                          assessmentSearchResults.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-card shadow-lg"
                            >
                              <div className="border-b border-border p-2 text-xs font-medium text-muted-foreground">
                                Existing assessments
                              </div>
                              {assessmentSearchResults.map((a) => (
                                <div
                                  key={a.assessment_id}
                                  className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-muted"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    form.setValue(
                                      "assessment_name",
                                      a.feature_name,
                                    );
                                    setShowSearchResults(false);
                                  }}
                                >
                                  <span className="text-sm text-foreground">
                                    {a.feature_name}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-[10px]"
                                  >
                                    v{a.feature_version}
                                  </Badge>
                                </div>
                              ))}
                            </motion.div>
                          )}
                      </AnimatePresence>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Existing match — version bump selector */}
                <AnimatePresence>
                  {matchedExisting && (
                    <motion.div
                      variants={expandVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20"
                    >
                      <p className="text-sm text-amber-900 dark:text-amber-200">
                        <strong>&ldquo;{matchedExisting.feature_name}&rdquo;</strong>{" "}
                        already exists at{" "}
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          v{matchedExisting.feature_version}
                        </Badge>
                        . Choose a version bump:
                      </p>
                      <FormField
                        control={form.control}
                        name="version_type"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <div className="flex gap-3">
                                {(["major", "minor"] as const).map((type) => {
                                  const isSelected = field.value === type;
                                  const label =
                                    type === "major"
                                      ? `Major \u2192 ${bumpVersion(matchedExisting.feature_version, "major")}`
                                      : `Minor \u2192 ${bumpVersion(matchedExisting.feature_version, "minor")}`;
                                  return (
                                    <div
                                      key={type}
                                      onClick={() => field.onChange(type)}
                                      className={cn(
                                        "flex-1 cursor-pointer rounded-lg border-2 p-3 text-center transition-all",
                                        isSelected
                                          ? "border-primary bg-primary/5"
                                          : "border-border hover:border-border/80",
                                      )}
                                    >
                                      <p className="text-sm font-semibold capitalize text-foreground">
                                        {type}
                                      </p>
                                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                        {label}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <FormField
                  control={form.control}
                  name="feature_version"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        Feature Version
                        <InfoTip text="Auto-calculated from existing assessment version and your chosen bump type. For new assessments, starts at 1.0.0." />
                      </FormLabel>
                      <FormControl>
                        <Input
                          className="h-10 font-mono"
                          {...field}
                          readOnly={!!matchedExisting}
                          tabIndex={matchedExisting ? -1 : 0}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* -- Auto-generated identifiers -- */}
              <div className="space-y-3">
                <SectionDivider
                  label="Auto-generated"
                  icon={Sparkles}
                  hint="computed from name & diagram type"
                />
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        Artifact name
                      </dt>
                      <dd className="mt-1.5 truncate text-sm font-medium text-foreground">
                        {artifactName || (
                          <span className="italic text-muted-foreground">
                            Pending assessment name
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Hash className="h-3 w-3" />
                        Artifact ID
                      </dt>
                      <dd className="mt-1.5 truncate font-mono text-sm text-foreground">
                        {artifactId || (
                          <span className="font-sans italic text-muted-foreground">
                            Auto-generated
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* -- Ownership -- */}
              <div className="space-y-4">
                <SectionDivider label="Ownership" icon={Users} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="team"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          Team
                          <InfoTip text="Your engineering team name, pulled from the catalog service." />
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Payments-Gateway"
                            className="h-10"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="pod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          Pod
                          <span className="text-[11px] font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Checkout"
                            className="h-10"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sub_pod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          Sub-Pod
                          <span className="text-[11px] font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Cart"
                            className="h-10"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ------------ Card 02 · Architecture Inputs ------------ */}
          <Card id="inputs" className="scroll-mt-24 overflow-hidden border-border/70 shadow-xs">
            <span
              aria-hidden
              className="block h-1 w-full bg-foreground dark:bg-white"
            />
            <CardHeader className="gap-2 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground text-background ring-1 ring-border dark:bg-white dark:text-black">
                    <Layers className="size-4.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        02
                      </span>
                      <CardTitle className="text-lg font-semibold tracking-tight">
                        Architecture Inputs
                      </CardTitle>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      PDFs, diagrams, and supporting documents.
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 rounded-full border-border bg-muted px-2 text-[10px] font-semibold uppercase tracking-wider text-foreground"
                >
                  At least one input
                </Badge>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-6 p-6">
              {/* -- Step 1 · PDF Document (image mode only; irrelevant when
                    the caller supplies mermaid text directly) -- */}
              {!isMermaidMode && (
              <div className="space-y-3">
                <UploadStepHeader
                  step="1"
                  title="PDF Document"
                  icon={FileText}
                  optional
                  status={pdfStatus}
                />

                {!pdfInputFile ? (
                  <div
                    className="group relative flex h-28 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/40 transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60"
                    onClick={() => {
                      if (!isExtractingPdf)
                        document.getElementById("pdfInputUpload")?.click();
                    }}
                  >
                    {isExtractingPdf ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">
                          Extracting images from PDF...
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-full bg-card p-2.5 shadow-sm transition-transform duration-300 group-hover:scale-110">
                          <FileText className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                        </div>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          <span className="font-semibold text-foreground hover:underline">
                            Click to upload a PDF
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Diagrams will be extracted automatically
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-500 dark:bg-red-950">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="max-w-[200px] truncate text-sm font-medium text-foreground md:max-w-sm">
                            {pdfInputFile.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(pdfInputFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPdfInputFile(null);
                          if (pdfPreviewUrl) {
                            URL.revokeObjectURL(pdfPreviewUrl);
                            setPdfPreviewUrl(null);
                          }
                          setExtractedImages([]);
                          const input = document.getElementById(
                            "pdfInputUpload",
                          ) as HTMLInputElement;
                          if (input) input.value = "";
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    {isExtractingPdf && (
                      <div className="p-4">
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-5 rounded-xl border border-primary/20 bg-linear-to-br from-primary/5 via-primary/10 to-purple-500/5 p-6"
                        >
                          <div className="flex flex-col items-center gap-3 text-center">
                            <div className="relative">
                              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                              </div>
                              <div className="absolute inset-0 h-14 w-14 animate-ping rounded-full border-2 border-primary/20" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                Extracting diagrams from PDF
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Scanning pages and identifying architecture
                                diagrams...
                              </p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {[1, 2, 3].map((i) => (
                              <div key={i} className="space-y-2">
                                <Skeleton className="h-28 w-full rounded-lg" />
                                <Skeleton className="mx-auto h-3 w-3/4 rounded" />
                              </div>
                            ))}
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <motion.div
                              className="h-full rounded-full bg-primary"
                              initial={{ width: "5%" }}
                              animate={{ width: "85%" }}
                              transition={{ duration: 8, ease: "easeOut" }}
                            />
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </motion.div>
                )}

                <input
                  id="pdfInputUpload"
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setPdfInputFile(file);
                      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
                      setPdfPreviewUrl(URL.createObjectURL(file));
                      handleExtractPdfImages(file);
                    }
                    e.target.value = "";
                  }}
                />

                {/* Extracted Images Preview Grid */}
                <AnimatePresence>
                  {extractedImages.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {extractedImages.filter((i) => i.selected).length} /{" "}
                          {extractedImages.length} image(s) extracted
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setExtractedImages((prev) =>
                              prev.map((img) => ({
                                ...img,
                                selected: !prev.every((i) => i.selected),
                              })),
                            )
                          }
                        >
                          {extractedImages.every((i) => i.selected)
                            ? "Deselect All"
                            : "Select All"}
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                        {extractedImages.map((img, idx) => (
                          <motion.div
                            key={`ext-${img.page}-${img.index}`}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: idx * 0.05 }}
                            onClick={() =>
                              setExtractedImages((prev) =>
                                prev.map((im, i) =>
                                  i === idx
                                    ? { ...im, selected: !im.selected }
                                    : im,
                                ),
                              )
                            }
                            className={cn(
                              "group relative cursor-pointer overflow-hidden rounded-xl border-2 bg-card transition-all duration-200 hover:-translate-y-1 hover:shadow-lg",
                              img.selected
                                ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-lg shadow-primary/10 dark:border-primary/70 dark:bg-primary/10 dark:ring-primary/35 dark:shadow-primary/20"
                                : "border-border hover:border-primary/40 dark:hover:border-primary/50",
                            )}
                          >
                            <div
                              className={cn(
                                "absolute inset-0 z-10 bg-linear-to-t from-slate-950/55 via-transparent to-transparent transition-opacity duration-200",
                                img.selected
                                  ? "opacity-100"
                                  : "opacity-0 group-hover:opacity-100",
                              )}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className={cn(
                                "absolute left-2 top-2 z-20 h-7 w-7 rounded-full border border-white/20 bg-slate-950/70 text-slate-100 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-slate-900",
                                img.selected
                                  ? "opacity-100"
                                  : "opacity-0 group-hover:opacity-100",
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                openExtractedImagePreview(img);
                              }}
                            >
                              <ZoomIn className="h-3.5 w-3.5" />
                            </Button>
                            <img
                              src={img.data_url}
                              alt={`Page ${img.page} image ${img.index}`}
                              className="h-32 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            <div className="absolute right-2 top-2">
                              <div
                                className={cn(
                                  "flex h-5 w-5 items-center justify-center rounded-full border shadow-sm transition-colors",
                                  img.selected
                                    ? "border-primary/30 bg-primary text-primary-foreground"
                                    : "border-border bg-card/85 dark:bg-slate-950/85",
                                )}
                              >
                                {img.selected && <Check className="h-3 w-3" />}
                              </div>
                            </div>
                            <div className="absolute inset-x-0 bottom-0 z-20 p-2">
                              <div
                                className={cn(
                                  "rounded-lg border px-2 py-1.5 text-center backdrop-blur-sm transition-colors",
                                  img.selected
                                    ? "border-primary/30 bg-slate-950/85"
                                    : "border-white/10 bg-slate-950/75",
                                )}
                              >
                                <p className="text-[10px] text-slate-200">
                                  p.{img.page} &middot; {img.width}&times;
                                  {img.height}
                                </p>
                                <p
                                  className={cn(
                                    "mt-0.5 text-[9px] uppercase tracking-wide",
                                    img.selected
                                      ? "text-primary/90"
                                      : "text-slate-400",
                                  )}
                                >
                                  {img.selected ? "Selected" : "Hover to preview"}
                                </p>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                      <Dialog
                        open={Boolean(previewImage)}
                        onOpenChange={(open) => {
                          if (!open) {
                            setPreviewImage(null);
                            setPreviewZoom(1);
                          }
                        }}
                      >
                        <DialogContent className="max-w-5xl overflow-hidden border-border bg-background p-0">
                          <DialogHeader className="border-b border-border px-6 py-4">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <DialogTitle>Extracted PDF Diagram</DialogTitle>
                                <DialogDescription>
                                  {previewImage
                                    ? `Page ${previewImage.page} image ${previewImage.index} • ${previewImage.width}×${previewImage.height}`
                                    : "Preview extracted diagram"}
                                </DialogDescription>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => updatePreviewZoom(-0.25)}
                                >
                                  <ZoomOut className="h-4 w-4" />
                                </Button>
                                <div className="min-w-14 text-center text-xs font-medium text-muted-foreground">
                                  {Math.round(previewZoom * 100)}%
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => updatePreviewZoom(0.25)}
                                >
                                  <ZoomIn className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </DialogHeader>
                          <div className="max-h-[75vh] overflow-auto bg-muted/30 p-6">
                            {previewImage && (
                              <div className="flex min-h-[55vh] items-center justify-center rounded-xl border border-border bg-card p-4 shadow-sm">
                                <img
                                  src={previewImage.data_url}
                                  alt={`Page ${previewImage.page} image ${previewImage.index}`}
                                  className="max-w-full rounded-lg shadow-sm transition-transform duration-200"
                                  style={{
                                    transform: `scale(${previewZoom})`,
                                    transformOrigin: "center center",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                      <Button
                        type="button"
                        onClick={addExtractedImagesToForm}
                        className="w-full"
                        disabled={
                          extractedImages.filter((i) => i.selected).length === 0
                        }
                      >
                        <Check className="mr-2 h-4 w-4" />
                        Add {extractedImages.filter((i) => i.selected).length}{" "}
                        selected image(s)
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              )}

              {!isMermaidMode && <Separator />}

              {/* -- Step 2 · Diagram Images (image mode only) -- */}
              {!isMermaidMode && (
              <FormField
                control={form.control}
                name="images"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <UploadStepHeader
                      step="2"
                      title="Diagram Images"
                      icon={ImageIcon}
                      required
                      status={imagesStatus}
                    />
                    <FormControl>
                      <div className="w-full space-y-3">
                        <div
                          className="group relative flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/40 transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60"
                          onClick={() =>
                            document.getElementById("imagesInput")?.click()
                          }
                        >
                          <div className="rounded-full bg-card p-3 shadow-sm transition-transform duration-300 group-hover:scale-110">
                            <ImageIcon className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-foreground" />
                          </div>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            <span className="font-semibold text-foreground hover:underline">
                              Click to upload images
                            </span>{" "}
                            or drag and drop
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            PNG, JPG, JPEG — multiple files allowed
                          </p>
                        </div>

                        {selectedImages.length > 0 && (
                          <div className="space-y-3">
                            {selectedImages.some(
                              (_, idx) => !diagramTypes[idx],
                            ) && (
                              <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                                <HelpCircle className="h-3 w-3" />
                                Select a diagram type for each image
                              </div>
                            )}
                            {selectedImages.map((file, idx) => {
                              const selectedDiagram = DIAGRAM_OPTIONS.find(
                                (o) => o.value === diagramTypes[idx],
                              );
                              return (
                                <motion.div
                                  key={`${file.name}-${idx}`}
                                  initial={{ opacity: 0, y: 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: idx * 0.05 }}
                                  className="group/card overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md"
                                >
                                  <div className="flex gap-4 p-4">
                                    <ImageThumbnail file={file} />

                                    <div className="flex min-w-0 flex-1 flex-col justify-between">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-medium text-foreground">
                                            {file.name}
                                          </p>
                                          <p className="mt-0.5 text-xs text-muted-foreground">
                                            {(file.size / 1024 / 1024).toFixed(2)}{" "}
                                            MB
                                          </p>
                                        </div>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover/card:opacity-100 dark:hover:bg-red-950"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const dt = new DataTransfer();
                                            selectedImages.forEach((f, i) => {
                                              if (i !== idx) dt.items.add(f);
                                            });
                                            field.onChange(
                                              dt.files.length > 0 ? dt.files : null,
                                            );
                                            setDiagramTypes((prev) =>
                                              prev.filter((_, i) => i !== idx),
                                            );
                                          }}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDiagramDialogIdx(idx);
                                          setDiagramDialogOpen(true);
                                        }}
                                        className={cn(
                                          "mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200",
                                          selectedDiagram
                                            ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                                            : "animate-pulse border-dashed border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-950/50",
                                        )}
                                      >
                                        {selectedDiagram ? (
                                          <>
                                            <CheckCircle2 className="h-3 w-3" />
                                            <span>{selectedDiagram.icon}</span>
                                            {selectedDiagram.label}
                                          </>
                                        ) : (
                                          <>
                                            <Layers className="h-3 w-3" />
                                            Choose diagram type
                                          </>
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        )}

                        {/* Diagram Type Selection Dialog */}
                        <Dialog
                          open={diagramDialogOpen}
                          onOpenChange={setDiagramDialogOpen}
                        >
                          <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <Layers className="h-5 w-5 text-primary" />
                                Select diagram type
                                {selectedImages.length > 1 && (
                                  <Badge
                                    variant="secondary"
                                    className="ml-auto font-mono text-[10px]"
                                  >
                                    {diagramDialogIdx + 1} /{" "}
                                    {selectedImages.length}
                                  </Badge>
                                )}
                              </DialogTitle>
                              <DialogDescription>
                                Choose the type of architecture diagram for{" "}
                                <span className="font-medium text-foreground">
                                  {selectedImages[diagramDialogIdx]?.name ||
                                    "this image"}
                                </span>
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-3 py-4">
                              {DIAGRAM_OPTIONS.map((opt) => {
                                const isActive =
                                  diagramTypes[diagramDialogIdx] === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => {
                                      setDiagramTypes((prev) => {
                                        const next = [...prev];
                                        while (next.length <= diagramDialogIdx)
                                          next.push("");
                                        next[diagramDialogIdx] = opt.value;

                                        const nextUntyped = next.findIndex(
                                          (dt, i) =>
                                            i > diagramDialogIdx &&
                                            !dt &&
                                            i < selectedImages.length,
                                        );
                                        if (nextUntyped !== -1) {
                                          setTimeout(() => {
                                            setDiagramDialogIdx(nextUntyped);
                                          }, 150);
                                        } else {
                                          setDiagramDialogOpen(false);
                                        }

                                        return next;
                                      });
                                    }}
                                    className={cn(
                                      "flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all duration-200 hover:bg-muted",
                                      isActive
                                        ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                                        : "border-border bg-card hover:border-primary/30",
                                    )}
                                  >
                                    <span className="mt-0.5 text-2xl">
                                      {opt.icon}
                                    </span>
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-semibold text-foreground">
                                          {opt.label}
                                        </h4>
                                        {isActive && (
                                          <CheckCircle2 className="h-4 w-4 text-primary" />
                                        )}
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {opt.description}
                                      </p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </DialogContent>
                        </Dialog>

                        <input
                          id="imagesInput"
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              const firstNewIdx = selectedImages.length;
                              const dt = new DataTransfer();
                              selectedImages.forEach((f) => dt.items.add(f));
                              Array.from(e.target.files).forEach((f) =>
                                dt.items.add(f),
                              );
                              field.onChange(dt.files);
                              setDiagramTypes((prev) => [
                                ...prev,
                                ...Array(e.target.files!.length).fill(""),
                              ]);
                              setTimeout(() => {
                                setDiagramDialogIdx(firstNewIdx);
                                setDiagramDialogOpen(true);
                              }, 100);
                            }
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="mt-2" />
                  </FormItem>
                )}
              />
              )}

              {!isMermaidMode && <Separator />}

              {/* -- Step 3 · Supporting Documents --
                  In mermaid mode this is the only visible section, so we
                  drop the "3" step badge and the preceding Separator —
                  the header reads as a plain section title, not "Step 3
                  of N" dangling below a stray horizontal rule. */}
              <div className="space-y-3">
                <UploadStepHeader
                  step={isMermaidMode ? undefined : "3"}
                  title="Supporting Documents"
                  icon={FileText}
                  optional
                  status={docsStatus}
                />

                <div
                  className="group relative flex h-28 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/40 transition-all duration-300 hover:border-foreground/40 hover:bg-muted/60"
                  onClick={() =>
                    document.getElementById("supportingDocsInput")?.click()
                  }
                >
                  <div className="rounded-full bg-card p-2.5 shadow-sm transition-transform duration-300 group-hover:scale-110">
                    <FileText className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </div>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    <span className="font-semibold text-foreground hover:underline">
                      Click to upload PDFs
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Multiple PDF files allowed
                  </p>
                </div>

                <input
                  id="supportingDocsInput"
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setSupportingDocs((prev) => [
                        ...prev,
                        ...Array.from(e.target.files!),
                      ]);
                    }
                    e.target.value = "";
                  }}
                />

                {supportingDocs.length > 0 && (
                  <div className="space-y-2">
                    {supportingDocs.map((file, idx) => (
                      <motion.div
                        key={`doc-${file.name}-${idx}`}
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-500 dark:bg-red-950">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="max-w-[200px] truncate text-sm font-medium text-foreground md:max-w-sm">
                              {file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950"
                          onClick={() =>
                            setSupportingDocs((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ------------ Slim Submit Bar ------------ */}
          <div
            id="submit"
            className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Summary
              </span>
              {isMermaidMode ? (
                <Badge
                  variant="secondary"
                  className="gap-1 font-mono text-[10px]"
                >
                  <Sparkles className="h-3 w-3" />
                  {mermaidTexts!.length}{" "}
                  {mermaidTexts!.length === 1 ? "initial diagram" : "initial diagrams"}
                </Badge>
              ) : (
                <>
                  <Badge
                    variant={selectedImages.length > 0 ? "secondary" : "outline"}
                    className="gap-1 font-mono text-[10px]"
                  >
                    <ImageIcon className="h-3 w-3" />
                    {selectedImages.length}{" "}
                    {selectedImages.length === 1 ? "image" : "images"}
                  </Badge>
                  <Badge
                    variant={pdfInputFile ? "secondary" : "outline"}
                    className="gap-1 font-mono text-[10px]"
                  >
                    <FileText className="h-3 w-3" />
                    {pdfInputFile ? "1 PDF" : "no PDF"}
                  </Badge>
                </>
              )}
              <Badge
                variant={supportingDocs.length > 0 ? "secondary" : "outline"}
                className="gap-1 font-mono text-[10px]"
              >
                <FileText className="h-3 w-3" />
                {supportingDocs.length}{" "}
                {supportingDocs.length === 1 ? "doc" : "docs"}
              </Badge>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={isLoading}
              className="w-full shrink-0 bg-black text-white shadow-sm transition-all hover:bg-black/90 hover:shadow-md sm:w-auto dark:bg-white dark:text-black dark:hover:bg-white/90 disabled:opacity-70"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Initiate Assessment
                </>
              )}
            </Button>
          </div>
        </div>

      </form>
    </Form>
  );
}
