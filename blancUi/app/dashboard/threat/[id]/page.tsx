"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { isValidId, sanitizeFilename, isValidApiImageUrl } from "@/lib/sanitize";
import { renderMermaidSvg } from "@/lib/mermaid";

// UI Components
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// Icons
import {
  RefreshCw,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Download,
  Activity,
  FileText,
  ChevronDown,
  ChevronUp,
  UserX,        
  FileWarning,  
  Delete,       
  Eye,          
  ServerCrash,  
  UnlockKeyhole, 
  Target,
  ImageIcon,
  HelpCircle,
  CheckCircle2,
  Save,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Users,
  Search,
  UserPlus,
  X,
  Clock,
  Mail,
  UserCheck,
  XCircle,
  Send,
  ZoomIn,
  ZoomOut,
  Move,
  Maximize2,
  RotateCcw,
  Loader2,
  ArrowLeft,
  Check,
  Coins,
  Timer,
  DollarSign,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------- Types ----------
// Updated to handle dynamic schemas from any framework
type ThreatRow = Record<string, any>;

type CriticalRisk = {
  title?: string;
  description?: string;
  component?: string;
  severity?: string;
};

type ComponentDetail = {
  component: string;
  purpose: string;
  data: string[];
  trust_level: string;
  component_type?: string;
  auth_mechanism?: string;
  protocol?: string;
  dependencies?: string[];
  dependents?: string[];
};

type ClarificationQuestion = {
  question: string;
  answer: string;
  image_id?: string;
  image_index?: number;
};

// Per-image threat data from /results/by-image endpoint
type ByImageEntry = {
  image_id: string;
  image_path?: string;
  state?: string;
  stage?: string;
  flow_diagram?: { mermaid?: string };
  analysis_summary?: { summary?: string };
  component_details?: { components?: ComponentDetail[] };
  clarification?: ClarificationQuestion[];
  threats: ThreatRow[];
  meta?: {
    original_filename?: string;
    stored_path?: string;
    public_url?: string;
    document_id?: string;
  };
  public_url?: string;
};

type SourceDocument = {
  document_id: string;
  document_type: string; // "IMAGE" | "PDF"
  original_filename?: string | null;
  stored_path?: string | null;
  public_url?: string | null;
  storage_backend?: string | null;
};

type ByImageResponse = {
  images: ByImageEntry[];
  unmapped_threats: ThreatRow[];
  documents?: SourceDocument[];
};

type UsageCall = {
  id: number;
  call_type: string;
  model: string;
  tokens_billed: number;
  estimated_cost: number;
  duration_ms: number | null;
  created_at: string | null;
};

type UsageData = {
  assessment_id: string;
  total_calls: number;
  total_tokens_billed: number;
  total_estimated_cost: number;
  total_duration_ms: number;
  calls: UsageCall[];
};

type ReviewerUser = {
  userId: string;
  name: string;
  email: string;
};

type AssignedReviewer = {
  reviewer_id: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
  status: string;
  comment: string | null;
  reviewed_at: string | null;
};

import { api, API_BASE } from "@/lib/api-client";

const getErrorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Unknown error";

// ---------- Stage Progress Config ----------
const STAGE_CONFIG: Record<string, { label: string; description: string; progress: number }> = {
  INITIALIZING: { label: "Initializing Pipeline", description: "Setting up the analysis environment...", progress: 5 },
  IMAGE_PROCESSING: { label: "Processing Diagrams", description: "Converting architecture diagrams to structured format...", progress: 20 },
  SUMMARIZING: { label: "Generating Summary", description: "Creating a high-level summary of the architecture...", progress: 35 },
  COMPONENT_ANALYSIS: { label: "Analyzing Components", description: "Breaking down individual system components...", progress: 50 },
  COMPONENT_DOCS: { label: "Fetching Documentation", description: "Gathering documentation for identified components...", progress: 65 },
  CLARIFICATION: { label: "Generating Questions", description: "Identifying areas that need clarification...", progress: 80 },
  THREAT_MODELING: { label: "Running Threat Analysis", description: "Executing threat analysis on the architecture model...", progress: 95 },
};

// --- StatusBadge (matching assessment page) ---
const StatusBadge = ({ variant = "neutral", children }: { variant?: string; children: React.ReactNode }) => {
  const styles: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground border-border",
    success: "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    warning: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    danger: "bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800",
    processing: "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 animate-pulse",
  }
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${styles[variant] || styles.neutral}`}>
      {children}
    </span>
  )
}

// --- Processing Messages (matching assessment page) ---
const PROCESSING_MESSAGES = [
  "Analyzing threat landscape...",
  "Mapping attack surfaces...",
  "Evaluating security controls...",
  "Identifying vulnerability patterns...",
  "Generating threat intelligence...",
]

// ---------- Dynamic Field Extractors ----------
const extractCoreFields = (t: ThreatRow) => {
  // Gracefully handle nulls and fallback to "Identified Risks"
  const category = t.ThreatCategory || t.LogicFlawCategory || t.PastaStage || t.category || "Identified Risks";
  const title = t.Threat || t.title || "Unknown Threat";
  const description = t.Description || t.description || "";
  const impact = t.Impact || t.severity || "Low";
  const mitigation = t.Mitigation || t.mitigations || "No mitigation provided";
  const imageId = t.image_id || null;

  // Determine what the target "thing" is based on framework keys
  let targetLabel = "Context";
  let targetValue = "System Architecture";

  if (t.Component) { targetLabel = "Component"; targetValue = t.Component; }
  else if (t.AbusedFeature) { targetLabel = "Feature"; targetValue = t.AbusedFeature; }
  else if (t.DataAsset) { targetLabel = "Data Asset"; targetValue = t.DataAsset; }
  else if (t.CriticalAsset) { targetLabel = "Critical Asset"; targetValue = t.CriticalAsset; }
  else if (t.InfrastructureComponent) { targetLabel = "Infrastructure"; targetValue = t.InfrastructureComponent; }

  return { category, title, description, impact, mitigation, targetLabel, targetValue, imageId };
};

// ---------- UI Metadata Providers ----------
const KNOWN_META: Record<string, { icon: LucideIcon; color: string; desc: string }> = {
  Spoofing: { icon: UserX, color: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800", desc: "Identity and authentication bypassing." },
  Tampering: { icon: FileWarning, color: "text-orange-600 bg-orange-50 border-orange-200", desc: "Unauthorized modification of data or code." },
  Repudiation: { icon: Delete, color: "text-muted-foreground bg-muted border-border", desc: "Lack of auditing and traceability." },
  "Information Disclosure": { icon: Eye, color: "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 border-indigo-200 dark:border-indigo-800", desc: "Unauthorized data exposure." },
  "Denial of Service": { icon: ServerCrash, color: "text-red-600 bg-red-50 border-red-200", desc: "Resource exhaustion and availability impacts." },
  "Elevation of Privilege": { icon: UnlockKeyhole, color: "text-purple-600 bg-purple-50 border-purple-200", desc: "Unauthorized access and role escalation." },
  "Identified Risks": { icon: FileText, color: "text-foreground bg-muted border-border", desc: "General architectural and operational risks." },
};

const getCategoryMeta = (categoryName: string) => {
  // Find an exact match or partial match in our known UI styles
  const knownKey = Object.keys(KNOWN_META).find(k => categoryName.toLowerCase().includes(k.toLowerCase()));
  
  if (knownKey) {
    return { label: categoryName, ...KNOWN_META[knownKey] };
  }
  
  // Generic fallback for custom/new frameworks
  return {
    label: categoryName,
    icon: Target,
    color: "text-foreground bg-muted border-border",
    desc: `Identified architectural risks mapped to ${categoryName}.`
  };
};

const MermaidDiagram = ({ diagram }: { diagram: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [zoom, setZoom] = useState(4);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  const zoomIn = () => setZoom(prev => Math.min(prev + 0.25, 5));
  const zoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.25));
  const zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { x: pan.x, y: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.min(Math.max(prev + delta, 0.25), 5));
  }, []);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient || !diagram) return;

    let isMounted = true;
    const renderDiagram = async () => {
      try {
        const renderedSvg = await renderMermaidSvg(diagram, {
          theme: "neutral",
          fontFamily: "sans-serif",
        });
        if (isMounted) {
          setSvg(renderedSvg);
          setError(false);
        }
      } catch (err) {
        console.error("Mermaid rendering failed:", err);
        if (isMounted) setError(true);
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [diagram, isClient]);

  if (!isClient)
    return (
      <div className="min-h-[200px] flex items-center justify-center bg-muted rounded-lg">
        Loading diagram...
      </div>
    );
  if (error)
    return (
      <div className="p-4 bg-rose-50 dark:bg-rose-950 border border-rose-100 rounded-lg text-rose-700 dark:text-rose-300 text-xs font-mono">
        Error rendering diagram.
      </div>
    );

  return (
    <div className="flex flex-col rounded-xl border border-border overflow-hidden bg-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted border-b border-border">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Move className="w-3.5 h-3.5" />
          <span>Drag to pan</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={zoomReset}
            className="px-2 py-1 rounded-md hover:bg-muted text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors min-w-[44px] text-center"
            title="Reset view"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomIn}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-muted mx-1" />
          <button
            onClick={zoomReset}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Fit to view"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
      {/* Diagram canvas */}
      <div
        className="overflow-hidden bg-card"
        style={{ minHeight: "500px", cursor: isDragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div className="w-full flex items-center justify-center" style={{ minHeight: "500px" }}>
          <div
            ref={ref}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isDragging ? "none" : "transform 0.2s ease",
              userSelect: "none",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  );
};

const SeverityBadge = ({ value }: { value?: string }) => {
  const v = (value || "").toLowerCase();
  
  let styles = "bg-muted text-foreground border-border";
  let Icon = Activity;

  if (v.includes("critical")) {
    styles = "bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800";
    Icon = ShieldAlert;
  } else if (v.includes("high")) {
    styles = "bg-orange-50 text-orange-700 border-orange-200";
    Icon = AlertTriangle;
  } else if (v.includes("medium")) {
    styles = "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800";
    Icon = Activity;
  } else if (v.includes("low")) {
    styles = "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
    Icon = ShieldCheck;
  }

  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium px-2.5 py-0.5 whitespace-nowrap", styles)}>
      <Icon className="w-3.5 h-3.5" />
      <span className="capitalize">{value || "Unknown"}</span>
    </Badge>
  );
};

const ExpandableText = ({ text }: { text: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (!text) return <span className="text-muted-foreground italic text-xs">N/A</span>;
  
  const cleanText = text.replace(/\*\*/g, ""); 
  const isLong = cleanText.length > 150;

  return (
    <div className="w-full min-w-0">
      <p className={cn(
        "text-sm text-muted-foreground leading-relaxed transition-all break-words whitespace-normal", 
        !isExpanded && "line-clamp-3"
      )}>
        {cleanText}
      </p>
      {isLong && (
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 flex items-center gap-1 mt-1.5"
        >
          {isExpanded ? (
            <>Show Less <ChevronUp className="w-3 h-3" /></>
          ) : (
            <>Read More <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      )}
    </div>
  );
};

// ---------- Main Page ----------
export default function ThreatReportModern() {
  const params = useParams();
  const router = useRouter();
  const rawId = params?.id as string;
  const id = isValidId(rawId) ? rawId : "";

  // State
  const [threatModel, setThreatModel] = useState<ThreatRow[]>([]);
  const [criticalRisks, setCriticalRisks] = useState<CriticalRisk[]>([]);
  const [frameworkName, setFrameworkName] = useState<string>("Threat Model");
  const [featureName, setFeatureName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<{ state: string; stage: string } | null>(null);
  const [imageLocations, setImageLocations] = useState<any[]>([]);
  const [clarificationQuestions, setClarificationQuestions] = useState<ClarificationQuestion[]>([]);
  const [mermaidDiagram, setMermaidDiagram] = useState<string>("");
  const [perImageDiagrams, setPerImageDiagrams] = useState<Record<string, string>>({});
  const [perImageSummaries, setPerImageSummaries] = useState<Record<string, string>>({});
  const [perImageComponents, setPerImageComponents] = useState<Record<string, ComponentDetail[]>>({});
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocument[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<"diagram" | "threats" | "qa">("threats");
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [editingAnswers, setEditingAnswers] = useState<Record<number, string>>({});
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [threatApprovals, setThreatApprovals] = useState<Record<string, "approved" | "rejected">>({});
  const [reviewerComments, setReviewerComments] = useState<Record<string, string>>({});
  const [editingComment, setEditingComment] = useState<Record<string, boolean>>({});
  const [savingThreatReview, setSavingThreatReview] = useState<Record<string, boolean>>({});
  const [bulkReviewing, setBulkReviewing] = useState(false);
  const [severitySortOrder, setSeveritySortOrder] = useState<"asc" | "desc" | null>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  // By-image threat data
  const [byImageData, setByImageData] = useState<ByImageResponse | null>(null);
  const [imageNavSelection, setImageNavSelection] = useState<number>(0);

  // Reviewer state
  const [reviewerSheetOpen, setReviewerSheetOpen] = useState(false);
  const [reviewerSearchQuery, setReviewerSearchQuery] = useState("");
  const [reviewerSearchResults, setReviewerSearchResults] = useState<ReviewerUser[]>([]);
  const [selectedReviewers, setSelectedReviewers] = useState<ReviewerUser[]>([]);
  const [assignedReviewers, setAssignedReviewers] = useState<AssignedReviewer[]>([]);
  const [searchingReviewers, setSearchingReviewers] = useState(false);
  const [assigningReviewers, setAssigningReviewers] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [assessmentState, setAssessmentState] = useState<string>("");
  const [approvingAssessment, setApprovingAssessment] = useState(false);
  const [approveComment, setApproveComment] = useState("");
  const [showApprovePanel, setShowApprovePanel] = useState(false);
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const justTriggeredRef = useRef(false);

  // -- Data Fetching --
  const fetchAssessmentStatus = async () => {
    try {
      if (!id) return null;
      const json = await api.get(`/threat_modeling/${id}/status`);
      const statusData = json?.data;
      setApiStatus(statusData);
      if (statusData?.state) setAssessmentState(statusData.state);
      return statusData;
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      return null;
    }
  };

  // Authentication is handled by AuthProvider in dashboard layout
  useEffect(() => {
    setIsAuthenticated(true);
  }, []);

  const triggerThreatModeling = async () => {
    try {
      if (!id) return;
      await api.post(`/threat_modeling/${id}/start`, {}, { retryOnPost: true });
      justTriggeredRef.current = true;
      startStatusPolling();
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (msg.includes("already in progress")) {
        startStatusPolling();
      } else {
        toast.error(msg);
        setError(msg);
      }
      setLoading(false);
    }
  };

  const startStatusPolling = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = setInterval(async () => {
      const status = await fetchAssessmentStatus();
      if (!status) return;

      const stopPolling = () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };

      if (["REVIEW", "APPROVED", "CHANGES_REQUESTED"].includes(status.state)) {
        stopPolling();
        justTriggeredRef.current = false;
        fetchByImageThreats();
        fetchAssignedReviewers();
      } else if (status.state === "FAILED") {
        stopPolling();
        justTriggeredRef.current = false;
        setLoading(false);
        setError("Pipeline failed. Click 'Re-Analyze' to retry.");
      } else if (status.state === "NEEDS_INPUT") {
        stopPolling();
        justTriggeredRef.current = false;
        fetchByImageThreats();
        setActiveTab("qa");
      } else if (status.state === "COMPLETED" && status.stage === "THREAT_MODELING") {
        stopPolling();
        justTriggeredRef.current = false;
        fetchByImageThreats();
      } else if (status.state === "COMPLETED" && status.stage !== "THREAT_MODELING") {
        // After triggering, the backend might still briefly report the old COMPLETED state;
        // keep polling a few cycles to let it transition to PROCESSING.
        if (justTriggeredRef.current) {
          // Stay polling — don't stop yet
        } else {
          stopPolling();
          setLoading(false);
        }
      } else if (["PROCESSING", "PENDING"].includes(status.state)) {
        // Backend has transitioned — clear the trigger flag
        justTriggeredRef.current = false;
      }
    }, 3000);
  };

  const fetchByImageThreats = async () => {
    try {
      if (!id) return;
      setLoading(true);
      setError(null);
      const json = await api.get(`/threat_modeling/${id}/results/by-image`);
      const data = json?.data;
      if (!data) return;

      // Update dynamic framework name
      if (data.framework) {
        setFrameworkName(data.framework);
      }
      if (data.feature_name) {
        setFeatureName(data.feature_name);
      }

      // Store structured by-image data
      const images: ByImageEntry[] = data.images || [];
      const unmapped: ThreatRow[] = data.unmapped_threats || [];
      const documents: SourceDocument[] = data.documents || [];
      setByImageData({ images, unmapped_threats: unmapped, documents });
      setSourceDocuments(documents);

      // Flatten all threats into the threatModel for stats, download, review, etc.
      const allThreats: ThreatRow[] = [
        ...images.flatMap(img => img.threats),
        ...unmapped,
      ];
      setThreatModel(allThreats);
      setCriticalRisks(data.critical_risks || data.CriticalRisks || []);

      // Image locations from by-image entries
      const imgLocations = images.map(img => ({
        image_id: img.image_id,
        image_path: img.image_path,
        document_type: img.image_path ? `image/${img.image_path.split('.').pop()}` : undefined,
        public_url: img.public_url,
        meta: img.meta || { stored_path: img.image_path, public_url: img.public_url },
      }));
      setImageLocations(data.image_locations || imgLocations);

      // Clarification questions — aggregate from per-image data
      const allClarification: ClarificationQuestion[] = images.flatMap((img, imgIdx) =>
        (img.clarification || []).map(q => ({
          ...q,
          image_id: img.image_id,
          image_index: imgIdx,
        }))
      );
      // Also include any top-level clarification (legacy format)
      if (data.clarification && Array.isArray(data.clarification)) {
        allClarification.push(...data.clarification);
      }
      setClarificationQuestions(allClarification);

      // Global mermaid diagram
      setMermaidDiagram(data.flow_diagram?.mermaid || data.analysis_data?.flow_diagram?.mermaid || "");

      // Per-image diagrams, summaries, and component details
      const diagrams: Record<string, string> = {};
      const summaries: Record<string, string> = {};
      const components: Record<string, ComponentDetail[]> = {};
      images.forEach(img => {
        if (img.image_id && img.flow_diagram?.mermaid) {
          diagrams[img.image_id] = img.flow_diagram.mermaid;
        }
        if (img.image_id && img.analysis_summary?.summary) {
          summaries[img.image_id] = img.analysis_summary.summary;
        }
        if (img.image_id && img.component_details?.components) {
          components[img.image_id] = img.component_details.components;
        }
      });
      setPerImageDiagrams(diagrams);
      setPerImageSummaries(summaries);
      setPerImageComponents(components);

      // Initialize threat review statuses
      const initialApprovals: Record<string, "approved" | "rejected"> = {};
      const initialComments: Record<string, string> = {};
      images.forEach((img, imgIdx) => {
        img.threats.forEach((t: ThreatRow, idx: number) => {
          const cat = extractCoreFields(t).category;
          const key = `${imgIdx}-${cat}-${idx}`;
          if (t.review_status === "APPROVED") initialApprovals[key] = "approved";
          else if (t.review_status === "REJECTED") initialApprovals[key] = "rejected";
          if (t.review_comment) initialComments[key] = t.review_comment;
        });
      });
      if (Object.keys(initialApprovals).length > 0) setThreatApprovals(initialApprovals);
      if (Object.keys(initialComments).length > 0) setReviewerComments(initialComments);

      setApiStatus({ state: "COMPLETED", stage: "THREAT_MODELING" });

      // Fetch usage data after results load
      fetchUsageData();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchUsageData = async () => {
    try {
      if (!id) return;
      const json = await api.get(`/threat_modeling/${id}/usage`);
      if (json?.data) {
        setUsageData(json.data);
      }
    } catch (err) {
      console.error("Failed to fetch usage data:", err);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      const status = await fetchAssessmentStatus();

      if (!status) {
        setLoading(false);
        return;
      }

      switch (status.state) {
        case "REVIEW":
        case "APPROVED":
        case "CHANGES_REQUESTED":
          await fetchByImageThreats();
          await fetchAssignedReviewers();
          break;
        case "COMPLETED":
          if (status.stage === "THREAT_MODELING") {
            await fetchByImageThreats();
          } else {
            await triggerThreatModeling();
          }
          break;
        case "NEEDS_INPUT":
          await fetchByImageThreats();
          setActiveTab("qa");
          break;
        case "PROCESSING":
        case "PENDING":
          startStatusPolling();
          break;
        case "FAILED":
          setLoading(false);
          setError("Pipeline failed. Click 'Re-Analyze' to retry.");
          break;
        default:
          await triggerThreatModeling();
          break;
      }
    };

    initialize();
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, [id]);

  // -- Severity sort helper --
  const getSeverityPriority = (impact: string): number => {
    const v = (impact || "").toLowerCase();
    if (v.includes("critical")) return 4;
    if (v.includes("high")) return 3;
    if (v.includes("medium")) return 2;
    if (v.includes("low")) return 1;
    return 0;
  };

  const toggleSeveritySort = () => {
    setSeveritySortOrder(prev => {
      if (prev === null) return "desc";
      if (prev === "desc") return "asc";
      return null;
    });
  };

  // Unique source images from threats
  const sourceImages = useMemo(() => {
    if (byImageData && byImageData.images.length > 0) {
      return byImageData.images.map(img => img.image_id);
    }
    const ids = new Set<string>();
    threatModel.forEach(t => {
      if (t.image_id) ids.add(t.image_id);
    });
    return Array.from(ids);
  }, [threatModel, byImageData]);

  const hasMultipleImages = sourceImages.length > 1 || (byImageData?.unmapped_threats?.length ?? 0) > 0;
  const activeImageId = hasMultipleImages ? sourceImages[activeImageIdx] || null : null;

  // Determine the list of threats visible based on selected image
  const visibleThreats = useMemo((): ThreatRow[] => {
    if (byImageData && byImageData.images.length > 0) {
      const selectedImg = byImageData.images[imageNavSelection];
      if (!selectedImg) return threatModel;
      // Show per-image threats + unmapped threats (shared across all images)
      return [
        ...selectedImg.threats,
        ...(byImageData.unmapped_threats || []),
      ];
    }
    return threatModel;
  }, [byImageData, imageNavSelection, threatModel]);

  // Per-image threat groups — grouped by category within the active selection
  const groupedThreats = useMemo(() => {
    const groups: Record<string, ThreatRow[]> = {};

    visibleThreats.forEach(t => {
      const { category } = extractCoreFields(t);
      if (!groups[category]) groups[category] = [];
      groups[category].push(t);
    });

    // Sort threats within each group by severity if sort is active
    if (severitySortOrder) {
      Object.keys(groups).forEach(key => {
        groups[key] = [...groups[key]].sort((a, b) => {
          const pa = getSeverityPriority(extractCoreFields(a).impact);
          const pb = getSeverityPriority(extractCoreFields(b).impact);
          return severitySortOrder === "desc" ? pb - pa : pa - pb;
        });
      });
    }

    return groups;
  }, [visibleThreats, severitySortOrder]);

  // Per-image threat counts for nav bar badges
  const perImageStats = useMemo(() => {
    const stats: Record<string, { total: number; critical: number; high: number }> = {};
    if (byImageData && byImageData.images.length > 0) {
      byImageData.images.forEach((img, idx) => {
        const key = String(idx);
        stats[key] = { total: 0, critical: 0, high: 0 };
        img.threats.forEach(t => {
          stats[key].total++;
          const imp = (extractCoreFields(t).impact || "").toLowerCase();
          if (imp.includes("critical")) stats[key].critical++;
          else if (imp.includes("high")) stats[key].high++;
        });
      });
      // Add unmapped threat counts to each image
      const unmappedCount = { total: 0, critical: 0, high: 0 };
      (byImageData.unmapped_threats || []).forEach(t => {
        unmappedCount.total++;
        const imp = (extractCoreFields(t).impact || "").toLowerCase();
        if (imp.includes("critical")) unmappedCount.critical++;
        else if (imp.includes("high")) unmappedCount.high++;
      });
      // Distribute unmapped to all images
      byImageData.images.forEach((_img, idx) => {
        const key = String(idx);
        if (!stats[key]) stats[key] = { total: 0, critical: 0, high: 0 };
        stats[key].total += unmappedCount.total;
        stats[key].critical += unmappedCount.critical;
        stats[key].high += unmappedCount.high;
      });
    } else {
      threatModel.forEach(t => {
        const imgId = t.image_id || "_all";
        if (!stats[imgId]) stats[imgId] = { total: 0, critical: 0, high: 0 };
        stats[imgId].total++;
        const imp = (extractCoreFields(t).impact || "").toLowerCase();
        if (imp.includes("critical")) stats[imgId].critical++;
        else if (imp.includes("high")) stats[imgId].high++;
      });
    }
    return stats;
  }, [threatModel, byImageData]);

  const stats = useMemo(() => {
    const s = { total: threatModel.length, critical: 0, high: 0, medium: 0, low: 0 };
    threatModel.forEach((t) => {
      const { impact } = extractCoreFields(t);
      const imp = impact.toLowerCase();
      if (imp.includes("critical")) s.critical++;
      else if (imp.includes("high")) s.high++;
      else if (imp.includes("medium")) s.medium++;
      else s.low++;
    });
    return s;
  }, [threatModel]);

  const isReadOnly = assessmentState === "APPROVED";

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ ThreatModel: threatModel, CriticalRisks: criticalRisks }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(frameworkName.toLowerCase())}-report-${sanitizeFilename(id)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON report downloaded");
  };

  const downloadCsv = async () => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const res = await fetch(`${API_BASE}/threat_modeling/${id}/export`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: "text/csv",
        },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `threat_model_${sanitizeFilename(id)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV report downloaded");
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const downloadPdf = async () => {
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const res = await fetch(`${API_BASE}/threat_modeling/${id}/export/pdf`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Accept: "application/pdf",
        },
      });
      if (!res.ok) throw new Error("PDF export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `threat_report_${sanitizeFilename(id)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF report downloaded");
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  // Sanitize text for jsPDF's default Helvetica font (WinAnsi/MacRoman codepoints only).
  // Characters outside this range (smart quotes, em-dashes, arrows, bullets, ellipses, etc.)
  // cause jsPDF's autoTable to mis-measure glyph widths, producing wide letter-spacing artifacts.
  const pdfSafe = (s: unknown): string => {
    if (s === null || s === undefined) return "";
    const str = typeof s === "string" ? s : String(s);
    return str
      // Smart quotes & primes
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      // Dashes
      .replace(/[\u2013\u2014\u2212]/g, "-")
      // Arrows
      .replace(/[\u2190\u21D0]/g, "<-")
      .replace(/[\u2192\u21D2]/g, "->")
      .replace(/[\u2194\u21D4]/g, "<->")
      .replace(/[\u2191\u21D1]/g, "^")
      .replace(/[\u2193\u21D3]/g, "v")
      // Bullets, ellipses, middle dot
      .replace(/[\u2022\u2023\u25E6\u2043]/g, "*")
      .replace(/\u2026/g, "...")
      .replace(/\u00B7/g, "-")
      // NBSP & odd whitespace -> regular space
      .replace(/[\u00A0\u2002\u2003\u2009\u200A\u202F]/g, " ")
      // Zero-width chars -> drop
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      // Checkmarks, crosses, common symbols
      .replace(/[\u2713\u2714]/g, "[ok]")
      .replace(/[\u2717\u2718\u2715]/g, "[x]")
      // Strip any remaining non-WinAnsi-printable chars
      // (keep printable ASCII + extended Latin within Win-1252)
      .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF\u0152\u0153\u0160\u0161\u017D\u017E\u0178]/g, "?");
  };

  const downloadFullPdf = async () => {
    try {
      toast.info("Generating PDF report...");
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 16;
      const contentW = pageW - margin * 2;

      // --- Design tokens --------------------------------------------------
      const C = {
        primary: [79, 70, 229] as [number, number, number],         // indigo-600
        primaryDark: [67, 56, 202] as [number, number, number],     // indigo-700
        primaryLight: [238, 242, 255] as [number, number, number],  // indigo-50
        ink: [15, 23, 42] as [number, number, number],              // slate-900
        body: [51, 65, 85] as [number, number, number],             // slate-700
        muted: [100, 116, 139] as [number, number, number],         // slate-500
        soft: [148, 163, 184] as [number, number, number],          // slate-400
        border: [226, 232, 240] as [number, number, number],        // slate-200
        bg: [248, 250, 252] as [number, number, number],            // slate-50
        white: [255, 255, 255] as [number, number, number],
        critical: [220, 38, 38] as [number, number, number],        // red-600
        high: [234, 88, 12] as [number, number, number],            // orange-600
        medium: [202, 138, 4] as [number, number, number],          // amber-600
        low: [5, 150, 105] as [number, number, number],             // emerald-600
        info: [100, 116, 139] as [number, number, number],          // slate-500
      };

      const severityColor = (impact: string): [number, number, number] => {
        const i = (impact || "").toLowerCase();
        if (i.includes("critical")) return C.critical;
        if (i.includes("high")) return C.high;
        if (i.includes("medium") || i.includes("moderate")) return C.medium;
        if (i.includes("low")) return C.low;
        return C.info;
      };

      const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
      const setText = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
      const setDraw = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

      // --- Page chrome (header band + footer) drawn AFTER all content -----
      const drawPageChrome = () => {
        const pageCount = (doc as any).internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);

          // Skip header on cover page (page 1)
          if (i > 1) {
            // Header band — thin indigo strip
            setFill(C.primary);
            doc.rect(0, 0, pageW, 8, "F");

            // Wordmark
            doc.setFontSize(8);
            doc.setFont("helvetica", "bold");
            setText(C.white);
            doc.text("BLANC  ·  THREAT MODELING STUDIO", margin, 5.5);

            // Right side — feature name
            doc.setFont("helvetica", "normal");
            const headerRight = pdfSafe(featureName || frameworkName || "Assessment");
            doc.text(headerRight, pageW - margin, 5.5, { align: "right" });
          }

          // Footer — divider + brand + page x of y + date
          setDraw(C.border);
          doc.setLineWidth(0.2);
          doc.line(margin, pageH - 12, pageW - margin, pageH - 12);

          doc.setFontSize(7.5);
          doc.setFont("helvetica", "normal");
          setText(C.muted);
          doc.text(
            `Generated ${new Date().toLocaleString()}`,
            margin,
            pageH - 6,
          );
          doc.setFont("helvetica", "bold");
          setText(C.primary);
          doc.text("BLANC", pageW / 2, pageH - 6, { align: "center" });
          doc.setFont("helvetica", "normal");
          setText(C.muted);
          doc.text(
            `Page ${i} of ${pageCount}`,
            pageW - margin,
            pageH - 6,
            { align: "right" },
          );
        }
      };

      // --- Reusable section header ----------------------------------------
      const drawSectionHeader = (
        eyebrow: string,
        title: string,
        y: number,
      ): number => {
        // Eyebrow
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        setText(C.primary);
        doc.text(pdfSafe(eyebrow).toUpperCase(), margin, y);

        // Title
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        setText(C.ink);
        doc.text(pdfSafe(title), margin, y + 7);

        // Underline
        setDraw(C.primary);
        doc.setLineWidth(0.6);
        doc.line(margin, y + 10, margin + 18, y + 10);

        return y + 16;
      };

      // --- Subsection mini-header -----------------------------------------
      const drawSubHeader = (label: string, y: number): number => {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        setText(C.primaryDark);
        doc.text(pdfSafe(label).toUpperCase(), margin, y);

        setDraw(C.border);
        doc.setLineWidth(0.15);
        const textW = doc.getTextWidth(pdfSafe(label).toUpperCase());
        doc.line(margin + textW + 3, y - 1, pageW - margin, y - 1);
        return y + 5;
      };

      // -------------------------------------------------------------------
      // --- COVER PAGE ----------------------------------------------------
      // -------------------------------------------------------------------

      // Top gradient band (simulated with stacked rects)
      const bandH = 60;
      setFill(C.primary);
      doc.rect(0, 0, pageW, bandH, "F");
      setFill(C.primaryDark);
      doc.rect(0, bandH - 8, pageW, 8, "F");

      // Brand wordmark in band
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      setText(C.white);
      doc.text("BLANC", margin, 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text("THREAT MODELING STUDIO", margin, 19);

      // Right-side tag
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.text("THREAT ASSESSMENT REPORT", pageW - margin, 14, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.text(
        `Generated ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
        pageW - margin,
        19,
        { align: "right" },
      );

      // Big title in band
      doc.setFontSize(28);
      doc.setFont("helvetica", "bold");
      setText(C.white);
      const title = pdfSafe(featureName || "Untitled Assessment");
      doc.text(title, margin, 42);

      // Framework subtitle
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      setText(C.primaryLight);
      doc.text(
        pdfSafe(`${frameworkName} framework`),
        margin,
        50,
      );

      // --- Stat cards row ------------------------------------------------
      const totalThreats = threatModel.length;
      const cardY = bandH + 14;
      const cardH = 28;
      const cards = [
        { label: "Total Threats", value: String(totalThreats), color: C.ink, accent: C.primary },
        { label: "Critical", value: String(stats.critical), color: C.critical, accent: C.critical },
        { label: "High", value: String(stats.high), color: C.high, accent: C.high },
        { label: "Medium", value: String(stats.medium), color: C.medium, accent: C.medium },
        { label: "Low", value: String(stats.low), color: C.low, accent: C.low },
      ];
      const gap = 4;
      const cardW = (contentW - gap * (cards.length - 1)) / cards.length;
      cards.forEach((card, idx) => {
        const x = margin + idx * (cardW + gap);
        // Card bg
        setFill(C.white);
        setDraw(C.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(x, cardY, cardW, cardH, 2, 2, "FD");
        // Accent bar
        setFill(card.accent);
        doc.rect(x, cardY, 1.6, cardH, "F");
        // Value
        doc.setFontSize(22);
        doc.setFont("helvetica", "bold");
        setText(card.color);
        doc.text(card.value, x + 5, cardY + 14);
        // Label
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        setText(C.muted);
        doc.text(card.label.toUpperCase(), x + 5, cardY + 21);
      });

      // --- Metadata table ------------------------------------------------
      const metaY = cardY + cardH + 14;
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      setText(C.primary);
      doc.text("ASSESSMENT DETAILS", margin, metaY);
      setDraw(C.border);
      doc.setLineWidth(0.3);
      doc.line(margin, metaY + 2, pageW - margin, metaY + 2);

      const metaRows: [string, string][] = [
        ["Feature Name", pdfSafe(featureName || "—")],
        ["Framework", pdfSafe(frameworkName)],
        ["Assessment ID", pdfSafe(id)],
        ["State", pdfSafe(assessmentState || "—")],
        ["Architecture Diagrams", String(byImageData?.images?.length || 0)],
        ["Cross-image Threats", String(byImageData?.unmapped_threats?.length || 0)],
      ];
      const metaRowH = 7;
      metaRows.forEach((row, i) => {
        const y = metaY + 8 + i * metaRowH;
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        setText(C.muted);
        doc.text(row[0].toUpperCase(), margin, y);
        doc.setFont("helvetica", "normal");
        setText(C.ink);
        doc.text(row[1], margin + 50, y);
      });

      // Confidentiality stamp at bottom of cover
      const stampY = pageH - 24;
      setFill(C.primaryLight);
      doc.roundedRect(margin, stampY, contentW, 12, 2, 2, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      setText(C.primaryDark);
      doc.text("CONFIDENTIAL", margin + 4, stampY + 5);
      doc.setFont("helvetica", "normal");
      setText(C.body);
      doc.text(
        "This document contains sensitive security findings. Distribute on a need-to-know basis only.",
        margin + 4,
        stampY + 9,
      );

      // -------------------------------------------------------------------
      // --- SOURCE DOCUMENTS PAGE -----------------------------------------
      // -------------------------------------------------------------------
      // Lists every uploaded artifact (input images, input PDFs, and any
      // supporting PDFs ingested as RAG context). Each entry shows the
      // original filename and a clickable link when a public URL exists.
      if (sourceDocuments.length > 0) {
        doc.addPage();
        let yPos = 18;
        yPos = drawSectionHeader("Source Documents", "Inputs & Supporting Material", yPos);

        // Split docs by role: images = "Input Diagram(s)", PDFs = "Documents"
        const imageDocs = sourceDocuments.filter(d => d.document_type === "IMAGE");
        const pdfDocs = sourceDocuments.filter(d => d.document_type === "PDF");

        const buildLink = (d: SourceDocument): string | null => {
          if (d.public_url) return d.public_url;
          if (d.stored_path) {
            const rawPath = d.stored_path;
            const uploadsIdx = rawPath.indexOf("uploads/");
            const cleanPath = uploadsIdx !== -1
              ? rawPath.substring(uploadsIdx)
              : rawPath.replace(/^\/+/, "");
            return `${API_BASE}/${cleanPath}`;
          }
          return null;
        };

        const renderDocTable = (rows: SourceDocument[], title: string) => {
          if (rows.length === 0) return;
          if (yPos > pageH - 50) { doc.addPage(); yPos = 18; }
          yPos = drawSubHeader(`${title} (${rows.length})`, yPos);

          const body = rows.map((d, i) => [
            String(i + 1),
            pdfSafe(d.original_filename || "(unnamed)"),
            d.document_type,
            pdfSafe(buildLink(d) || "(no link available)"),
          ]);

          autoTable(doc, {
            startY: yPos,
            head: [["#", "Filename", "Type", "Link"]],
            body,
            styles: {
              font: "helvetica",
              fontSize: 8,
              cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
              textColor: C.body,
              lineColor: C.border,
              lineWidth: 0.1,
              overflow: "linebreak",
              valign: "top",
            },
            headStyles: {
              fillColor: C.bg,
              textColor: C.muted,
              fontStyle: "bold",
              fontSize: 7.5,
              lineColor: C.border,
              lineWidth: 0.1,
              cellPadding: { top: 3, right: 2.5, bottom: 3, left: 2.5 },
            },
            alternateRowStyles: { fillColor: C.white },
            columnStyles: {
              0: { cellWidth: 8, halign: "center", textColor: C.muted, fontStyle: "bold" },
              1: { cellWidth: 60, fontStyle: "bold", textColor: C.ink },
              2: { cellWidth: 18, halign: "center" },
              3: { cellWidth: contentW - 8 - 60 - 18, textColor: C.primary },
            },
            margin: { left: margin, right: margin },
            theme: "plain",
            tableLineColor: C.border,
            tableLineWidth: 0.15,
            didDrawCell: (data) => {
              // Make the Link column clickable
              if (data.section === "body" && data.column.index === 3) {
                const d = rows[data.row.index];
                const link = buildLink(d);
                if (link) {
                  doc.link(
                    data.cell.x,
                    data.cell.y,
                    data.cell.width,
                    data.cell.height,
                    { url: link },
                  );
                }
              }
            },
          });
          yPos = (doc as any).lastAutoTable.finalY + 8;
        };

        renderDocTable(imageDocs, "Input Diagrams");
        renderDocTable(pdfDocs, "PDF Documents (Input & Supporting)");
      }

      // -------------------------------------------------------------------
      // --- PER-IMAGE SECTIONS --------------------------------------------
      // -------------------------------------------------------------------
      const images = byImageData?.images || [];
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

      // Group unmapped threats by image_id so they render under their owning image.
      // Threats with no image_id remain as true orphans for the final residual page.
      const allUnmapped = byImageData?.unmapped_threats || [];
      const unmappedByImage = new Map<string, ThreatRow[]>();
      const orphanUnmapped: ThreatRow[] = [];
      for (const t of allUnmapped) {
        const iid = (t.image_id as string | undefined) || "";
        if (iid) {
          const list = unmappedByImage.get(iid) ?? [];
          list.push(t);
          unmappedByImage.set(iid, list);
        } else {
          orphanUnmapped.push(t);
        }
      }

      const renderThreatTable = (
        rows: ThreatRow[],
        startY: number,
      ): number => {
        const tableData = rows.map((t, idx) => {
          const { category, title: tTitle, description, impact, mitigation } = extractCoreFields(t);
          return [
            String(idx + 1),
            pdfSafe(category || "Identified Risks"),
            pdfSafe(tTitle),
            pdfSafe(description),
            pdfSafe(impact),
            pdfSafe(mitigation),
          ];
        });

        autoTable(doc, {
          startY,
          head: [["#", "Category", "Threat", "Description", "Impact", "Mitigation"]],
          body: tableData,
          styles: {
            font: "helvetica",
            fontSize: 7.5,
            cellPadding: { top: 3, right: 2.5, bottom: 3, left: 2.5 },
            textColor: C.body,
            lineColor: C.border,
            lineWidth: 0.1,
            overflow: "linebreak",
            valign: "top",
          },
          headStyles: {
            fillColor: C.primary,
            textColor: C.white,
            fontStyle: "bold",
            fontSize: 7.5,
            lineColor: C.primary,
            lineWidth: 0,
            cellPadding: { top: 3.5, right: 2.5, bottom: 3.5, left: 2.5 },
          },
          alternateRowStyles: { fillColor: C.bg },
          columnStyles: {
            0: { cellWidth: 8, halign: "center", textColor: C.muted, fontStyle: "bold" },
            1: { cellWidth: 28, textColor: C.muted, fontSize: 7 },
            2: { cellWidth: 44, fontStyle: "bold", textColor: C.ink },
            3: { cellWidth: 70 },
            4: { cellWidth: 18, halign: "center", fontStyle: "bold" },
            5: { cellWidth: contentW - 8 - 28 - 44 - 70 - 18 },
          },
          margin: { left: margin, right: margin },
          theme: "plain",
          tableLineColor: C.border,
          tableLineWidth: 0.15,
          didParseCell: (data: any) => {
            if (data.section === "body" && data.column.index === 4) {
              const imp = String(data.cell.raw || "").toLowerCase();
              const c = severityColor(imp);
              data.cell.styles.textColor = c;
            }
          },
        });
        return (doc as any).lastAutoTable.finalY + 8;
      };

      for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
        const img = images[imgIdx];
        doc.addPage();

        let yPos = 18;
        yPos = drawSectionHeader(
          `Image ${imgIdx + 1} of ${images.length}`,
          "Architecture Diagram",
          yPos,
        );

        // -- Architecture image --
        if (img.image_path || img.meta?.public_url || img.public_url) {
          try {
            const publicUrl = img.meta?.public_url || img.public_url;
            const imgUrl = publicUrl
              ? publicUrl
              : (() => {
                  const rawPath = img.image_path || "";
                  const uploadsIdx = rawPath.indexOf("uploads/");
                  const cleanPath = uploadsIdx !== -1
                    ? rawPath.substring(uploadsIdx)
                    : rawPath.replace(/^\/+/, "");
                  return `${API_BASE}/${cleanPath}`;
                })();

            const response = await fetch(imgUrl, {
              headers: publicUrl ? {} : token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!response.ok) throw new Error("Image fetch failed");
            const blob = await response.blob();
            const dataUrl: string = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });

            const maxImgW = contentW;
            const maxImgH = 95;
            const tmpImg = new Image();
            tmpImg.src = dataUrl;
            await new Promise<void>((resolve) => {
              tmpImg.onload = () => resolve();
              tmpImg.onerror = () => resolve();
            });
            const naturalW = tmpImg.width || 800;
            const naturalH = tmpImg.height || 600;
            const ratio = Math.min(maxImgW / naturalW, maxImgH / naturalH);
            const drawW = naturalW * ratio;
            const drawH = naturalH * ratio;
            const imgX = (pageW - drawW) / 2;

            // Frame around image
            setFill(C.bg);
            setDraw(C.border);
            doc.setLineWidth(0.3);
            doc.roundedRect(imgX - 2, yPos - 2, drawW + 4, drawH + 4, 1.5, 1.5, "FD");

            const fmt = (img.image_path || "").toLowerCase().endsWith(".jpg") ||
                        (img.image_path || "").toLowerCase().endsWith(".jpeg")
              ? "JPEG"
              : "PNG";
            doc.addImage(dataUrl, fmt, imgX, yPos, drawW, drawH, undefined, "FAST");
            yPos += drawH + 4;

            // Caption
            doc.setFontSize(7.5);
            doc.setFont("helvetica", "italic");
            setText(C.muted);
            const diagramType = (img.meta as Record<string, unknown> | undefined)?.diagram_type;
            const caption = pdfSafe(
              typeof diagramType === "string" && diagramType
                ? `Figure ${imgIdx + 1}. ${diagramType}`
                : `Figure ${imgIdx + 1}. Architecture diagram`,
            );
            doc.text(caption, pageW / 2, yPos + 2, { align: "center" });
            yPos += 8;
          } catch {
            setFill(C.bg);
            doc.roundedRect(margin, yPos, contentW, 18, 2, 2, "F");
            doc.setFontSize(9);
            doc.setFont("helvetica", "italic");
            setText(C.muted);
            doc.text("Architecture image could not be loaded.", pageW / 2, yPos + 11, { align: "center" });
            yPos += 22;
          }
        }

        // -- Executive summary --
        const summary = perImageSummaries[img.image_id];
        if (summary) {
          if (yPos > pageH - 50) {
            doc.addPage();
            yPos = 18;
          }
          yPos = drawSubHeader("Executive Summary", yPos);

          const summaryLines = doc.splitTextToSize(pdfSafe(summary), contentW - 8);
          const maxLines = Math.min(summaryLines.length, 10);
          const boxH = maxLines * 4 + 6;

          setFill(C.primaryLight);
          doc.roundedRect(margin, yPos - 2, contentW, boxH, 2, 2, "F");
          // Left accent strip
          setFill(C.primary);
          doc.rect(margin, yPos - 2, 1.5, boxH, "F");

          doc.setFontSize(8.5);
          doc.setFont("helvetica", "normal");
          setText(C.body);
          doc.text(summaryLines.slice(0, maxLines), margin + 5, yPos + 2);
          yPos += boxH + 6;
        }

        // -- Threats --
        // Combine: this image's own threats + image-tagged unmapped threats
        // + system-wide orphan threats (no image_id, apply to every diagram).
        const allImageThreats = [
          ...(img.threats || []),
          ...(unmappedByImage.get(img.image_id) || []),
          ...orphanUnmapped,
        ];
        if (allImageThreats.length > 0) {
          if (yPos > pageH - 45) {
            doc.addPage();
            yPos = 18;
          }
          yPos = drawSubHeader(`Threats (${allImageThreats.length})`, yPos);
          yPos = renderThreatTable(allImageThreats, yPos);
        }
      }

      // --- Apply page chrome (header bands + footers) to all pages --------
      drawPageChrome();

      doc.save(`threat-report-${sanitizeFilename(featureName || id)}.pdf`);
      toast.success("PDF report downloaded");
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleSaveAnswers = useCallback(async (silent = false) => {
    if (Object.keys(editingAnswers).length === 0) return;
    try {
      setSavingAnswers(true);
      // Group edited answers by image_id
      const byImage: Record<string, { question: string; answer: string }[]> = {};
      clarificationQuestions.forEach((q, idx) => {
        const imgId = q.image_id;
        if (!imgId) return;
        const answer = editingAnswers[idx] !== undefined ? editingAnswers[idx] : q.answer;
        if (!byImage[imgId]) {
          // Collect ALL questions for this image (not just edited ones)
          byImage[imgId] = [];
        }
        byImage[imgId].push({ question: q.question, answer: answer || "" });
      });
      // If an image_id has no edits, we still need to build full question lists
      // Rebuild: collect all questions per image, applying edits
      const fullByImage: Record<string, { question: string; answer: string }[]> = {};
      clarificationQuestions.forEach((q, idx) => {
        const imgId = q.image_id;
        if (!imgId) return;
        if (!fullByImage[imgId]) fullByImage[imgId] = [];
        const answer = editingAnswers[idx] !== undefined ? editingAnswers[idx] : (q.answer || "");
        fullByImage[imgId].push({ question: q.question, answer });
      });
      // Only save images that have at least one edited answer
      const editedImageIds = new Set<string>();
      clarificationQuestions.forEach((q, idx) => {
        if (editingAnswers[idx] !== undefined && q.image_id) {
          editedImageIds.add(q.image_id);
        }
      });
      for (const imgId of editedImageIds) {
        await api.put(`/assessment/${id}/images/${imgId}/save-answers`, {
          clarification_questions: fullByImage[imgId],
        });
      }
      // Update local state
      const updatedQuestions = clarificationQuestions.map((q, idx) => ({
        ...q,
        answer: editingAnswers[idx] !== undefined ? editingAnswers[idx] : q.answer
      }));
      setClarificationQuestions(updatedQuestions);
      setEditingAnswers({});
      if (!silent) {
        setShowSaveSuccess(true);
        setTimeout(() => setShowSaveSuccess(false), 3000);
        toast.success("Answers saved successfully");
      }
    } catch (err: unknown) {
      if (!silent) toast.error(getErrorMessage(err));
    } finally {
      setSavingAnswers(false);
    }
  }, [editingAnswers, clarificationQuestions, id]);

  // Auto-save: debounce 2s after any answer edit
  useEffect(() => {
    if (Object.keys(editingAnswers).length === 0) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      handleSaveAnswers(true);
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [editingAnswers, handleSaveAnswers]);

  const handleReanalyzeThreats = async () => {
    try {
      setLoading(true);
      setError(null);
      await api.post(`/threat_modeling/${id}/reanalyze`, {}, { retryOnPost: true });
      toast.info("Re-analysis started — this may take a few minutes");
      startStatusPolling();
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (msg.includes("already in progress")) {
        toast.warning("Threat modeling is already running");
        startStatusPolling();
      } else {
        toast.error(msg);
        setError(msg);
      }
      setLoading(false);
    }
  };

  // -- Reviewer API Functions --
  const searchReviewers = async (query: string) => {
    if (query.length < 2) {
      setReviewerSearchResults([]);
      return;
    }
    try {
      setSearchingReviewers(true);
      const json = await api.get(`/reviews/reviewer-search?search=${encodeURIComponent(query)}`);
      setReviewerSearchResults(json?.data?.users || []);
    } catch (err) {
      console.error("Reviewer search error:", err);
      setReviewerSearchResults([]);
    } finally {
      setSearchingReviewers(false);
    }
  };

  const handleReviewerSearchChange = (value: string) => {
    setReviewerSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => searchReviewers(value), 300);
  };

  const toggleReviewerSelection = (user: ReviewerUser) => {
    setSelectedReviewers(prev => {
      const exists = prev.find(r => r.userId === user.userId);
      if (exists) return prev.filter(r => r.userId !== user.userId);
      return [...prev, user];
    });
  };

  const assignReviewers = async () => {
    if (selectedReviewers.length === 0) return;
    try {
      setAssigningReviewers(true);
      await api.post(`/reviews/${id}/assign-reviewers`, { reviewer_ids: selectedReviewers.map(r => r.userId) });
      toast.success(`${selectedReviewers.length} reviewer(s) assigned successfully`);
      setReviewerSheetOpen(false);
      setSelectedReviewers([]);
      setReviewerSearchQuery("");
      setReviewerSearchResults([]);
      await fetchAssignedReviewers();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setAssigningReviewers(false);
    }
  };

  const fetchAssignedReviewers = async () => {
    try {
      const json = await api.get(`/reviews/${id}/reviewers`);
      setAssignedReviewers(json?.data?.reviewers || []);
      if (json?.data?.state) setAssessmentState(json.data.state);
    } catch (err) {
      console.error("Fetch reviewers error:", err);
    }
  };

  const submitReview = async (status: "APPROVED" | "REJECTED") => {
    try {
      setSubmittingReview(true);
      await api.post(`/reviews/${id}/submit-review`, { status, comment: reviewComment || null });
      toast.success(`Review submitted: ${status.toLowerCase()}`);
      setReviewComment("");
      await fetchAssignedReviewers();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmittingReview(false);
    }
  };

  // -- Threat-level Review API Functions --
  const reviewThreat = async (threatId: number | string, status: "APPROVED" | "REJECTED", comment?: string | null, threatKey?: string) => {
    try {
      if (threatKey) setSavingThreatReview(prev => ({ ...prev, [threatKey]: true }));
      await api.post(`/reviews/${id}/threats/${threatId}/review`, { status, comment: comment || null });
      toast.success(`Threat ${status === "APPROVED" ? "approved" : "rejected"} successfully`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      if (threatKey) setSavingThreatReview(prev => ({ ...prev, [threatKey]: false }));
    }
  };

  const bulkReviewThreats = async (status: "APPROVED" | "REJECTED") => {
    try {
      setBulkReviewing(true);
      await api.post(`/reviews/${id}/threats/bulk-review`, [{ status, comment: null }]);
      // Update local state for all threats
      const newApprovals: Record<string, "approved" | "rejected"> = {};
      if (byImageData) {
        byImageData.images.forEach((img, imgIdx) => {
          img.threats.forEach((t, idx) => {
            const { category } = extractCoreFields(t);
            newApprovals[`${imgIdx}-${category}-${idx}`] = status.toLowerCase() as "approved" | "rejected";
          });
        });
      } else {
        threatModel.forEach((t, idx) => {
          const { category } = extractCoreFields(t);
          newApprovals[`${imageNavSelection}-${category}-${idx}`] = status.toLowerCase() as "approved" | "rejected";
        });
      }
      setThreatApprovals(newApprovals);
      toast.success(`All threats ${status === "APPROVED" ? "approved" : "rejected"} successfully`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBulkReviewing(false);
    }
  };

  // Approve assessment — single reviewer approval is sufficient
  const approveAssessment = async () => {
    try {
      setApprovingAssessment(true);
      const json = await api.post(`/reviews/${id}/approve`, { comment: approveComment || null });
      setAssessmentState(json?.data?.state || "APPROVED");
      setApproveComment("");
      setShowApprovePanel(false);
      toast.success("Assessment approved successfully");
      await fetchAssignedReviewers();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setApprovingAssessment(false);
    }
  };

  // Fetch reviewers on page load
  useEffect(() => {
    if (id) {
      fetchAssignedReviewers();
    }
  }, [id]);

  return (
    <div className="min-h-screen bg-background text-foreground pb-32">
      
      {/* --- Header (assessment-style sticky blur) --- */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border"
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/assessment/my_assessment"
              className="p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="h-5 w-px bg-muted" />
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg">
                <ShieldAlert size={16} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="font-semibold text-sm text-foreground">{featureName || frameworkName} Report</h1>
                {featureName && <p className="text-[11px] text-muted-foreground hidden sm:block">{frameworkName}</p>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {assessmentState && (
              <StatusBadge variant={
                assessmentState === "APPROVED" ? "success" :
                assessmentState === "FAILED" ? "danger" :
                ["PROCESSING", "PENDING"].includes(assessmentState) ? "processing" :
                assessmentState === "CHANGES_REQUESTED" ? "warning" :
                "neutral"
              }>
                {assessmentState === "APPROVED" && <><CheckCircle2 size={12} className="mr-1" /> Approved</>}
                {assessmentState === "FAILED" && <><XCircle size={12} className="mr-1" /> Failed</>}
                {assessmentState === "PROCESSING" && <><Loader2 size={12} className="mr-1 animate-spin" /> Processing</>}
                {assessmentState === "PENDING" && <><Clock size={12} className="mr-1" /> Pending</>}
                {assessmentState === "CHANGES_REQUESTED" && <><AlertTriangle size={12} className="mr-1" /> Changes Requested</>}
                {!["APPROVED","FAILED","PROCESSING","PENDING","CHANGES_REQUESTED"].includes(assessmentState) && assessmentState}
              </StatusBadge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted data-[state=open]:bg-muted data-[state=open]:text-foreground transition-colors"
                  title="Download report"
                  aria-label="Download report"
                >
                  <Download size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-48">
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Download as
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={downloadFullPdf} className="gap-2 cursor-pointer">
                  <FileText size={14} className="text-rose-500" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">PDF report</span>
                    <span className="text-[10px] text-muted-foreground">Full formatted report</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadCsv} className="gap-2 cursor-pointer">
                  <FileText size={14} className="text-emerald-500" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">CSV / Excel</span>
                    <span className="text-[10px] text-muted-foreground">Tabular data</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadJson} className="gap-2 cursor-pointer">
                  <FileText size={14} className="text-indigo-500" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">JSON</span>
                    <span className="text-[10px] text-muted-foreground">Raw structured data</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!isReadOnly && (
              <button onClick={() => setReviewerSheetOpen(true)} className="p-2 rounded-lg text-violet-500 hover:text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:bg-violet-950 transition-colors" title="Select Reviewers">
                <UserPlus size={16} />
              </button>
            )}
            {!isReadOnly && (
              <button
                onClick={handleReanalyzeThreats}
                disabled={loading}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
                Re-Analyze
              </button>
            )}
          </div>
        </div>
      </motion.header>

      {/* Reviewer Status Bar */}
      {assignedReviewers.length > 0 && (
        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-center justify-between">
              {/* Left — state badge + reviewer avatars */}
              <div className="flex items-center gap-4">
                <StatusBadge variant={
                  assessmentState === "APPROVED" ? "success" :
                  assessmentState === "CHANGES_REQUESTED" ? "warning" : "processing"
                }>
                  {assessmentState === "APPROVED" && <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {assessmentState === "CHANGES_REQUESTED" && <AlertTriangle className="w-3 h-3 mr-1" />}
                  {assessmentState === "REVIEW" && <Clock className="w-3 h-3 mr-1" />}
                  {assessmentState || "REVIEW"}
                </StatusBadge>

                <div className="h-5 w-px bg-muted" />

                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <div className="flex -space-x-2">
                    {assignedReviewers.map((r) => {
                      const statusColor =
                        r.status === "APPROVED"
                          ? "ring-emerald-400 bg-emerald-500"
                          : r.status === "REJECTED"
                          ? "ring-rose-400 bg-rose-500"
                          : "ring-slate-300 bg-slate-400";
                      return (
                        <div
                          key={r.reviewer_id}
                          title={`${r.reviewer_name || r.reviewer_email} — ${r.status}`}
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-white relative cursor-default",
                            statusColor
                          )}
                        >
                          {r.reviewer_name?.charAt(0)?.toUpperCase() || "?"}
                          {r.status === "APPROVED" && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                              <CheckCircle2 className="w-2 h-2 text-white" />
                            </div>
                          )}
                          {r.status === "REJECTED" && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-rose-500 border-2 border-white flex items-center justify-center">
                              <XCircle className="w-2 h-2 text-white" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-xs text-muted-foreground ml-1">
                    {assignedReviewers.filter((r) => r.status === "APPROVED").length}/{assignedReviewers.length} approved
                  </span>
                </div>
              </div>

              {/* Right — approved badge */}
              <div className="flex items-center gap-2">
                {assessmentState === "APPROVED" && (
                  <StatusBadge variant="success">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Assessment Approved
                  </StatusBadge>
                )}
              </div>
            </div>

            {/* Reviewer details row */}
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-2">
              {assignedReviewers.map((r) => (
                <div
                  key={r.reviewer_id}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                    r.status === "APPROVED"
                      ? "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800"
                      : r.status === "REJECTED"
                      ? "bg-rose-50 dark:bg-rose-950 border-rose-200 dark:border-rose-800"
                      : "bg-muted border-border"
                  )}
                >
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0",
                    r.status === "APPROVED" ? "bg-emerald-500" : r.status === "REJECTED" ? "bg-rose-500" : "bg-slate-400"
                  )}>
                    {r.reviewer_name?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{r.reviewer_name || "Unknown"}</p>
                    {r.reviewer_email && <p className="text-[10px] text-muted-foreground truncate">{r.reviewer_email}</p>}
                  </div>
                  <StatusBadge variant={
                    r.status === "APPROVED" ? "success" :
                    r.status === "REJECTED" ? "danger" : "neutral"
                  }>
                    {r.status === "APPROVED" && <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />}
                    {r.status === "REJECTED" && <XCircle className="w-2.5 h-2.5 mr-0.5" />}
                    {r.status === "PENDING" && <Clock className="w-2.5 h-2.5 mr-0.5" />}
                    {r.status}
                  </StatusBadge>
                  {r.comment && (
                    <span className="text-[10px] text-muted-foreground italic truncate max-w-[150px]" title={r.comment}>
                      "{r.comment}"
                    </span>
                  )}
                  {r.reviewed_at && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(r.reviewed_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Image Navigation + Tabs */}
      <div className="bg-card border-b border-border">
        {/* Per-Image Navigation Bar */}
        {byImageData && byImageData.images.length > 0 && (
          <div className="max-w-7xl mx-auto px-6 pt-3">
            <div className="flex items-center gap-2 mb-1">
              <ImageIcon size={14} className="text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                {byImageData.images.length} image{byImageData.images.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
              {byImageData.images.map((img, idx) => {
                const isActive = imageNavSelection === idx;
                const filename = `Image ${idx + 1}`;
                const imgStats = perImageStats[String(idx)] || { total: 0, critical: 0, high: 0 };
                const hasCritical = imgStats.critical > 0;
                const hasHigh = imgStats.high > 0;

                return (
                  <button
                    key={img.image_id}
                    onClick={() => setImageNavSelection(idx)}
                    className={cn(
                      "relative flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 border",
                      isActive
                        ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 shadow-sm"
                        : hasCritical
                        ? "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:bg-rose-950 border-transparent hover:border-rose-200 dark:border-rose-800"
                        : hasHigh
                        ? "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:bg-amber-950 border-transparent hover:border-amber-200 dark:border-amber-800"
                        : "text-muted-foreground hover:bg-muted border-transparent hover:border-border"
                    )}
                  >
                    <div className={cn(
                      "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold",
                      isActive ? "bg-indigo-500 text-white"
                        : hasCritical ? "bg-rose-500 text-white"
                        : hasHigh ? "bg-amber-500 text-white"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {idx + 1}
                    </div>
                    <span className="max-w-[160px] truncate">{filename}</span>
                    <span className="text-[10px] font-bold opacity-60">{imgStats.total}</span>
                    {isActive && (
                      <motion.div
                        layoutId="activeImageTab"
                        className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-500 rounded-full"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs Navigation */}
        <div className="max-w-7xl mx-auto px-6 flex gap-8">
          {[
            { id: "threats", label: "Threats", icon: ShieldAlert },
            { id: "qa", label: "Q&A", icon: HelpCircle },
            { id: "diagram", label: "Diagram", icon: ImageIcon },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as "diagram" | "threats" | "qa")}
              className={cn(
                "flex items-center gap-2 py-4 text-sm font-semibold border-b-2 transition-colors outline-none",
                activeTab === tab.id 
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" 
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 mt-8 space-y-8">

          {/* Metrics Cards */}
          {activeTab !== "qa" && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 md:grid-cols-4 gap-4"
            >
            {[
                { label: "Total Threats", value: visibleThreats.length, icon: LayoutDashboard, color: "bg-muted text-muted-foreground", iconBg: "bg-muted" },
                { label: "Critical Risks", value: visibleThreats.filter(t => extractCoreFields(t).impact.toLowerCase().includes("critical")).length, icon: ShieldAlert, color: "text-rose-600 dark:text-rose-400", iconBg: "bg-rose-50 dark:bg-rose-950" },
                { label: "High Risks", value: visibleThreats.filter(t => extractCoreFields(t).impact.toLowerCase().includes("high")).length, icon: AlertTriangle, color: "text-orange-600", iconBg: "bg-orange-50" },
                { label: "Questions", value: clarificationQuestions.length, icon: HelpCircle, color: "text-blue-600 dark:text-blue-400", iconBg: "bg-blue-50 dark:bg-blue-950" },
            ].map((stat, i) => (
                <div key={i} className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                            <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                        </div>
                        <div className={cn("p-2.5 rounded-xl", stat.iconBg)}>
                            <stat.icon className={cn("w-5 h-5", stat.color)} />
                        </div>
                    </div>
                </div>
            ))}
            </motion.div>
          )}

          {/* LLM Usage Summary */}
          {usageData && usageData.total_calls > 0 && activeTab !== "qa" && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-3 bg-muted/50 border-b border-border">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <h4 className="text-sm font-semibold text-foreground">LLM Usage</h4>
                </div>
                <StatusBadge variant="neutral">{usageData.total_calls} API calls</StatusBadge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-950">
                    <Coins className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase font-medium">Tokens Billed</p>
                    <p className="text-lg font-bold text-foreground">{usageData.total_tokens_billed.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950">
                    <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase font-medium">Estimated Cost</p>
                    <p className="text-lg font-bold text-foreground">${usageData.total_estimated_cost.toFixed(4)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950">
                    <Timer className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase font-medium">Total Duration</p>
                    <p className="text-lg font-bold text-foreground">{(usageData.total_duration_ms / 1000).toFixed(1)}s</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950">
                    <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase font-medium">LLM Calls</p>
                    <p className="text-lg font-bold text-foreground">{usageData.total_calls}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 rounded-2xl p-5 flex items-start gap-3"
              >
                <div className="p-2 bg-rose-100 rounded-xl shrink-0">
                  <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <p className="font-semibold text-rose-800 text-sm">Error Loading Data</p>
                  <p className="text-rose-600 dark:text-rose-400 text-xs mt-0.5">{error}</p>
                </div>
              </motion.div>
          )}

          {!isAuthenticated ? (
            <div className="text-center py-12">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                <Loader2 className="text-indigo-600 dark:text-indigo-400 mx-auto" size={28} />
              </motion.div>
              <p className="text-muted-foreground text-sm mt-3">Loading...</p>
            </div>
          ) : loading && !(apiStatus?.state === "COMPLETED" && apiStatus?.stage === "THREAT_MODELING") ? (
             <motion.div
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="max-w-2xl mx-auto text-center py-16 px-4"
             >
               {(() => {
                 const progress = STAGE_CONFIG[apiStatus?.stage || ""]?.progress || 5;
                 return (
                   <>
                     <div className="relative w-24 h-24 mx-auto mb-8">
                       <svg className="w-24 h-24 animate-spin" style={{ animationDuration: "3s" }} viewBox="0 0 96 96">
                         <circle cx="48" cy="48" r="44" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                         <circle cx="48" cy="48" r="44" fill="none" stroke="#6366f1" strokeWidth="4"
                           strokeDasharray={`${progress * 2.76} 276`} strokeLinecap="round"
                           transform="rotate(-90 48 48)" className="transition-all duration-1000" />
                       </svg>
                       <div className="absolute inset-0 flex items-center justify-center">
                         <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{progress}%</span>
                       </div>
                     </div>

                     <h2 className="text-2xl font-bold text-foreground mb-2">
                       {STAGE_CONFIG[apiStatus?.stage || ""]?.label || (assessmentState === "PENDING" ? "Queued" : "Analyzing Threats")}
                     </h2>
                     <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                       {STAGE_CONFIG[apiStatus?.stage || ""]?.description || "Our AI is analyzing your architecture for potential security risks."}
                     </p>

                     <AnimatePresence mode="wait">
                       <motion.div
                         key={Math.floor(Date.now() / 3000) % PROCESSING_MESSAGES.length}
                         initial={{ opacity: 0, y: 10 }}
                         animate={{ opacity: 1, y: 0 }}
                         exit={{ opacity: 0, y: -10 }}
                         className="flex items-center justify-center gap-2 text-sm text-indigo-500"
                       >
                         <Loader2 size={14} className="animate-spin" />
                         <span>{PROCESSING_MESSAGES[Math.floor(Date.now() / 3000) % PROCESSING_MESSAGES.length]}</span>
                       </motion.div>
                     </AnimatePresence>

                     <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                       <Clock size={12} />
                       <span>Please keep this page open — we&apos;ll update everything automatically</span>
                     </div>

                     {assessmentState === "FAILED" && (
                       <div className="flex flex-col items-center gap-3 mt-6">
                         <StatusBadge variant="danger">
                           <XCircle className="w-3 h-3 mr-1" /> Pipeline Failed
                         </StatusBadge>
                         <button
                           onClick={handleReanalyzeThreats}
                           className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
                         >
                           <RefreshCw className="w-3.5 h-3.5" /> Retry
                         </button>
                       </div>
                     )}
                   </>
                 );
               })()}
             </motion.div>
          ) : (
            <>
              {/* State banners */}
              {assessmentState === "APPROVED" && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 flex items-start gap-3"
                >
                  <div className="p-2 bg-emerald-100 rounded-xl shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-emerald-800 text-sm">Assessment Approved</p>
                    <p className="text-emerald-700 dark:text-emerald-300 text-xs mt-0.5">
                      This threat model has been reviewed and approved. The report is now read-only.
                    </p>
                  </div>
                </motion.div>
              )}

              {assessmentState === "CHANGES_REQUESTED" && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-2xl p-5"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-amber-100 rounded-xl shrink-0">
                      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-amber-800 text-sm">Changes Requested</p>
                      <p className="text-amber-700 dark:text-amber-300 text-xs mt-0.5">
                        A reviewer has requested changes to this threat model. Review the comments and re-assign reviewers when ready.
                      </p>
                    </div>
                  </div>
                  {assignedReviewers.filter(r => r.status === "REJECTED" && r.comment).length > 0 && (
                    <div className="mt-3 space-y-2 ml-12">
                      {assignedReviewers.filter(r => r.status === "REJECTED" && r.comment).map((r, i) => (
                        <div key={i} className="p-3 bg-card rounded-xl border border-amber-200 dark:border-amber-800 text-sm">
                          <span className="font-semibold text-amber-800">{r.reviewer_name}:</span>{" "}
                          <span className="text-amber-700 dark:text-amber-300">{r.comment}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* DIAGRAM TAB */}
              {activeTab === "diagram" && (
                <div className="space-y-8">
                  {(() => {
                    const selectedImg = byImageData?.images[imageNavSelection];
                    const selectedImageId = selectedImg?.image_id;
                    const diagram = selectedImageId ? perImageDiagrams[selectedImageId] : undefined;
                    const summary = selectedImageId ? perImageSummaries[selectedImageId] : undefined;
                    const components = selectedImageId ? perImageComponents[selectedImageId] : undefined;
                    const imgMeta = selectedImageId ? imageLocations.find((il: any) => il.image_id === selectedImageId) : undefined;
                    const rawFilename = imgMeta?.meta?.original_filename
                      || (imgMeta?.image_path ? imgMeta.image_path.split('/').pop() : null);
                    const filename = rawFilename || `Image ${imageNavSelection + 1}`;

                    if (!selectedImageId && mermaidDiagram) {
                      return (
                        <motion.div
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                              <Maximize2 className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-foreground">Data Flow Diagram</h3>
                              <p className="text-xs text-muted-foreground">Interactive architecture visualization — drag to pan, scroll to zoom</p>
                            </div>
                          </div>
                          <MermaidDiagram diagram={mermaidDiagram} />
                        </motion.div>
                      );
                    }

                    if (!selectedImageId && !mermaidDiagram) {
                      return (
                        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3 border-2 border-dashed border-border rounded-2xl bg-card">
                          <ImageIcon className="h-12 w-12 opacity-20" />
                          <p className="font-medium text-muted-foreground">No diagrams or images available</p>
                          <p className="text-sm text-muted-foreground">Upload architecture files to view them here</p>
                        </div>
                      );
                    }

                    return (
                      <motion.div
                        key={selectedImageId}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-5"
                      >
                        {/* Mermaid Diagram */}
                        {diagram ? (
                          <>
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                                <Maximize2 className="w-5 h-5" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-foreground">Data Flow — {filename}</h3>
                                <p className="text-xs text-muted-foreground">Architecture diagram derived from the uploaded image</p>
                              </div>
                            </div>
                            <MermaidDiagram diagram={diagram} />
                          </>
                        ) : null}

                        {/* Uploaded Image for selected image */}
                        {imgMeta && (
                          <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="space-y-3"
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-foreground">Uploaded Image</h3>
                                <p className="text-xs text-muted-foreground">Original architecture image used for analysis</p>
                              </div>
                            </div>
                            <div className="group rounded-2xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-all max-w-2xl">
                              <div className="relative w-full h-72 bg-muted flex items-center justify-center overflow-hidden">
                                <img
                                  src={(() => {
                                    const publicUrl = imgMeta.meta?.public_url || imgMeta.public_url;
                                    if (publicUrl) return publicUrl;
                                    const storedPath = imgMeta.meta?.stored_path || imgMeta.image_path;
                                    if (storedPath) {
                                      // Extract path from "uploads/" onwards (handles both local dev paths and container paths)
                                      const uploadsIdx = storedPath.indexOf('uploads/');
                                      const cleanPath = uploadsIdx !== -1
                                        ? storedPath.substring(uploadsIdx)
                                        : storedPath.replace(/^\/+/, '');
                                      const url = `${API_BASE}/${cleanPath}`;
                                      if (isValidApiImageUrl(url, API_BASE)) return url;
                                    }
                                    // Fallback: direct image-serving endpoint
                                    return `${API_BASE}/assessment/${id}/image/${selectedImageId}`;
                                  })()}
                                  alt={filename}
                                  className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-300"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200'%3E%3Crect fill='%23f8fafc' width='300' height='200'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%2394a3b8' font-size='14'%3EImage unavailable%3C/text%3E%3C/svg%3E";
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/50">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {filename}
                                </p>
                                <StatusBadge variant="neutral">
                                  {imgMeta.document_type?.split('/')[1]?.toUpperCase() || 'IMG'}
                                </StatusBadge>
                              </div>
                            </div>
                          </motion.div>
                        )}

                        {!diagram && !imgMeta && (
                          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3 border-2 border-dashed border-border rounded-2xl bg-card">
                            <ImageIcon className="h-12 w-12 opacity-20" />
                            <p className="font-medium text-muted-foreground">No diagram available for this image</p>
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}
                </div>
              )}
              
              {/* THREATS TAB */}
              {activeTab === "threats" && (
                <div className="space-y-8">

                  {/* Bulk review actions */}
                  {!isReadOnly && visibleThreats.length > 0 && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        {Object.keys(threatApprovals).length > 0 && (
                          <span className="inline-flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            {Object.values(threatApprovals).filter(v => v === "approved").length} approved,{" "}
                            {Object.values(threatApprovals).filter(v => v === "rejected").length} rejected
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:bg-rose-950"
                          disabled={bulkReviewing}
                          onClick={() => bulkReviewThreats("REJECTED")}
                        >
                          {bulkReviewing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ThumbsDown className="w-3.5 h-3.5 mr-1.5" />}
                          Reject All
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={bulkReviewing}
                          onClick={() => bulkReviewThreats("APPROVED")}
                        >
                          {bulkReviewing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5 mr-1.5" />}
                          Approve All
                        </Button>
                      </div>
                    </div>
                  )}
                  {/* Severity sort control */}
                  {visibleThreats.length > 0 && (
                    <div className="flex items-center justify-end">
                      <button
                        onClick={toggleSeveritySort}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-indigo-600 dark:text-indigo-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-muted border border-transparent hover:border-border"
                      >
                        Sort by Severity
                        {severitySortOrder === "desc" ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : severitySortOrder === "asc" ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 opacity-30" />
                        )}
                      </button>
                    </div>
                  )}

                  {visibleThreats.length > 0 ? (
                    Object.entries(groupedThreats).map(([category, threats]) => {
                      const meta = getCategoryMeta(category);
                      const Icon = meta.icon;

                      return (
                        <motion.div
                          key={`${imageNavSelection}-${category}`}
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-4 mb-8"
                          id={category.toLowerCase().replace(/\s/g, '-')}
                        >
                          {/* Category Header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={cn("p-2.5 rounded-xl border shadow-sm", meta.color)}>
                                <Icon className="w-5 h-5" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-foreground tracking-tight">{meta.label}</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">{meta.desc}</p>
                              </div>
                            </div>
                            <StatusBadge variant="neutral">
                              {threats.length} {threats.length === 1 ? "Finding" : "Findings"}
                            </StatusBadge>
                          </div>

                          {/* Threat Cards */}
                          <div className="space-y-3">
                            {threats.map((item, idx) => {
                              const { title, description, impact, mitigation, targetLabel, targetValue } = extractCoreFields(item);
                              const threatKey = `${imageNavSelection}-${category}-${idx}`;
                              const isApproved = threatApprovals[threatKey] === "approved";
                              const isRejected = threatApprovals[threatKey] === "rejected";

                              return (
                                <motion.div
                                  key={`${imageNavSelection}-${idx}`}
                                  initial={{ opacity: 0, y: 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: 0.03 * idx }}
                                  className={cn(
                                    "bg-card border rounded-2xl shadow-sm transition-all hover:shadow-md group",
                                    isApproved ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30" :
                                    isRejected ? "border-rose-200 dark:border-rose-800 bg-rose-50/30" :
                                    "border-border"
                                  )}
                                >
                                  {/* Card Header */}
                                  <div className="p-5 pb-0">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                                          <SeverityBadge value={impact} />
                                          {targetValue !== "System Architecture" && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md border border-border">
                                              {targetLabel}: <span className="text-foreground">{targetValue}</span>
                                            </span>
                                          )}
                                          {(isApproved || isRejected) && (
                                            <span className={cn(
                                              "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md",
                                              isApproved ? "text-emerald-700 dark:text-emerald-300 bg-emerald-100" : "text-rose-700 dark:text-rose-300 bg-rose-100"
                                            )}>
                                              {isApproved ? <><CheckCircle2 className="w-3 h-3" /> Approved</> : <><XCircle className="w-3 h-3" /> Rejected</>}
                                            </span>
                                          )}
                                        </div>
                                        <h4 className="text-sm font-bold text-foreground leading-snug">{title}</h4>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Card Body */}
                                  <div className="px-5 py-3 space-y-3">
                                    {description && (
                                      <div>
                                        <ExpandableText text={description} />
                                      </div>
                                    )}

                                    {/* Mitigation */}
                                    <div className="bg-muted border border-border rounded-xl p-3.5">
                                      <div className="flex items-center gap-1.5 mb-1.5">
                                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Mitigation</span>
                                      </div>
                                      <ExpandableText text={mitigation} />
                                    </div>
                                  </div>

                                  {/* Card Footer — Review Actions */}
                                  {!isReadOnly && (
                                    <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-2">
                                        <Button
                                          size="sm"
                                          variant={isApproved ? "default" : "outline"}
                                          className={cn(
                                            "h-8 gap-1.5 text-xs",
                                            isApproved ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "text-muted-foreground hover:text-emerald-700 dark:text-emerald-300 hover:border-emerald-300"
                                          )}
                                          disabled={savingThreatReview[threatKey]}
                                          onClick={() => {
                                            setThreatApprovals({...threatApprovals, [threatKey]: "approved"});
                                            const threatId = item.id || item.threat_id;
                                            if (threatId != null) {
                                              reviewThreat(threatId, "APPROVED", reviewerComments[threatKey] || null, threatKey);
                                            }
                                          }}
                                        >
                                          {savingThreatReview[threatKey] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant={isRejected ? "default" : "outline"}
                                          className={cn(
                                            "h-8 gap-1.5 text-xs",
                                            isRejected ? "bg-rose-600 hover:bg-rose-700 text-white" : "text-muted-foreground hover:text-rose-700 dark:text-rose-300 hover:border-rose-300"
                                          )}
                                          disabled={savingThreatReview[threatKey]}
                                          onClick={() => {
                                            setThreatApprovals({...threatApprovals, [threatKey]: "rejected"});
                                            const threatId = item.id || item.threat_id;
                                            if (threatId != null) {
                                              reviewThreat(threatId, "REJECTED", reviewerComments[threatKey] || null, threatKey);
                                            }
                                          }}
                                        >
                                          {savingThreatReview[threatKey] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsDown className="w-3.5 h-3.5" />}
                                          Reject
                                        </Button>
                                      </div>

                                      {/* Comment */}
                                      <div className="flex-1 max-w-xs">
                                        {editingComment[threatKey] ? (
                                          <div className="flex flex-col gap-2">
                                            <textarea
                                              value={reviewerComments[threatKey] || ""}
                                              onChange={(e) => setReviewerComments({...reviewerComments, [threatKey]: e.target.value})}
                                              placeholder="Add a review comment..."
                                              className="w-full h-16 p-2.5 border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                            />
                                            <div className="flex gap-1.5 justify-end">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-7 text-xs"
                                                onClick={() => setEditingComment({...editingComment, [threatKey]: false})}
                                              >
                                                Cancel
                                              </Button>
                                              <Button
                                                size="sm"
                                                className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                                                onClick={() => {
                                                  setEditingComment({...editingComment, [threatKey]: false});
                                                  const threatId = item.id || item.threat_id;
                                                  const currentStatus = threatApprovals[threatKey] === "approved" ? "APPROVED" : threatApprovals[threatKey] === "rejected" ? "REJECTED" : null;
                                                  if (threatId != null && currentStatus) {
                                                    reviewThreat(threatId, currentStatus as "APPROVED" | "REJECTED", reviewerComments[threatKey] || null, threatKey);
                                                  }
                                                }}
                                              >
                                                Done
                                              </Button>
                                            </div>
                                          </div>
                                        ) : reviewerComments[threatKey] ? (
                                          <div className="space-y-1">
                                            <p className="text-xs text-muted-foreground leading-relaxed bg-muted p-2 rounded-lg border border-border line-clamp-2">
                                              {reviewerComments[threatKey]}
                                            </p>
                                            <button
                                              onClick={() => setEditingComment({...editingComment, [threatKey]: true})}
                                              className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800"
                                            >
                                              Edit comment
                                            </button>
                                          </div>
                                        ) : (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-8 text-xs text-muted-foreground hover:text-foreground"
                                            onClick={() => setEditingComment({...editingComment, [threatKey]: true})}
                                          >
                                            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                                            Comment
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        </motion.div>
                      );
                    })
                  ) : ["PROCESSING", "PENDING"].includes(assessmentState) || pollingIntervalRef.current ? (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col items-center justify-center text-muted-foreground gap-3 h-64 border-2 border-dashed border-border rounded-2xl bg-card"
                    >
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                      <p className="font-medium text-foreground">Generating threats&hellip;</p>
                      <p className="text-sm text-muted-foreground">The analysis is still in progress. Threats will appear here once ready.</p>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground gap-2 h-64 border-2 border-dashed border-border rounded-2xl bg-card">
                      <Activity className="h-10 w-10 opacity-20" />
                      <p className="font-medium text-muted-foreground">No threats found for this assessment.</p>
                    </div>
                  )}
                </div>
              )}

              
              {/* Reviewer Selection Sheet */}
              <Sheet open={reviewerSheetOpen} onOpenChange={setReviewerSheetOpen}>
                <SheetContent side="right" className="w-full sm:max-w-lg">
                  <SheetHeader className="pb-4 border-b">
                    <SheetTitle className="flex items-center gap-2">
                      <UserPlus className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                      Select Reviewers
                    </SheetTitle>
                    <SheetDescription>
                      Search and select users to assign as reviewers for this assessment.
                    </SheetDescription>
                  </SheetHeader>

                  <div className="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
                    {/* Search Input */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or email (min 2 chars)..."
                        value={reviewerSearchQuery}
                        onChange={(e) => handleReviewerSearchChange(e.target.value)}
                        className="pl-10 h-10"
                      />
                    </div>

                    {/* Selected Reviewers Chips */}
                    {selectedReviewers.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedReviewers.map((r) => (
                          <Badge
                            key={r.userId}
                            variant="secondary"
                            className="flex items-center gap-1.5 py-1 px-3 bg-violet-100 text-violet-800 border-violet-300"
                          >
                            {r.name}
                            <button
                              onClick={() => toggleReviewerSelection(r)}
                              className="hover:bg-violet-200 rounded-full p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Search Results */}
                    <ScrollArea className="flex-1 -mx-4 px-4">
                      {searchingReviewers ? (
                        <div className="flex items-center justify-center py-8">
                          <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin" />
                          <span className="ml-2 text-sm text-muted-foreground">Searching...</span>
                        </div>
                      ) : reviewerSearchResults.length > 0 ? (
                        <div className="space-y-2">
                          {reviewerSearchResults.map((user) => {
                            const isSelected = selectedReviewers.some(r => r.userId === user.userId);
                            return (
                              <button
                                key={user.userId}
                                onClick={() => toggleReviewerSelection(user)}
                                className={cn(
                                  "w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all",
                                  isSelected
                                    ? "border-violet-400 bg-violet-50 dark:bg-violet-950"
                                    : "border-border hover:border-border hover:bg-muted"
                                )}
                              >
                                <div className={cn(
                                  "w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0",
                                  isSelected ? "bg-violet-500" : "bg-slate-400"
                                )}>
                                  {user.name?.charAt(0)?.toUpperCase() || "?"}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                                </div>
                                {isSelected && (
                                  <CheckCircle2 className="w-5 h-5 text-violet-600 dark:text-violet-400 flex-shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : reviewerSearchQuery.length >= 2 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                          <Search className="w-8 h-8 opacity-20 mb-2" />
                          <p className="text-sm">No users found</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                          <Search className="w-8 h-8 opacity-20 mb-2" />
                          <p className="text-sm">Type at least 2 characters to search</p>
                        </div>
                      )}
                    </ScrollArea>
                  </div>

                  {/* Assign Button */}
                  <div className="p-4 border-t bg-muted">
                    <Button
                      onClick={assignReviewers}
                      disabled={selectedReviewers.length === 0 || assigningReviewers}
                      className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11"
                    >
                      {assigningReviewers ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Assigning...
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4 mr-2" />
                          Assign {selectedReviewers.length > 0 ? `${selectedReviewers.length} Reviewer(s)` : "Reviewers"}
                        </>
                      )}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Q&A TAB */}
              {activeTab === "qa" && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  {showSaveSuccess && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 flex items-center gap-3"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <p className="text-sm font-medium text-emerald-800">Answers saved successfully</p>
                    </motion.div>
                  )}
                  
                  {(() => {
                    const selectedImg = byImageData?.images[imageNavSelection];
                    const selectedImageId = selectedImg?.image_id;
                    const filteredQuestions = selectedImageId
                      ? clarificationQuestions.map((item, idx) => ({ item, globalIdx: idx })).filter(({ item }) => item.image_id === selectedImageId)
                      : clarificationQuestions.map((item, idx) => ({ item, globalIdx: idx }));
                    const answeredCount = filteredQuestions.filter(({ item }) => item.answer).length;
                    const totalCount = filteredQuestions.length;

                    return (
                      <>
                        {/* Q&A Section Header */}
                        <div className="flex items-center gap-3 mb-5">
                          <div className="p-2.5 bg-amber-50 dark:bg-amber-950 rounded-xl">
                            <HelpCircle size={20} className="text-amber-600 dark:text-amber-400" />
                          </div>
                          <div>
                            <h2 className="text-lg font-bold text-foreground">Security Verification Checklist</h2>
                            <p className="text-xs text-muted-foreground">
                              {totalCount - answeredCount} of {totalCount} questions remaining
                            </p>
                          </div>
                        </div>

                        {totalCount > 0 && (
                          <div className="mb-6">
                            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="bg-indigo-500 h-full rounded-full transition-all duration-500" 
                                style={{
                                  width: `${totalCount > 0 ? (answeredCount / totalCount) * 100 : 0}%`
                                }}
                              />
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">
                              {answeredCount}/{totalCount} completed
                            </p>
                          </div>
                        )}
                        
                        {totalCount > 0 ? (
                          <div className="space-y-6">
                            {filteredQuestions.map(({ item, globalIdx: idx }, displayIdx) => {
                              const isEditing = editingAnswers[idx] !== undefined;
                              const currentAnswer = isEditing ? editingAnswers[idx] : item.answer;
                              const hasAnswer = currentAnswer && currentAnswer.trim() !== "";

                              return (
                                <motion.div
                                  key={idx}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: 0.05 * displayIdx }}
                                  className={cn(
                                    "bg-card border-2 rounded-2xl transition-all shadow-sm",
                                    hasAnswer ? "border-emerald-200 dark:border-emerald-800 shadow-emerald-50" : "border-border",
                                    isEditing ? "border-indigo-300 shadow-md" : ""
                                  )}
                                >
                                  <div className="p-5 sm:p-6">
                                    <div className="flex gap-4">
                                      <div
                                        className={cn(
                                          "shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold transition-colors",
                                          hasAnswer ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                                        )}
                                      >
                                        {hasAnswer ? <Check size={15} /> : displayIdx + 1}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-foreground text-sm mb-3">{item.question}</p>

                                        {isEditing ? (
                                          <div className="space-y-3">
                                            <textarea
                                              value={editingAnswers[idx]}
                                              onChange={(e) => setEditingAnswers({...editingAnswers, [idx]: e.target.value})}
                                              placeholder="Type your answer here..."
                                              className="w-full bg-muted border border-border rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 outline-none min-h-[90px] transition-all resize-none"
                                            />
                                            <div className="flex items-center gap-2 justify-end">
                                              {savingAnswers && (
                                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                                  <Loader2 size={11} className="animate-spin" /> Auto-saving…
                                                </span>
                                              )}
                                              <button 
                                                onClick={() => {
                                                  const newEditing = {...editingAnswers};
                                                  delete newEditing[idx];
                                                  setEditingAnswers(newEditing);
                                                }}
                                                className="px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          </div>
                                        ) : currentAnswer ? (
                                          <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase">Answered</span>
                                            </div>
                                            <p className="text-sm text-foreground leading-relaxed bg-emerald-50/50 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800">{currentAnswer}</p>
                                            <button
                                              onClick={() => setEditingAnswers({...editingAnswers, [idx]: item.answer})}
                                              className="text-xs font-medium text-muted-foreground hover:text-indigo-600 dark:text-indigo-400 transition-colors"
                                            >
                                              Edit
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => setEditingAnswers({...editingAnswers, [idx]: ""})}
                                            className="px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                                          >
                                            Add Answer
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            })}
                      
                            {Object.keys(editingAnswers).length > 0 && (
                              <motion.div
                                initial={{ opacity: 0, y: 30 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="sticky bottom-6 flex items-center justify-end gap-3"
                              >
                                {savingAnswers && (
                                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Auto-saving…
                                  </span>
                                )}
                                <button 
                                  onClick={() => handleSaveAnswers(false)} 
                                  disabled={savingAnswers}
                                  className="px-6 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-2xl shadow-emerald-200/50 flex items-center gap-2"
                                >
                                  {savingAnswers ? (
                                    <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                                  ) : (
                                    <><CheckCircle2 className="w-4 h-4" /> Save All Answers</>
                                  )}
                                </button>
                              </motion.div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-12 text-muted-foreground gap-2 h-64 border-2 border-dashed border-border rounded-2xl bg-card">
                            <HelpCircle className="h-10 w-10 opacity-20" />
                            <p className="font-medium text-muted-foreground">No questions for this image.</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </motion.div>
              )}
            </>
          )}

        </main>

      {/* --- Floating Bottom Approve / Reject Bar --- */}
      {assignedReviewers.length > 0 && assessmentState !== "APPROVED" && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-slate-300/30 p-2 px-3">
            {/* Approve panel — expanded inline */}
            {showApprovePanel ? (
              <div className="flex items-start gap-3 p-2">
                <textarea
                  value={approveComment}
                  onChange={(e) => setApproveComment(e.target.value)}
                  placeholder="Add an optional approval comment..."
                  className="flex-1 h-14 p-3 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 resize-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    onClick={() => setShowApprovePanel(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    onClick={approveAssessment}
                    disabled={approvingAssessment}
                  >
                    {approvingAssessment ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Approving...</>
                    ) : (
                      <><CheckCircle2 className="w-3.5 h-3.5" /> Confirm Approval</>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  className="text-xs font-medium text-rose-500 hover:text-rose-800 hover:bg-rose-50 dark:bg-rose-950 flex items-center gap-1.5 px-3 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                  disabled={submittingReview}
                  onClick={() => submitReview("REJECTED")}
                >
                  {submittingReview ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ThumbsDown className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">Request Changes</span>
                </button>
                <div className="h-6 w-px bg-muted" />
                <button
                  className="bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-sm"
                  onClick={() => setShowApprovePanel(true)}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Approve
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
