"use client"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { usePathname } from "next/navigation"
import { useMemo } from "react"

const routeTitles: Record<string, string> = {
  "/dashboard/app": "Dashboard",
  "/dashboard/assessment/my_assessment": "My Assessments",
  "/dashboard/assessment/under_review": "Under Review",
  "/dashboard/assessment/new": "New Assessment",
  "/dashboard/org": "Organization",
  "/dashboard/rag": "Knowledge Base",
  "/dashboard/admin": "Admin Panel",
  "/dashboard/admin/rag": "Admin RAG",
  "/dashboard/admin/questions": "Question Manager",
  "/dashboard/onboarding": "Onboarding",
  "/dashboard/blancstudio": "Blanc Studio",
}

export function SiteHeader() {
  const pathname = usePathname()

  const pageTitle = useMemo(() => {
    if (routeTitles[pathname]) return routeTitles[pathname]
    if (pathname.startsWith("/dashboard/assessment/") && !pathname.includes("my_assessment") && !pathname.includes("under_review") && !pathname.includes("new"))
      return "Assessment"
    if (pathname.startsWith("/dashboard/threat/")) return "Threat Report"
    return "Automated Threat Modelling"
  }, [pathname])

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-semibold">{pageTitle}</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
