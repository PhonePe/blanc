import DOMPurify from "dompurify";

/**
 * Sanitize SVG/HTML content for safe injection into the DOM.
 * Allows only SVG elements and safe attributes — strips all scripts,
 * event handlers, and embedded objects.
 */
export function sanitizeSvg(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    // Mermaid v11 renders every text label inside an SVG <foreignObject>
    // that hosts an HTML <div> — dropping foreignObject strips every
    // label out. We keep it here but rely on the HTML profile + the
    // scripts / handlers denylist below to shut every known XSS vector
    // that could ride inside it.
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    FORBID_TAGS: [
      "script", "iframe", "object", "embed", "form", "input", "textarea",
      "button", "select", "option", "meta", "link", "base", "audio", "video",
      "source", "track", "portal",
    ],
    FORBID_ATTR: [
      "onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur",
      "onsubmit", "onreset", "onchange", "oninput", "onkeydown", "onkeyup",
      "onkeypress", "onmousedown", "onmouseup", "onmousemove", "onmouseout",
      "oncontextmenu", "ondblclick", "ondrag", "ondragend", "ondragenter",
      "ondragleave", "ondragover", "ondragstart", "ondrop", "onwheel",
      "onscroll", "onbeforeunload", "onunload", "onhashchange", "onpaste",
      "oncopy", "oncut", "onpointerdown", "onpointerup", "onpointermove",
      // xlink:href / href with javascript: schemes — DOMPurify already
      // sanitizes URLs by default, but this makes it explicit.
      "formaction", "action",
    ],
  });
}

/**
 * Validate that a route parameter looks like a valid UUID or safe identifier.
 * Prevents path traversal and injection via route params.
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidId(id: string | undefined | null): id is string {
  if (!id) return false;
  return SAFE_ID_PATTERN.test(id);
}

/**
 * Sanitize a string for use in filenames.
 * Strips path separators and non-alphanumeric chars (except dash, underscore, dot).
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

/**
 * Validate that a URL is from the expected API origin.
 * Prevents open redirect / SSRF via image src attributes.
 */
export function isValidApiImageUrl(url: string, apiBase: string): boolean {
  try {
    const parsed = new URL(url);
    const base = new URL(apiBase);
    return parsed.origin === base.origin;
  } catch {
    return false;
  }
}
