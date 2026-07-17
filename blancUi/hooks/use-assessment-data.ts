"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api-client"

export type AssessmentImage = {
  image_id: string
  image_path?: string
  state: string
  stage: string
  error_message?: string | null
  flow_diagram?: { mermaid?: string } | null
  analysis_summary?: { summary?: string } | null
  component_details?: { components?: any[] } | null
  clarification?: { questions?: any[] } | any[] | null
  component_docs?: { question: string; answer: string }[] | null
}

export type AssessmentUsage = {
  total_calls: number
  total_tokens_billed: number
  total_estimated_cost: number
  total_duration_ms: number
}

export type AssessmentSnapshot = {
  assessmentState: string
  assessmentStage: string
  assessmentErrorMessage: string | null
  images: AssessmentImage[]
  loading: boolean
  usageData: AssessmentUsage | null
  refetch: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

const TERMINAL_STATES = new Set(["FAILED", "NEEDS_INPUT", "COMPLETED"])

// Shared hook used by the Studio (assessment/[id]) and the Summary
// (assessment/[id]/summary) pages so they stay in sync without each
// page reinventing the polling + usage-stats wiring.
export function useAssessmentData(id: string | null | undefined): AssessmentSnapshot {
  const [assessmentState, setAssessmentState] = useState<string>("PENDING")
  const [assessmentStage, setAssessmentStage] = useState<string>("INITIALIZING")
  const [assessmentErrorMessage, setAssessmentErrorMessage] = useState<string | null>(null)
  const [images, setImages] = useState<AssessmentImage[]>([])
  const [loading, setLoading] = useState(true)
  const [usageData, setUsageData] = useState<AssessmentUsage | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const fetchUsage = useCallback(async () => {
    if (!id) return
    try {
      const res = await api.get(`/threat_modeling/${id}/usage`)
      if (res.status === 200 && res.data) setUsageData(res.data)
    } catch {
      /* usage data is optional */
    }
  }, [id])

  const refetch = useCallback(async () => {
    if (!id) return
    try {
      const res = await api.get(`/assessment/${id}/progress`)
      if (res.status === 200) {
        const { state, stage, images: imgArr, error_message } = res.data
        setAssessmentState(state)
        setAssessmentStage(stage)
        setAssessmentErrorMessage(error_message ?? null)
        setImages(imgArr || [])
        setLoading(false)
        if (TERMINAL_STATES.has(state)) {
          stopPolling()
          fetchUsage()
        }
      }
    } catch (err) {
      // Surface fetch errors via state if needed; for now keep silent
      // because polling will retry on the next tick.
      console.error("[useAssessmentData] progress fetch failed", err)
    }
  }, [id, stopPolling, fetchUsage])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(refetch, 4000)
  }, [refetch, stopPolling])

  useEffect(() => {
    if (!id) return
    refetch()
    startPolling()
    return () => stopPolling()
  }, [id, refetch, startPolling, stopPolling])

  return {
    assessmentState,
    assessmentStage,
    assessmentErrorMessage,
    images,
    loading,
    usageData,
    refetch,
    startPolling,
    stopPolling,
  }
}
