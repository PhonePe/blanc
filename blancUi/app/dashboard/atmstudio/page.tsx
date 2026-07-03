"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Eraser,
  FileJson,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AssessmentForm } from "@/components/AssessmentForm";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { api } from "@/lib/api-client";
import { ThreatModelInventory } from "@/components/threat-model-inventory";
import { CodeEditor, type CodeEditorHandle } from "@/components/CodeEditor";
import type { MermaidRenderStatus } from "@/components/MermaidCanvas";

// Pan/zoom canvas modelled after mermaid.live — local rendering only.
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
);

const sampleMermaid = `flowchart LR
    subgraph External ["External / On-Premise Networks"]
        direction TB
        Internet["Internet"]
        WAF["WAF / CDN"]
        Office["Corporate Office Network"]
        subgraph Data_Centers ["On-Premise Data Centers"]
            DC1["Data Center 1"]
            DC2["Data Center 2"]
        end
    end

    subgraph Primary_Region ["Primary Cloud Region"]
        direction TB
        subgraph Hub ["Hub VNET"]
            HubFW["Hub Firewall"]
            ExpressRouteGW["ExpressRoute Gateway"]
            VPNGW["VPN Gateway"]
            NATGW["NAT Gateway"]
        end
        subgraph Spoke_Prod ["Production Spoke VNET"]
            ExtNginx["external-nginx"]
            DmzNginx["dmz-nginx"]
            DmzProxy["dmz-app-proxy"]
            AppServer1["app-server-1"]
            AppServer2["app-server-2"]
        end
    end

    Internet --> WAF
    WAF --> NATGW
    Office -- "Site-to-Site Link" --> ExpressRouteGW
    DC1 & DC2 -- "ExpressRoute" --> ExpressRouteGW
    ExpressRouteGW --> HubFW
    VPNGW --> HubFW
    HubFW <--> |"VNET Peering"| Spoke_Prod
    ExtNginx --> DmzNginx
    DmzNginx --> DmzProxy
    DmzProxy --> AppServer1 & AppServer2`;

type AssessmentImage = {
  image_id: string;
  flow_diagram?: { mermaid?: string } | null;
};

type LoadedAssessment = {
  id: string;
  images: AssessmentImage[];
};

export default function ATMStudioPage() {
  const router = useRouter();
  const [createFormOpen, setCreateFormOpen] = useState(false);

  const [mermaidSource, setMermaidSource] = useState(sampleMermaid);
  const [renderedMermaid, setRenderedMermaid] = useState(sampleMermaid);
  const [activeTab, setActiveTab] = useState<"diagram" | "inventory">("diagram");
  const [loaded, setLoaded] = useState<LoadedAssessment | null>(null);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);

  // Canvas render status (loading/ok/error + parse-error line) so the
  // editor sidebar can surface an inline banner that jumps to the line.
  const [renderStatus, setRenderStatus] = useState<MermaidRenderStatus>({ state: "idle" });
  const editorRef = useRef<CodeEditorHandle | null>(null);

  // The active image drives BOTH the rendered Mermaid and the
  // ThreatModelInventory's surface-map persistence target.
  const activeImage = useMemo(() => {
    if (!loaded || !activeImageId) return null;
    return loaded.images.find((img) => img.image_id === activeImageId) ?? null;
  }, [loaded, activeImageId]);

  const statusLabel = useMemo(() => {
    if (loaded) {
      return `Assessment ${loaded.id} · ${loaded.images.length} image${
        loaded.images.length === 1 ? "" : "s"
      }`;
    }
    return "Sandbox mode";
  }, [loaded]);

  // --- Live render: as the user types, push the source onto the canvas
  // after a short debounce so we don't re-run mermaid.parse on every
  // keystroke. The explicit "Render" button below still works for an
  // immediate re-render.
  useEffect(() => {
    if (!mermaidSource) return;
    if (renderedMermaid === mermaidSource) return;
    const handle = setTimeout(() => {
      setRenderedMermaid(mermaidSource);
    }, 400);
    return () => clearTimeout(handle);
  }, [mermaidSource, renderedMermaid]);

  const renderDiagram = useCallback(() => {
    const source = mermaidSource.trim();
    if (!source) {
      toast.error("Paste Mermaid JS before rendering.");
      return;
    }
    setRenderedMermaid(source);
    setActiveTab("diagram");
  }, [mermaidSource]);

  const clearStudio = useCallback(() => {
    setMermaidSource("");
    setRenderedMermaid("");
    setLoaded(null);
    setActiveImageId(null);
  }, []);

  // Switching to a different image swaps the rendered diagram so the canvas
  // and the inventory stay in sync.
  const handleImageChange = useCallback(
    (imageId: string) => {
      if (!loaded) return;
      const next = loaded.images.find((img) => img.image_id === imageId);
      if (!next) return;
      setActiveImageId(imageId);
      const mermaid = next.flow_diagram?.mermaid?.trim();
      if (mermaid) {
        setMermaidSource(mermaid);
        setRenderedMermaid(mermaid);
      }
    },
    [loaded],
  );

  // Auto-render the sample diagram on first mount so the panel isn't blank.
  useEffect(() => {
    setRenderedMermaid((current) => current || sampleMermaid);
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="flex h-[calc(100vh-var(--header-height))] min-h-[640px] flex-col bg-background">
        {/* --- Header --- */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card/60 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-card/40 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-slate-900 via-slate-800 to-slate-700 text-white shadow-lg shadow-slate-900/20 ring-1 ring-inset ring-white/10">
              <WandSparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold leading-tight tracking-tight">
                ATM Studio
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1.5 border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-300">
                  <Sparkles className="size-3" /> Mermaid Renderer
                </Badge>
                <Badge variant="outline">{statusLabel}</Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Button
              size="sm"
              className="bg-black text-white shadow-sm hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
              onClick={() => {
                const src = (mermaidSource || "").trim();
                if (!src) {
                  toast.error("Write or paste a Mermaid diagram before creating an assessment.");
                  return;
                }
                setCreateFormOpen(true);
              }}
            >
              <ShieldAlert className="size-4" />
              Create Assessment
            </Button>

            {loaded && loaded.images.length > 1 && (
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-muted-foreground">Image</Label>
                <Select
                  value={activeImageId ?? undefined}
                  onValueChange={handleImageChange}
                >
                  <SelectTrigger size="sm" className="h-8 w-48 text-xs">
                    <SelectValue placeholder="Pick an image" />
                  </SelectTrigger>
                  <SelectContent>
                    {loaded.images.map((img, idx) => (
                      <SelectItem key={img.image_id} value={img.image_id}>
                        Image {idx + 1} · {img.image_id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setMermaidSource(sampleMermaid)}
                  >
                    <RefreshCw className="size-4" />
                    <span className="sr-only">Load sample</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Load sample</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon-sm" onClick={clearStudio}>
                    <Eraser className="size-4" />
                    <span className="sr-only">Clear</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

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
                    <Badge variant="outline">{mermaidSource.length} chars</Badge>
                  </div>
                </div>

                <CodeEditor
                  ref={editorRef}
                  value={mermaidSource}
                  onChange={setMermaidSource}
                  errorLine={
                    renderStatus.state === "error" ? renderStatus.line : undefined
                  }
                  placeholder="Paste or edit Mermaid JS here"
                  className="min-h-80 lg:min-h-0"
                />

                {/* Live parse-error banner — jumps the editor to the offending line. */}
                {renderStatus.state === "error" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (renderStatus.line)
                        editorRef.current?.focusLine(renderStatus.line);
                    }}
                    className="group flex w-full items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left text-[11px] text-destructive transition-colors hover:bg-destructive/10"
                    title={
                      renderStatus.line
                        ? `Jump to line ${renderStatus.line}`
                        : "Mermaid parse error"
                    }
                  >
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-semibold">
                        Parse error
                        {typeof renderStatus.line === "number"
                          ? ` on line ${renderStatus.line}`
                          : ""}
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

                <Button
                  onClick={renderDiagram}
                  disabled={!mermaidSource.trim()}
                  className="w-full"
                >
                  <WandSparkles className="size-4" />
                  Render Diagram
                </Button>
              </div>
            </aside>
          )}

          {/* Right: Diagram canvas + Inventory tabs */}
          <section className="min-h-0 bg-muted/20 p-3">
            <Tabs
              value={activeTab}
              onValueChange={(value) =>
                setActiveTab(value as "diagram" | "inventory")
              }
              className="flex h-full min-h-0 flex-col gap-3"
            >
              <TabsList className="self-start">
                <TabsTrigger value="diagram">Diagram</TabsTrigger>
                <TabsTrigger value="inventory">
                  ThreatModeller Inventory
                  {loaded && (
                    <Badge
                      variant="secondary"
                      className="ml-2 h-5 px-1.5 text-[10px]"
                    >
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
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-muted-foreground">
                    Paste Mermaid JS on the left and click Render Diagram.
                  </div>
                )}
              </TabsContent>

              <TabsContent
                value="inventory"
                className="min-h-0 flex-1 overflow-auto"
              >
                <ThreatModelInventory
                  code={renderedMermaid}
                  // Local-only persistence key keeps inventories from leaking
                  // across assessment IDs in sandbox mode.
                  persistKey={
                    loaded && activeImage
                      ? `atmstudio:${loaded.id}:${activeImage.image_id}`
                      : "atmstudio:sandbox"
                  }
                  assessmentId={loaded?.id}
                  imageId={activeImage?.image_id}
                />
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </main>

      {/* Create-assessment dialog — the AssessmentForm renders in mermaid
          mode, hides its image-upload step, and posts mermaid_texts[] to
          the backend. Its onSubmitted callback closes the dialog and
          navigates to the freshly created assessment. */}
      <Dialog open={createFormOpen} onOpenChange={setCreateFormOpen}>
        {/* Force flex-column so the scrollable form region can grow into
            the remaining space. shadcn's DialogContent defaults to
            `grid`, which breaks bounded overflow — override it here. */}
        <DialogContent className="sm:max-w-5xl w-[95vw] h-[92vh] max-h-[92vh] gap-0 p-0 overflow-hidden flex flex-col">
          {/* Hero band — mirrors /dashboard/assessment/new's headline
              vocabulary so the two entry points feel like one flow. */}
          <DialogHeader className="shrink-0 border-b border-border/60 px-8 pt-8 pb-6 text-left">
            <span className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              <span className="size-1 rounded-full bg-foreground" />
              New assessment
            </span>
            <DialogTitle className="text-balance text-2xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-[28px]">
              Start a new threat assessment
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Share your application context. The Mermaid diagram you just
              wrote is sent as-is — no image upload, no vision LLM step.
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable form region. `min-h-0` is the crucial bit — without
              it, flex children default to `min-height: auto` and refuse
              to shrink below their content size, so `overflow-y-auto`
              never triggers. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-6 sm:px-6">
            <AssessmentForm
              mermaidTexts={[mermaidSource]}
              onSubmitted={(assessmentId) => {
                setCreateFormOpen(false);
                router.push(`/dashboard/assessment/${assessmentId}`);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
