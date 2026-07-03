"use client"

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react"

import { cn } from "@/lib/utils"

export type CodeEditorHandle = {
  /** Focus the underlying textarea and scroll the given 1-based line into view. */
  focusLine: (line: number) => void
  /** Imperative access to the textarea element. */
  textarea: HTMLTextAreaElement | null
}

type CodeEditorProps = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  spellCheck?: boolean
  /** 1-based line that should be highlighted in the gutter (e.g. parse-error line). */
  errorLine?: number
  className?: string
}

const LINE_HEIGHT_PX = 18 // matches `leading-[18px]` below

/**
 * A minimal line-numbered code editor. Uses a plain `<textarea>` overlaid
 * on a synced gutter so we get IDE-style line numbers without pulling in
 * a heavyweight editor library. The gutter highlights `errorLine` (if set)
 * so Mermaid parse errors line up visually with the offending line.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    { value, onChange, placeholder, disabled, spellCheck = false, errorLine, className },
    ref,
  ) {
    const taRef = useRef<HTMLTextAreaElement | null>(null)
    const gutterRef = useRef<HTMLDivElement | null>(null)

    // Sync gutter scroll with textarea scroll so line numbers stay aligned
    // with their corresponding source lines.
    const handleScroll = () => {
      if (gutterRef.current && taRef.current) {
        gutterRef.current.scrollTop = taRef.current.scrollTop
      }
    }

    // Auto-scroll/focus an error line on demand from the parent (used when
    // the user clicks the parse-error banner).
    useImperativeHandle(
      ref,
      () => ({
        textarea: taRef.current,
        focusLine: (line: number) => {
          const ta = taRef.current
          if (!ta) return
          const lines = ta.value.split("\n")
          const safeLine = Math.max(1, Math.min(line, lines.length))
          // Compute the character offset for the start of `safeLine`.
          let offset = 0
          for (let i = 0; i < safeLine - 1; i += 1) {
            offset += lines[i].length + 1 // +1 for the trailing \n
          }
          const endOffset = offset + (lines[safeLine - 1]?.length ?? 0)
          ta.focus({ preventScroll: true })
          ta.setSelectionRange(offset, endOffset)
          // Centre the line within the viewport when possible.
          const targetTop = Math.max(0, (safeLine - 1) * LINE_HEIGHT_PX - ta.clientHeight / 2)
          ta.scrollTop = targetTop
          if (gutterRef.current) gutterRef.current.scrollTop = targetTop
        },
      }),
      [],
    )

    // Keep the gutter scroll synced when the value changes externally
    // (e.g. another image swap repopulates the textarea).
    useEffect(() => {
      if (gutterRef.current && taRef.current) {
        gutterRef.current.scrollTop = taRef.current.scrollTop
      }
    }, [value])

    // Compute the number of lines for the gutter. `value` may be empty,
    // in which case we still show line 1 so the gutter doesn't collapse.
    const lineCount = Math.max(1, value.split("\n").length)

    return (
      <div className={cn("relative flex min-h-0 flex-1 overflow-hidden rounded-md border bg-background font-mono text-xs", className)}>
        <div
          ref={gutterRef}
          aria-hidden
          className="select-none overflow-hidden border-r bg-muted/40 px-2 py-2 text-right text-[11px] leading-[18px] text-muted-foreground/70 tabular-nums"
          style={{ minWidth: "2.75rem" }}
        >
          {Array.from({ length: lineCount }, (_, i) => {
            const n = i + 1
            const isError = errorLine === n
            return (
              <div
                key={n}
                className={cn(
                  "h-[18px]",
                  isError && "rounded bg-destructive/15 px-1 font-semibold text-destructive",
                )}
              >
                {n}
              </div>
            )
          })}
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          disabled={disabled}
          spellCheck={spellCheck}
          placeholder={placeholder}
          wrap="off"
          className={cn(
            "min-h-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 text-xs leading-[18px] outline-hidden placeholder:text-muted-foreground/60",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />
      </div>
    )
  },
)

export default CodeEditor
