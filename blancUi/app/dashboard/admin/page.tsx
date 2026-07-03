"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  Scale,
  Settings2,
  ShieldCheck,
  Smartphone,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  EASE,
  FooterPill,
  PageHero,
  PageShell,
} from "@/components/dashboard-shell"

// --- Theme map -------------------------------------------------------------
type Accent = "emerald" | "blue" | "indigo" | "rose" | "amber" | "violet"

const accents: Record<
  Accent,
  {
    plate: string
    ring: string
    text: string
    badge: string
    glow: string
  }
> = {
  emerald: {
    plate: "from-emerald-500 via-emerald-500 to-teal-600",
    ring: "ring-emerald-500/30 hover:ring-emerald-500/50",
    text: "text-emerald-600 dark:text-emerald-300",
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    glow: "bg-emerald-500/10",
  },
  blue: {
    plate: "from-sky-500 via-blue-500 to-indigo-600",
    ring: "ring-blue-500/30 hover:ring-blue-500/50",
    text: "text-blue-600 dark:text-blue-300",
    badge:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    glow: "bg-blue-500/10",
  },
  indigo: {
    plate: "from-indigo-500 via-indigo-500 to-violet-600",
    ring: "ring-indigo-500/30 hover:ring-indigo-500/50",
    text: "text-indigo-600 dark:text-indigo-300",
    badge:
      "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    glow: "bg-indigo-500/10",
  },
  violet: {
    plate: "from-violet-500 via-purple-500 to-fuchsia-600",
    ring: "ring-violet-500/30 hover:ring-violet-500/50",
    text: "text-violet-600 dark:text-violet-300",
    badge:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    glow: "bg-violet-500/10",
  },
  rose: {
    plate: "from-rose-500 via-pink-500 to-fuchsia-600",
    ring: "ring-rose-500/30 hover:ring-rose-500/50",
    text: "text-rose-600 dark:text-rose-300",
    badge:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    glow: "bg-rose-500/10",
  },
  amber: {
    plate: "from-amber-500 via-orange-500 to-rose-500",
    ring: "ring-amber-500/30 hover:ring-amber-500/50",
    text: "text-amber-600 dark:text-amber-300",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    glow: "bg-amber-500/10",
  },
}

// --- AdminTile -------------------------------------------------------------
type AdminTileProps = {
  title: string
  description: string
  icon: React.ElementType
  href: string
  accent: Accent
  badge?: string
  index: number
}

function AdminTile({
  title,
  description,
  icon: Icon,
  href,
  accent,
  badge,
  index,
}: AdminTileProps) {
  const a = accents[accent]

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * index, duration: 0.4, ease: EASE }}
      whileHover={{ y: -4 }}
      className="h-full"
    >
      <Link href={href} className="block h-full focus:outline-none">
        <Card
          className={cn(
            "group relative h-full gap-0 overflow-hidden border-border/60 py-0 transition-all duration-300",
            "ring-1 ring-transparent hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/30",
            a.ring,
          )}
        >
          {/* Ambient glow */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -right-20 -top-20 size-56 rounded-full opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100",
              a.glow,
            )}
          />
          {/* Top accent bar */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-linear-to-r transition-transform duration-500 group-hover:scale-x-100",
              a.plate,
            )}
          />

          <CardHeader className="relative gap-3 pt-6">
            <div className="flex items-start justify-between">
              <motion.div
                whileHover={{ rotate: -4, scale: 1.06 }}
                transition={{ type: "spring", stiffness: 300, damping: 16 }}
                className={cn(
                  "relative grid size-11 place-items-center rounded-xl text-white shadow-md ring-1 ring-white/15 bg-linear-to-br",
                  a.plate,
                )}
              >
                {/* Soft inner highlight */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl bg-linear-to-b from-white/20 to-transparent"
                />
                <Icon className="relative size-5" />
              </motion.div>
              {badge && (
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider",
                    a.badge,
                  )}
                >
                  {badge}
                </Badge>
              )}
            </div>
            <div>
              <CardTitle
                className={cn(
                  "text-[15px] font-semibold tracking-tight transition-colors group-hover:opacity-95",
                )}
              >
                {title}
              </CardTitle>
              <CardDescription className="mt-1.5 text-[13px] leading-relaxed">
                {description}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="relative mt-auto flex items-center justify-between pb-5 pt-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition-colors",
                "group-hover:" + a.text.replace("text-", "text-"),
              )}
            >
              Open
            </span>
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full border border-border/60 bg-background text-muted-foreground transition-all duration-300",
                "group-hover:border-transparent group-hover:bg-foreground group-hover:text-background",
              )}
            >
              <ArrowUpRight className="size-3.5 transition-transform duration-300 group-hover:-translate-y-px group-hover:translate-x-px" />
            </span>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  )
}

// --- Section ----------------------------------------------------------------
function Section({
  title,
  description,
  index,
  cols = 3,
  children,
}: {
  title: string
  description: string
  index: number
  cols?: 2 | 3
  children: React.ReactNode
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.4, ease: EASE }}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div
        className={cn(
          "grid gap-4",
          cols === 3
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            : "grid-cols-1 md:grid-cols-2",
        )}
      >
        {children}
      </div>
    </motion.section>
  )
}

// --- Page -------------------------------------------------------------------
export default function AdminPage() {
  return (
    <PageShell accent="violet" maxWidth="7xl">
      {/* --- Hero --- */}
      <PageHero
        icon={Settings2}
        title="Admin Panel"
        description="Manage onboarding, knowledge bases, and platform operations."
      />

        {/* --- Sections --- */}
        <div className="space-y-12">
          <Section
            title="Onboarding"
            description="Set up organizations and applications with guided workflows."
            index={1}
            cols={3}
          >
            <AdminTile
              title="Org Onboarding"
              description="Create and configure organizations, define org-level policies, and complete the organizational questionnaire."
              icon={Building2}
              href="/dashboard/onboarding"
              accent="emerald"
              index={0}
            />
            <AdminTile
              title="App Onboarding"
              description="Register new applications, assign them to organizations, and walk through the app-specific security questionnaire."
              icon={Smartphone}
              href="/dashboard/app"
              accent="blue"
              index={1}
            />
            <AdminTile
              title="Question Manager"
              description="View, create, and bulk-import onboarding questions for both ORG and APP entity types."
              icon={BookOpen}
              href="/dashboard/admin/questions"
              accent="indigo"
              badge="New"
              index={2}
            />
          </Section>

          <Section
            title="RAG & Knowledge Bases"
            description="Ingest documents, manage vector stores, and keep AI context current."
            index={2}
            cols={3}
          >
            <AdminTile
              title="General Knowledge Base"
              description="Standard operating procedures, product specs, and general business documentation."
              icon={BookOpen}
              href="/dashboard/rag"
              accent="indigo"
              badge="Core"
              index={3}
            />
            <AdminTile
              title="Security Knowledge Base"
              description="Security protocols, threat models, network architecture, and vulnerability reports."
              icon={ShieldCheck}
              href="/dashboard/admin/rag"
              accent="rose"
              badge="Security"
              index={4}
            />
            <AdminTile
              title="Compliance Knowledge Base"
              description="Legal frameworks, audit logs, GDPR / ISO / SOC standards, and regulatory requirements."
              icon={Scale}
              href="/dashboard/admin/rag/compliance"
              accent="amber"
              badge="Compliance"
              index={5}
            />
          </Section>
      </div>

      <FooterPill label="ATM Admin · v1" tone="violet" />
    </PageShell>
  )
}
