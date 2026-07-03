"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react"
import { AlertTriangle, Loader2, Maximize2, Move, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { renderMermaidSvg } from "@/lib/mermaid"
import { cn } from "@/lib/utils"

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const ZOOM_STEP = 1.2

type Transform = { x: number; y: number; scale: number }

export type MermaidRenderStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok" }
  | { state: "error"; message: string; line?: number }

/**
 * Best-effort extraction of a 1-based source line number from a Mermaid
 * parser error message. Mermaid surfaces both `Parse error on line N` and
 * `Error on line N` forms; we fall back to the first standalone integer in
 * the message if neither matches.
 */
function extractMermaidErrorLine(message: string): number | undefined {
  const labelled = /(?:on\s+line|line)\s+(\d+)/i.exec(message)
  if (labelled) {
    const n = Number(labelled[1])
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

/**
 * A pan/zoom Mermaid canvas modelled after https://mermaid.live — drag to
 * pan, wheel (or pinch) to zoom around the cursor, plus a toolbar with
 * +/−/fit/reset controls and a live zoom indicator.
 */
export function MermaidCanvas({
  chart,
  className,
  onStatusChange,
}: {
  chart: string
  className?: string
  /**
   * Notified on every render attempt so parent panels (e.g. the editor
   * sidebar) can surface a parse error with line info next to the source.
   */
  onStatusChange?: (status: MermaidRenderStatus) => void
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: Transform
  } | null>(null)

  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<{ message: string; line?: number } | null>(null)
  const [renderLoading, setRenderLoading] = useState(false)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)

  // Keep the callback in a ref so we don't have to thread it through every
  // effect dep array (which would cause spurious re-renders).
  const statusCbRef = useRef(onStatusChange)
  useEffect(() => { statusCbRef.current = onStatusChange }, [onStatusChange])

  // Render the Mermaid source into an SVG string. We render off-DOM so we
  // can inject it via dangerouslySetInnerHTML on the transformed layer.
  useEffect(() => {
    let cancelled = false
    if (!chart) {
      setSvg("")
      setError(null)
      statusCbRef.current?.({ state: "idle" })
      return
    }
    setRenderLoading(true)
    statusCbRef.current?.({ state: "loading" })
    renderMermaidSvg(chart)
      .then((out) => {
        if (cancelled) return
        setSvg(out)
        setError(null)
        statusCbRef.current?.({ state: "ok" })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Unknown Mermaid rendering error"
        const line = extractMermaidErrorLine(message)
        // Keep the previous SVG visible while the user edits — flipping it
        // to a blank canvas on every keystroke is jarring. The error chip
        // below makes the broken state obvious.
        setError({ message, line })
        statusCbRef.current?.({ state: "error", message, line })
      })
      .finally(() => {
        if (!cancelled) setRenderLoading(false)
      })
    return () => { cancelled = true }
  }, [chart])

  // Fit the diagram to the viewport — sizes the SVG so it fills the
  // visible canvas with a bit of padding, then centres it.
  const fitToScreen = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    // The injected SVG sits inside `contentRef`. Use its untransformed
    // bounding box (scale = 1) to compute the right fit factor.
    const svgEl = content.querySelector("svg") as SVGSVGElement | null
    if (!svgEl) return

    // Ensure the SVG can be measured even if Mermaid set width/height.
    svgEl.removeAttribute("width")
    svgEl.removeAttribute("height")
    svgEl.style.maxWidth = "none"
    svgEl.style.width = "auto"
    svgEl.style.height = "auto"

    const vpRect = viewport.getBoundingClientRect()
    const contentRect = svgEl.getBoundingClientRect()
    // Adjust the measured size back to scale = 1 so the fit math is correct.
    const naturalW = contentRect.width / transform.scale
    const naturalH = contentRect.height / transform.scale
    if (naturalW === 0 || naturalH === 0) return

    const padding = 32
    const scale = Math.min(
      (vpRect.width - padding * 2) / naturalW,
      (vpRect.height - padding * 2) / naturalH,
      MAX_ZOOM,
    )
    const clamped = Math.max(MIN_ZOOM, scale)
    const nextX = (vpRect.width - naturalW * clamped) / 2
    const nextY = (vpRect.height - naturalH * clamped) / 2
    setTransform({ x: nextX, y: nextY, scale: clamped })
  }, [transform.scale])

  // Re-fit whenever the SVG itself changes so a new diagram lands centred.
  useLayoutEffect(() => {
    if (!svg) return
    // Defer one frame so the SVG is in the DOM and measurable.
    const raf = requestAnimationFrame(fitToScreen)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg])

  // Re-fit on container resize so the diagram tracks layout changes.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      // Only re-fit when the user is at default-ish zoom; otherwise the
      // resize would yank them away from a deliberate pan/zoom.
      if (Math.abs(transform.scale - 1) < 0.001) fitToScreen()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [fitToScreen, transform.scale])

  // --- Zoom helpers ---
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const viewport = viewportRef.current
      if (!viewport) return
      const rect = viewport.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      setTransform((prev) => {
        const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * factor))
        if (nextScale === prev.scale) return prev
        // Anchor the zoom so the point under the cursor stays in place.
        const ratio = nextScale / prev.scale
        const nextX = px - (px - prev.x) * ratio
        const nextY = py - (py - prev.y) * ratio
        return { x: nextX, y: nextY, scale: nextScale }
      })
    },
    [],
  )

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    // We always intercept wheel: pinch (ctrlKey) zooms faster, regular
    // wheel zooms at the standard step. Holding shift gives a finer
    // adjustment for precision.
    event.preventDefault()
    const factor = event.deltaY < 0
      ? (event.shiftKey ? 1.05 : event.ctrlKey ? ZOOM_STEP ** 1.6 : ZOOM_STEP)
      : (event.shiftKey ? 1 / 1.05 : event.ctrlKey ? 1 / ZOOM_STEP ** 1.6 : 1 / ZOOM_STEP)
    zoomAt(event.clientX, event.clientY, factor)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only left-button drag pans; ignore right-click / middle-click so the
    // browser context menu still works.
    if (event.button !== 0) return
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: transform,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsPanning(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    setTransform({ x: state.origin.x + dx, y: state.origin.y + dy, scale: state.origin.scale })
  }

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    panStateRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    setIsPanning(false)
  }

  // --- Toolbar actions ---
  const handleZoomIn = () => {
    const vp = viewportRef.current
    if (!vp) return
    const rect = vp.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ZOOM_STEP)
  }

  const handleZoomOut = () => {
    const vp = viewportRef.current
    if (!vp) return
    const rect = vp.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / ZOOM_STEP)
  }

  const handleResetZoom = () => setTransform({ x: 0, y: 0, scale: 1 })

  // --- Render ---
  // Note: we deliberately keep the previous (valid) SVG visible while
  // `error` is set so the canvas doesn't blink during live-editing. The
  // floating error chip below makes the broken parse state obvious without
  // wiping the user's last good preview.

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] bg-size-[20px_20px]", className)}>
      <div
        ref={viewportRef}
        className={cn(
          "absolute inset-0 select-none touch-none",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={endPan}
      >
        <div
          ref={contentRef}
          className="mermaid-svg-surface origin-top-left will-change-transform"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transition: panStateRef.current ? "none" : "transform 80ms ease-out",
          }}
          // The Mermaid SVG is injected as raw HTML — it's produced by our
          // own renderMermaidSvg helper, so the input is trusted.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {renderLoading && !svg && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/40 text-sm text-muted-foreground backdrop-blur-xs">
          <Loader2 className="size-4 animate-spin" />
          Rendering diagram…
        </div>
      )}

      {/* --- Toolbar --- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
        <div className="pointer-events-auto inline-flex items-center gap-0.5 rounded-full border bg-background/95 px-1.5 py-1 shadow-md backdrop-blur supports-backdrop-filter:bg-background/80">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={handleZoomOut}
            disabled={transform.scale <= MIN_ZOOM + 1e-3}
            className="size-7 rounded-full"
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="min-w-14 rounded-full px-2 py-0.5 text-center text-[11px] font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Reset zoom to 100%"
          >
            {Math.round(transform.scale * 100)}%
          </button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={handleZoomIn}
            disabled={transform.scale >= MAX_ZOOM - 1e-3}
            className="size-7 rounded-full"
            title="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={fitToScreen}
            className="size-7 rounded-full"
            title="Fit to screen"
          >
            <Maximize2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={handleResetZoom}
            className="size-7 rounded-full"
            title="Reset view"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Hint chip */}
      <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground shadow-xs backdrop-blur-xs">
        <Move className="size-3" />
        Drag to pan · Scroll to zoom
      </div>

      {/* Empty state: no chart yet AND no previous SVG */}
      {!chart && !svg && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Paste Mermaid JS to preview the diagram.
        </div>
      )}

      {/* Error chip — overlays the canvas without wiping the last good SVG */}
      {error && (
        <div className="pointer-events-auto absolute right-3 top-3 max-w-sm rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] shadow-md backdrop-blur-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold text-destructive">
                Parse error{typeof error.line === "number" ? ` on line ${error.line}` : ""}
              </p>
              <p className="wrap-break-word text-destructive/80 line-clamp-3">{error.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MermaidCanvas
