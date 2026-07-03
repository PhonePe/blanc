"use client"

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { AuthLoading } from "@/components/auth-loading"
import { API_BASE } from "@/lib/api-client"

// --- Types ---
export type AuthUser = {
  name: string
  email: string
  role: string
  avatar?: string
}

type AuthContextType = {
  user: AuthUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  logout: () => void
  refreshUser: () => Promise<void>
  setAuthUser: (user: AuthUser, token: string) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// --- JWT expiry check (with 60s buffer) ---
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return true // malformed JWT structure
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const payload = JSON.parse(atob(base64))
    if (!payload || typeof payload !== "object") return true
    if (!payload.exp) return false // no expiry claim → treat as valid
    return payload.exp * 1000 < Date.now() + 60_000
  } catch {
    return true // malformed → treat as expired
  }
}

// --- Provider ---
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const hasValidated = useRef(false)

  // Clear auth state and redirect to login
  const logout = useCallback(() => {
    localStorage.removeItem("token")
    setUser(null)
    setToken(null)
    router.push("/login")
  }, [router])

  // Validate token against server and get user profile
  const validateAndLoadUser = useCallback(async (storedToken: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/profile`, {
        headers: {
          Authorization: `Bearer ${storedToken}`,
          Accept: "application/json",
        },
      })

      if (!res.ok) {
        throw new Error("Invalid token")
      }

      const data = await res.json()
      setUser({
        name: data.data.name,
        email: data.data.email,
        role: data.data.role || "user",
        avatar: "/avatars/shadcn.jpg",
      })
      setToken(storedToken)
    } catch {
      // Token is invalid — clear and redirect
      localStorage.removeItem("token")
      setUser(null)
      setToken(null)
      router.push("/login")
    }
  }, [router])

  // Refresh user profile without validating token expiry
  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem("token")
    if (!storedToken) return
    await validateAndLoadUser(storedToken)
  }, [validateAndLoadUser])

  // Set user + token from login (avoids extra /auth/profile call)
  const setAuthUser = useCallback((newUser: AuthUser, newToken: string) => {
    localStorage.setItem("token", newToken)
    setUser(newUser)
    setToken(newToken)
  }, [])

  // Initial hydration
  useEffect(() => {
    if (hasValidated.current) return
    hasValidated.current = true

    const storedToken = localStorage.getItem("token")

    if (!storedToken || isTokenExpired(storedToken)) {
      localStorage.removeItem("token")
      setUser(null)
      setToken(null)
      setIsLoading(false)
      router.push("/login")
      return
    }

    validateAndLoadUser(storedToken).finally(() => setIsLoading(false))
  }, [validateAndLoadUser, router])

  // Cross-tab logout via StorageEvent
  useEffect(() => {
    const onStorageChange = (e: StorageEvent) => {
      if (e.key === "token" && !e.newValue) {
        setUser(null)
        setToken(null)
        router.push("/login")
      }
    }
    window.addEventListener("storage", onStorageChange)
    return () => window.removeEventListener("storage", onStorageChange)
  }, [router])

  // Periodic token expiry check (every 30s)
  useEffect(() => {
    const interval = setInterval(() => {
      const storedToken = localStorage.getItem("token")
      if (storedToken && isTokenExpired(storedToken)) {
        logout()
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [logout])

  // Show loading screen while validating
  if (isLoading) {
    return <AuthLoading />
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        logout,
        refreshUser,
        setAuthUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// --- Hook ---
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
