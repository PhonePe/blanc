"use client"

/**
 * FailedModal — the single reusable modal every page shows when a
 * background pipeline (image analysis / threat generation / summary)
 * fails on the server.
 *
 * Surfaces the backend's ``error_message`` verbatim in a monospace
 * `<pre>` block and offers a Retry action wired by the caller.
 */

import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, Loader2, RefreshCw, X } from "lucide-react"

export type FailedModalProps = {
  open: boolean
  onClose: () => void
  onRetry: () => void
  isRetrying: boolean
  errorMessage?: string | null
  /** Header title. Defaults to "Analysis Failed". */
  title?: string
  /** Retry button label. Defaults to "Re-analyze". */
  retryLabel?: string
}

export function FailedModal({
  open,
  onClose,
  onRetry,
  isRetrying,
  errorMessage,
  title = "Analysis Failed",
  retryLabel = "Re-analyze",
}: FailedModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring" as const, damping: 30, stiffness: 400 }}
            className="bg-background rounded-lg shadow-lg max-w-md w-full overflow-hidden border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2.5">
                <AlertCircle size={18} className="text-destructive shrink-0" />
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive font-mono">
                {errorMessage || "No error details returned."}
              </pre>
              <div className="flex gap-2.5">
                <button
                  onClick={onClose}
                  className="flex-1 inline-flex items-center justify-center rounded-md border border-border bg-background h-9 px-4 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={onRetry}
                  disabled={isRetrying}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground h-9 px-4 text-sm font-medium shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isRetrying ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Retrying…
                    </>
                  ) : (
                    <>
                      <RefreshCw size={14} /> {retryLabel}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
