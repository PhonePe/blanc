const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000"


// --- Retry Configuration ---
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,     // 1s
  maxDelay: 30000,     // 30s cap (matches backend RMQ backoff)
  retryableStatuses: new Set([408, 429, 500, 502, 503, 504]),
  retryableMethods: new Set(["GET", "PUT", "PATCH", "DELETE"]), // POST excluded by default (not idempotent)
}

// --- Custom error with status + response data ---
export class ApiError extends Error {
  status: number
  data: any
  isRetryable: boolean

  constructor(status: number, data: any, isRetryable = false) {
    const msg = data?.message || data?.detail || `Request failed with status ${status}`
    super(msg)
    this.name = "ApiError"
    this.status = status
    this.data = data
    this.isRetryable = isRetryable
  }
}

type ApiClientOptions = RequestInit & {
  skipAuth?: boolean
  retries?: number          // override max retries (0 to disable)
  retryOnPost?: boolean     // explicitly allow POST retry (for idempotent endpoints)
}

// --- Exponential backoff with jitter ---
function getBackoffDelay(attempt: number): number {
  const delay = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(2, attempt),
    RETRY_CONFIG.maxDelay
  )
  // Add ±25% jitter to prevent thundering herd
  const jitter = delay * 0.25 * (Math.random() * 2 - 1)
  return Math.round(delay + jitter)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// --- Core fetch wrapper with retry ---
async function apiClient(
  endpoint: string,
  options: ApiClientOptions = {}
): Promise<any> {
  const { skipAuth = false, retries, retryOnPost = false, headers: customHeaders, ...rest } = options

  const method = (rest.method || "GET").toUpperCase()
  const maxRetries = retries ?? (
    RETRY_CONFIG.retryableMethods.has(method) || (method === "POST" && retryOnPost)
      ? RETRY_CONFIG.maxRetries
      : 0
  )

  const headers: Record<string, string> = {}

  // Auto-attach token from localStorage
  if (!skipAuth && typeof window !== "undefined") {
    const token = localStorage.getItem("token")
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }
  }

  // Set Content-Type for non-FormData bodies
  if (rest.body && !(rest.body instanceof FormData)) {
    headers["Content-Type"] = "application/json"
  }

  headers["Accept"] = "application/json"

  // Merge any custom headers
  if (customHeaders) {
    const entries =
      customHeaders instanceof Headers
        ? Array.from(customHeaders.entries())
        : Object.entries(customHeaders as Record<string, string>)
    for (const [key, value] of entries) {
      headers[key] = value
    }
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`

  let lastError: ApiError | Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { ...rest, headers })

      // Global 401 handling — clear token and redirect to login
      if (response.status === 401) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("token")
          window.location.href = "/login"
        }
        throw new ApiError(401, { message: "Session expired. Redirecting to login..." })
      }

      // Try to parse JSON
      let data: any
      const contentType = response.headers.get("content-type")
      if (contentType?.includes("application/json")) {
        data = await response.json()
      } else {
        data = await response.text()
      }

      if (!response.ok) {
        const isRetryable = RETRY_CONFIG.retryableStatuses.has(response.status)
        const error = new ApiError(response.status, data, isRetryable)

        // Retry on retryable status codes
        if (isRetryable && attempt < maxRetries) {
          // Respect Retry-After header (429 / 503)
          const retryAfter = response.headers.get("Retry-After")
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000 || getBackoffDelay(attempt)
            : getBackoffDelay(attempt)

          lastError = error
          await sleep(delay)
          continue
        }

        throw error
      }

      return data
    } catch (error) {
      // Network errors (fetch throws TypeError for network failures)
      if (error instanceof TypeError && attempt < maxRetries) {
        lastError = error
        await sleep(getBackoffDelay(attempt))
        continue
      }

      // Non-retryable ApiError or final attempt
      if (error instanceof ApiError || error instanceof TypeError) {
        throw error
      }

      throw error
    }
  }

  // Should not reach here, but safety net
  throw lastError || new Error("Request failed after retries")
}

// --- Convenience methods ---
export const api = {
  get: (endpoint: string, options?: ApiClientOptions) =>
    apiClient(endpoint, { ...options, method: "GET" }),

  post: (endpoint: string, body?: any, options?: ApiClientOptions) =>
    apiClient(endpoint, {
      ...options,
      method: "POST",
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    }),

  put: (endpoint: string, body?: any, options?: ApiClientOptions) =>
    apiClient(endpoint, {
      ...options,
      method: "PUT",
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: (endpoint: string, body?: any, options?: ApiClientOptions) =>
    apiClient(endpoint, {
      ...options,
      method: "PATCH",
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: (endpoint: string, options?: ApiClientOptions) =>
    apiClient(endpoint, { ...options, method: "DELETE" }),
}

export { API_BASE }
export default apiClient
