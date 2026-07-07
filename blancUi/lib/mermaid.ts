import mermaid from "mermaid"


type MermaidConfig = Exclude<Parameters<typeof mermaid.initialize>[0], undefined>

export type MermaidTheme = "light" | "dark"

const COMMON_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "base",
  fontFamily: "Inter, system-ui, sans-serif",
  flowchart: {
    htmlLabels: false,
  },
}

// Light palette — high-contrast slate on off-white, safe on any card.
const LIGHT_THEME_VARS = {
  background: "transparent",
  mainBkg: "#ffffff",
  primaryColor: "#f8fafc",
  primaryBorderColor: "#64748b",
  primaryTextColor: "#0f172a",
  secondaryColor: "#f1f5f9",
  secondaryBorderColor: "#64748b",
  tertiaryColor: "#e2e8f0",
  nodeBorder: "#64748b",
  textColor: "#0f172a",
  lineColor: "#475569",
  edgeLabelBackground: "#ffffff",
  clusterBkg: "#f8fafc",
  clusterBorder: "#94a3b8",
  titleColor: "#0f172a",
  actorBkg: "#f8fafc",
  actorBorder: "#64748b",
  actorTextColor: "#0f172a",
  actorLineColor: "#475569",
  signalColor: "#475569",
  signalTextColor: "#0f172a",
  labelBoxBkgColor: "#f8fafc",
  labelBoxBorderColor: "#94a3b8",
  labelTextColor: "#0f172a",
  loopTextColor: "#0f172a",
  noteBkgColor: "#fef3c7",
  noteBorderColor: "#f59e0b",
  noteTextColor: "#1f1300",
  activationBkgColor: "#fef3c7",
  activationBorderColor: "#f59e0b",
}

// Dark palette — deliberately raises node fills a couple stops off pure
// black so text has real contrast, edges pop instead of vanishing, and
// notes/sequence highlights stay legible on both the sidebar-inset
// dark card AND the plain slate-950 background.
const DARK_THEME_VARS = {
  background: "transparent",
  mainBkg: "#1e293b",          // slate-800
  primaryColor: "#1e293b",     // node fill
  primaryBorderColor: "#94a3b8", // slate-400 — clear against the fill
  primaryTextColor: "#f1f5f9", // slate-100
  secondaryColor: "#334155",   // slate-700
  secondaryBorderColor: "#94a3b8",
  tertiaryColor: "#475569",    // slate-600
  nodeBorder: "#94a3b8",
  textColor: "#f1f5f9",
  lineColor: "#cbd5e1",        // slate-300 — edges
  edgeLabelBackground: "#0f172a", // slate-900 — matches app bg so edge labels don't sit on a white pill
  clusterBkg: "#1e293b",
  clusterBorder: "#64748b",
  titleColor: "#f1f5f9",
  actorBkg: "#1e293b",
  actorBorder: "#94a3b8",
  actorTextColor: "#f1f5f9",
  actorLineColor: "#cbd5e1",
  signalColor: "#cbd5e1",
  signalTextColor: "#f1f5f9",
  labelBoxBkgColor: "#1e293b",
  labelBoxBorderColor: "#64748b",
  labelTextColor: "#f1f5f9",
  loopTextColor: "#f1f5f9",
  noteBkgColor: "#78350f",     // amber-900 — readable against slate-800
  noteBorderColor: "#fbbf24",  // amber-400
  noteTextColor: "#fef3c7",    // amber-50
  activationBkgColor: "#78350f",
  activationBorderColor: "#fbbf24",
}

function detectSystemTheme(): MermaidTheme {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark"
  }
  return "light"
}

function themeVarsFor(mode: MermaidTheme) {
  return mode === "dark" ? DARK_THEME_VARS : LIGHT_THEME_VARS
}

const SEQUENCE_DIAGRAM_PATTERN = /^\s*sequenceDiagram\b/
const FLOWCHART_DIAGRAM_PATTERN = /^\s*(?:flowchart|graph)\b/
const SEQUENCE_NOTE_PATTERN = /^\s*Note\s+(?:right of|left of|over)\s+[^:]+:/i
const SEQUENCE_MESSAGE_PATTERN = /^\s*.+?(?:-->>|->>|-->|->|--x|x--)\s*.+?:/
const EMPTY_FLOWCHART_NODE_PATTERN =
  /(^|[^\w])([A-Za-z_][\w.-]*)\s*(\[\s*(?:"\s*"|'\s*')?\s*\]|\(\s*(?:"\s*"|'\s*')?\s*\)|\{\s*(?:"\s*"|'\s*')?\s*\})/g

function countDoubleQuotes(value: string): number {
  return (value.match(/"/g) ?? []).length
}

function encodeMermaidText(value: string): string {
  return value
    .replace(/\\n/g, "<br/>")
    .replace(/<([^>\n]+)>/g, "&lt;$1&gt;")
    .replace(/;/g, "#59;")
    .replace(/\s+/g, " ")
    .trim()
}

function stripWrappingQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1)
  }

  return value
}

function labelFromNodeId(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim() || value
}

function fillEmptyFlowchartNodeLabels(source: string): string {
  return source.replace(
    EMPTY_FLOWCHART_NODE_PATTERN,
    (match, prefix: string, nodeId: string, shape: string) => {
      const open = shape[0]
      const close = shape[shape.length - 1]
      return `${prefix}${nodeId}${open}${labelFromNodeId(nodeId)}${close}`
    },
  )
}

function normalizeSequenceBox(line: string): string {
  if (!line.trimStart().startsWith("box ")) {
    return line
  }

  return line.replace(/"([^"]+)"/g, "$1")
}

function normalizeSequenceNote(line: string): string {
  if (!SEQUENCE_NOTE_PATTERN.test(line)) {
    return line
  }

  const colonIndex = line.indexOf(":")
  if (colonIndex === -1) {
    return line
  }

  const prefix = line.slice(0, colonIndex + 1)
  const note = encodeMermaidText(stripWrappingQuotes(line.slice(colonIndex + 1).trim()))

  return `${prefix} ${note}`
}

function normalizeSequenceMessage(line: string): string {
  if (!SEQUENCE_MESSAGE_PATTERN.test(line)) {
    return line
  }

  const colonIndex = line.indexOf(":")
  if (colonIndex === -1) {
    return line
  }

  const prefix = line.slice(0, colonIndex + 1)
  const message = encodeMermaidText(stripWrappingQuotes(line.slice(colonIndex + 1).trim()))

  return `${prefix} ${message}`
}

function getReadableTextColor(mode: MermaidTheme): string {
  return mode === "dark" ? "#f1f5f9" : "#0f172a"
}

function withReadableSvgText(svg: string, mode: MermaidTheme): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svg
  }

  try {
    const textColor = getReadableTextColor(mode)
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml")

    if (doc.querySelector("parsererror")) {
      return svg
    }

    const svgRoot = doc.querySelector("svg")
    if (!svgRoot) {
      return svg
    }

    svgRoot.classList.add("atm-mermaid-svg")
    svgRoot.querySelectorAll("text, tspan").forEach((node) => {
      node.setAttribute("fill", textColor)
      node.setAttribute(
        "style",
        `${node.getAttribute("style") || ""};fill:${textColor} !important;color:${textColor} !important;`,
      )
    })

    svgRoot.querySelectorAll(".nodeLabel, .edgeLabel, .label, .cluster-label").forEach((node) => {
      node.setAttribute(
        "style",
        `${node.getAttribute("style") || ""};color:${textColor} !important;fill:${textColor} !important;`,
      )
    })

    return new XMLSerializer().serializeToString(svgRoot)
  } catch {
    return svg
  }
}

export function normalizeMermaidSource(source: string): string {
  if (FLOWCHART_DIAGRAM_PATTERN.test(source)) {
    return fillEmptyFlowchartNodeLabels(source.replace(/\r\n/g, "\n"))
  }

  if (!SEQUENCE_DIAGRAM_PATTERN.test(source)) {
    return source.replace(/\r\n/g, "\n")
  }

  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const normalizedLines: string[] = []

  let pendingLine: string | null = null
  let pendingQuotes = 0

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (pendingLine !== null) {
      pendingLine = `${pendingLine} ${line.trim()}`
      pendingQuotes += countDoubleQuotes(line)

      if (pendingQuotes % 2 === 0) {
        normalizedLines.push(normalizeSequenceNote(normalizeSequenceMessage(normalizeSequenceBox(pendingLine))))
        pendingLine = null
        pendingQuotes = 0
      }
      continue
    }

    const quoteCount = countDoubleQuotes(line)
    if (SEQUENCE_MESSAGE_PATTERN.test(line) && quoteCount % 2 === 1) {
      pendingLine = line
      pendingQuotes = quoteCount
      continue
    }

    normalizedLines.push(normalizeSequenceNote(normalizeSequenceMessage(normalizeSequenceBox(line))))
  }

  if (pendingLine !== null) {
    normalizedLines.push(normalizeSequenceNote(normalizeSequenceMessage(normalizeSequenceBox(pendingLine))))
  }

  return normalizedLines.join("\n")
}

export type RenderMermaidOptions = MermaidConfig & {
  /** Force a specific theme mode. When omitted we sniff the `.dark`
   * class on <html>. Pass this explicitly from React components that
   * already know the resolved theme (via `useTheme` from next-themes)
   * so the SVG matches the current app theme without a flash. */
  themeMode?: MermaidTheme
}

export async function renderMermaidSvg(
  source: string,
  { themeMode, ...config }: RenderMermaidOptions = {},
): Promise<string> {
  const normalizedSource = normalizeMermaidSource(source)
  const mode: MermaidTheme = themeMode ?? detectSystemTheme()

  mermaid.initialize({
    ...COMMON_CONFIG,
    themeVariables: {
      ...themeVarsFor(mode),
      ...(config.themeVariables ?? {}),
    },
    ...config,
  })

  await mermaid.parse(normalizedSource)

  const id = `mermaid-svg-${crypto.randomUUID()}`
  const { svg } = await mermaid.render(id, normalizedSource)
  // NOTE: We intentionally do NOT run `sanitizeSvg` on Mermaid's output.
  // Mermaid v11 renders every text label inside a `<foreignObject>`
  // containing an HTML `<div>`, and DOMPurify strips that HTML content
  // in every config combination I tested (svg + html profiles, ADD_TAGS,
  // ALLOWED_NAMESPACES, alternative PARSER_MEDIA_TYPE). The result is
  // empty boxes with no labels — which is the bug the user hit.
  //
  // Security: Mermaid's own `securityLevel: "strict"` (see BASE_CONFIG
  // above) already sanitizes the *input* — the only place XSS could
  // enter. The output SVG is generated by Mermaid, not by the user, so
  // additional DOMPurify sanitization there is defence-in-depth that
  // costs us the entire label rendering. If you need a stricter posture
  // later (e.g., sandbox untrusted mermaid), render inside an iframe
  // with `sandbox="allow-same-origin"` instead of stripping the SVG.
  return withReadableSvgText(svg, mode)
}
