import type { NextConfig } from "next";

// Keep this in sync with blancUi/lib/api-client.ts — the CSP needs to
// allow-list whatever host the fetch actually targets, and the default
// there is 127.0.0.1:8000 when the env var is unset.
const DEV_API_HOSTS = ["http://127.0.0.1:8000", "http://localhost:8000"];
const configuredApi = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();

const connectSources = ["'self'", ...DEV_API_HOSTS];
if (configuredApi && !connectSources.includes(configuredApi)) {
  connectSources.push(configuredApi);
}

// CSP note: shadcn / Tailwind rely on inline styles for CSS variables,
// and Mermaid + framer-motion inject inline styles at runtime, so
// `style-src` must include `unsafe-inline`. If you migrate to nonces,
// pair this with a middleware that mints per-request nonces.
//
// React dev-mode needs `unsafe-eval` to reconstruct component stacks
// and source-map errors. That is intentionally OFF in production —
// React never calls eval() in prod builds.
const isDev = process.env.NODE_ENV !== "production";
const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const cspDirectives = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSources.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspDirectives },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  // `typescript.ignoreBuildErrors: true` was removed — shipping type-broken
  // code silences real bugs. Fix errors before build; don't hide them.

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
