"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  CheckSquare,
  ChevronDown,
  Database,
  FileText,
  Fingerprint,
  Globe,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash,
  Trash2,
  Users,
  Wand2,
} from "lucide-react"

import { api } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// --- ThreatModel Inventory types & helpers ---------------------------------
// Schema based on the Surface Discovery reference
// (components / trust boundaries / environments / exposure).

export type TMTrustLevel = "Critical" | "High" | "Medium" | "Low"
export type TMExposure = "Public" | "Partner" | "Internal" | "Restricted" | "VPN"
export type TMComponentType =
  | "Client"
  | "Edge"
  | "Application"
  | "Data"
  | "External"
  | "Infrastructure"
export type TMEnvironmentType = "External" | "Semi-Trusted" | "Internal" | "Restricted"
export type TMAuthN =
  | "None"
  | "API Key"
  | "JWT"
  | "OAuth2/OIDC"
  | "mTLS"
  | "SAML"
  | "Basic"
  | "Session"
  | "Service Account"
export type TMAuthZ =
  | "None"
  | "RBAC"
  | "ABAC"
  | "ACL"
  | "Policy (OPA/Cedar)"
  | "Cloud IAM"
  | "OAuth Scopes"
export type TMProtocol =
  | "HTTPS"
  | "HTTPS/Token"
  | "mTLS"
  | "gRPC"
  | "SQL/TCP"
  | "TCP"
  | "WebSocket"
  | "AMQP/Kafka"

export type TMComponent = {
  id: string
  name: string
  type: TMComponentType
  exposure: TMExposure
  environment: string
  trustLevel: TMTrustLevel
  authn: TMAuthN
  authz: TMAuthZ
  desc: string
}

export type TMBoundary = {
  id: string
  name: string
  source: string
  destination: string
  protocol: TMProtocol
  authentication: string
  threatLevel: TMTrustLevel
}

export type TMEnvironment = {
  id: string
  name: string
  type: TMEnvironmentType
  desc: string
  memberComponents: string[]
}

const TM_TRUST_LEVELS: TMTrustLevel[] = ["Critical", "High", "Medium", "Low"]
const TM_EXPOSURES: TMExposure[] = ["Public", "Partner", "Internal", "Restricted", "VPN"]
const TM_COMPONENT_TYPES: TMComponentType[] = [
  "Client",
  "Edge",
  "Application",
  "Data",
  "External",
  "Infrastructure",
]
const TM_ENVIRONMENT_TYPES: TMEnvironmentType[] = [
  "External",
  "Semi-Trusted",
  "Internal",
  "Restricted",
]
const TM_PROTOCOLS: TMProtocol[] = [
  "HTTPS",
  "HTTPS/Token",
  "mTLS",
  "gRPC",
  "SQL/TCP",
  "TCP",
  "WebSocket",
  "AMQP/Kafka",
]
const TM_AUTHN_OPTIONS: TMAuthN[] = [
  "None",
  "API Key",
  "JWT",
  "OAuth2/OIDC",
  "mTLS",
  "SAML",
  "Basic",
  "Session",
  "Service Account",
]
const TM_AUTHZ_OPTIONS: TMAuthZ[] = [
  "None",
  "RBAC",
  "ABAC",
  "ACL",
  "Policy (OPA/Cedar)",
  "Cloud IAM",
  "OAuth Scopes",
]

// --- Tooltip catalog: human descriptions for every enum option -------------
type TMOptionInfo<T extends string> = Record<T, string>

const TM_INFO_COMPONENT_TYPE: TMOptionInfo<TMComponentType> = {
  Client: "Browser, mobile, desktop, admin UI — initiates requests.",
  Edge: "Gateway, CDN, LB, proxy, WAF — first hop from external network.",
  Application: "Backend services, APIs, workers — runs business logic.",
  Data: "Databases, caches, object storage, queues, secrets stores.",
  External: "Third-party / partner SaaS reached over the public internet.",
  Infrastructure: "VPC, subnet, cluster, namespace, host, region.",
}
const TM_INFO_EXPOSURE: TMOptionInfo<TMExposure> = {
  Public: "Reachable from the public internet by anyone.",
  Partner: "Reachable only by specific external partners (allow-listed).",
  Internal: "Reachable across many internal systems within the org.",
  Restricted: "Reachable from a tightly scoped set (CDE, vault, secrets).",
  VPN: "Reachable only over an authenticated VPN / private link.",
}
const TM_INFO_TRUST: TMOptionInfo<TMTrustLevel> = {
  Critical: "Handles regulated data (PCI/PII/secrets); blast radius severe.",
  High: "Sensitive but not regulated; compromise impacts many users.",
  Medium: "Standard service; limited blast radius.",
  Low: "Public-facing or low-value asset.",
}
const TM_INFO_ENV_TYPE: TMOptionInfo<TMEnvironmentType> = {
  External: "Internet / untrusted networks.",
  "Semi-Trusted": "DMZ, perimeter, public subnets.",
  Internal: "Private VPCs, internal networks.",
  Restricted: "CDE, PCI, secret-bearing private subnets.",
}
const TM_INFO_AUTHN: TMOptionInfo<TMAuthN> = {
  None: "No authentication required (anonymous).",
  "API Key": "Static API key in request header.",
  JWT: "Signed JSON Web Token (bearer).",
  "OAuth2/OIDC":
    "OAuth 2.0 / OpenID Connect authorization-code or client-credentials flow.",
  mTLS: "Mutual TLS — caller presents a client certificate.",
  SAML: "SAML 2.0 federated SSO assertions.",
  Basic: "HTTP Basic auth (user:pass over TLS).",
  Session: "Cookie-based session bound to a server-side store.",
  "Service Account": "Workload identity (cloud IAM role / K8s SA token).",
}
const TM_INFO_AUTHZ: TMOptionInfo<TMAuthZ> = {
  None: "No authorization checks performed.",
  RBAC: "Role-based access control — coarse role → permission mapping.",
  ABAC: "Attribute-based access control — claims, tags, request attributes.",
  ACL:
    "Per-resource access control list (allowed identities listed on the object).",
  "Policy (OPA/Cedar)":
    "Externalized policy engine evaluating decision rules.",
  "Cloud IAM": "Cloud-provider IAM policies (AWS/GCP/Azure).",
  "OAuth Scopes":
    "Fine-grained OAuth scopes / token claims gating each endpoint.",
}

// --- Migration / shape-normalization for persisted payloads ----------------

const TM_LEGACY_EXPOSURE_MAP: Record<string, TMExposure> = {
  High: "Public",
  Moderate: "Partner",
  Low: "Internal",
  Isolated: "Restricted",
  "Internet/Public": "Public",
}
const TM_LEGACY_TYPE_MAP: Record<string, TMComponentType> = {
  Microservice: "Application",
  Proxy: "Edge",
  Gateway: "Edge",
  Firewall: "Edge",
  Vault: "Data",
  Database: "Data",
}

export const migrateTMComponent = (raw: any): TMComponent => {
  const type: TMComponentType = TM_COMPONENT_TYPES.includes(raw?.type)
    ? raw.type
    : TM_LEGACY_TYPE_MAP[raw?.type as string] || "Application"
  const exposure: TMExposure = TM_EXPOSURES.includes(raw?.exposure)
    ? raw.exposure
    : TM_LEGACY_EXPOSURE_MAP[raw?.exposure as string] || "Internal"
  const trustLevel: TMTrustLevel = TM_TRUST_LEVELS.includes(raw?.trustLevel)
    ? raw.trustLevel
    : TM_TRUST_LEVELS.includes(raw?.trust_level)
    ? raw.trust_level
    : "Medium"
  const authn: TMAuthN = TM_AUTHN_OPTIONS.includes(raw?.authn) ? raw.authn : "None"
  const authz: TMAuthZ = TM_AUTHZ_OPTIONS.includes(raw?.authz) ? raw.authz : "None"
  return {
    id: String(raw?.id || `manual-${Date.now()}`),
    name: String(raw?.name || ""),
    type,
    exposure,
    environment: String(raw?.environment || raw?.zone || "Unspecified Environment"),
    trustLevel,
    authn,
    authz,
    desc: String(raw?.desc || ""),
  }
}

export const migrateTMBoundary = (raw: any): TMBoundary => {
  const protocol: TMProtocol = TM_PROTOCOLS.includes(raw?.protocol)
    ? raw.protocol
    : raw?.protocol === "gRPC/Internal"
    ? "gRPC"
    : raw?.protocol === "mTLS/TCP"
    ? "mTLS"
    : "HTTPS"
  const threatLevel: TMTrustLevel = TM_TRUST_LEVELS.includes(raw?.threatLevel)
    ? raw.threatLevel
    : TM_TRUST_LEVELS.includes(raw?.threat_level)
    ? raw.threat_level
    : "Medium"
  return {
    id: String(raw?.id || `manual-${Date.now()}`),
    name: String(raw?.name || ""),
    source: String(raw?.source || ""),
    destination: String(raw?.destination || ""),
    protocol,
    authentication: String(raw?.authentication || "TLS 1.3"),
    threatLevel,
  }
}

export const migrateTMEnvironment = (raw: any): TMEnvironment => {
  const type: TMEnvironmentType = TM_ENVIRONMENT_TYPES.includes(raw?.type)
    ? raw.type
    : "Internal"
  const rawMembers = raw?.member_components ?? raw?.memberComponents ?? []
  const memberComponents: string[] = Array.isArray(rawMembers)
    ? rawMembers.map((m: unknown) => String(m)).filter(Boolean)
    : []
  return {
    id: String(raw?.id || `manual-env-${Date.now()}`),
    name: String(raw?.name || ""),
    type,
    desc: String(raw?.desc || ""),
    memberComponents,
  }
}

// --- Styling helpers -------------------------------------------------------

const getTMTrustClass = (level: TMTrustLevel) => {
  switch (level) {
    case "Critical":
      return "bg-red-500/15 border-red-500/30 text-red-500 dark:text-red-400"
    case "High":
      return "bg-orange-500/15 border-orange-500/30 text-orange-500 dark:text-orange-400"
    case "Medium":
      return "bg-indigo-500/15 border-indigo-500/30 text-indigo-500 dark:text-indigo-400"
    default:
      return "bg-slate-500/15 border-slate-500/30 text-slate-500 dark:text-slate-400"
  }
}

const getTMExposureClass = (level: TMExposure) => {
  switch (level) {
    case "Public":
      return "bg-rose-500/15 border-rose-500/30 text-rose-500 dark:text-rose-400"
    case "Partner":
      return "bg-amber-500/15 border-amber-500/30 text-amber-500 dark:text-amber-400"
    case "Internal":
      return "bg-sky-500/15 border-sky-500/30 text-sky-500 dark:text-sky-400"
    case "Restricted":
      return "bg-emerald-500/15 border-emerald-500/30 text-emerald-500 dark:text-emerald-400"
    case "VPN":
      return "bg-violet-500/15 border-violet-500/30 text-violet-500 dark:text-violet-400"
  }
}

const getTMEnvClass = (type: TMEnvironmentType) => {
  switch (type) {
    case "External":
      return "bg-rose-500/15 border-rose-500/30 text-rose-500 dark:text-rose-400"
    case "Semi-Trusted":
      return "bg-amber-500/15 border-amber-500/30 text-amber-500 dark:text-amber-400"
    case "Internal":
      return "bg-sky-500/15 border-sky-500/30 text-sky-500 dark:text-sky-400"
    case "Restricted":
      return "bg-emerald-500/15 border-emerald-500/30 text-emerald-500 dark:text-emerald-400"
  }
}

const componentTypeIcon = (type: TMComponentType) => {
  if (type === "Data")
    return <Database className="size-3.5 text-indigo-500 dark:text-indigo-400" />
  if (type === "External")
    return <Globe className="size-3.5 text-rose-500 dark:text-rose-400" />
  if (type === "Client")
    return <Users className="size-3.5 text-emerald-500 dark:text-emerald-400" />
  if (type === "Edge")
    return <ShieldAlert className="size-3.5 text-amber-500 dark:text-amber-400" />
  if (type === "Infrastructure")
    return <Layers className="size-3.5 text-sky-500 dark:text-sky-400" />
  return <Server className="size-3.5 text-muted-foreground" />
}

// Reusable info-tooltip — used next to enum dropdown labels to explain each
// option in plain language.
const EnumInfo = <T extends string>({
  title,
  options,
  info,
}: {
  title: string
  options: readonly T[]
  info: TMOptionInfo<T>
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`About ${title}`}
        onClick={(e) => e.preventDefault()}
      >
        <Info className="size-3" />
      </button>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      align="start"
      className="max-w-sm border bg-popover text-popover-foreground shadow-md"
    >
      <div className="space-y-1.5 p-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {title}
        </div>
        <dl className="space-y-1 text-[11px]">
          {options.map((opt) => (
            <div key={opt} className="leading-snug">
              <span className="font-semibold text-foreground">{opt}</span>
              <span className="text-muted-foreground"> — {info[opt]}</span>
            </div>
          ))}
        </dl>
      </div>
    </TooltipContent>
  </Tooltip>
)

// --- ThreatModelInventory --------------------------------------------------

export type ThreatModelInventoryProps = {
  /** Mermaid source persisted alongside the surface map (sent on autosave). */
  code: string
  /**
   * Optional localStorage key suffix; when set, the inventory is mirrored to
   * `localStorage` under `tm-inventory:<persistKey>` for offline reuse.
   */
  persistKey?: string
  /** When both `assessmentId` + `imageId` are provided, API persistence is enabled. */
  assessmentId?: string
  imageId?: string
}

export function ThreatModelInventory({
  code,
  persistKey,
  assessmentId,
  imageId,
}: ThreatModelInventoryProps) {
  const storageKey = persistKey ? `tm-inventory:${persistKey}` : null
  const apiEnabled = Boolean(assessmentId && imageId)

  const [components, setComponents] = useState<TMComponent[]>([])
  const [boundaries, setBoundaries] = useState<TMBoundary[]>([])
  const [environments, setEnvironments] = useState<TMEnvironment[]>([])
  const [initialized, setInitialized] = useState(false)

  const [compSearch, setCompSearch] = useState("")
  const [envSearch, setEnvSearch] = useState("")

  const [selectedCompIds, setSelectedCompIds] = useState<string[]>([])
  const [selectedEnvIds, setSelectedEnvIds] = useState<string[]>([])

  const [showAddCompModal, setShowAddCompModal] = useState(false)
  const [newComp, setNewComp] = useState<Omit<TMComponent, "id">>({
    name: "",
    environment: "Internal Network",
    trustLevel: "Medium",
    exposure: "Internal",
    type: "Application",
    authn: "JWT",
    authz: "RBAC",
    desc: "",
  })

  const [showAddEnvModal, setShowAddEnvModal] = useState(false)
  const [newEnv, setNewEnv] = useState<Omit<TMEnvironment, "id">>({
    name: "",
    type: "Internal",
    desc: "",
    memberComponents: [],
  })

  // Suppress the very next save after a fresh hydrate/import so we don't POST
  // back exactly what we just read from the server.
  const skipNextPersistRef = useRef(false)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  )
  const [autoDiscoverLoading, setAutoDiscoverLoading] = useState(false)

  // Re-hydrate whenever the active surface (assessment + image) changes so the
  // inventory tracks the user's selection in the parent shell.
  useEffect(() => {
    let cancelled = false
    setInitialized(false)
    setComponents([])
    setBoundaries([])
    setEnvironments([])
    setSelectedCompIds([])
    setSelectedEnvIds([])

    const hydrateFromLocal = () => {
      if (!storageKey) return
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed.components))
            setComponents(parsed.components.map(migrateTMComponent))
          if (Array.isArray(parsed.boundaries))
            setBoundaries(parsed.boundaries.map(migrateTMBoundary))
          if (Array.isArray(parsed.environments))
            setEnvironments(parsed.environments.map(migrateTMEnvironment))
        }
      } catch {
        /* ignore */
      }
    }

    const run = async () => {
      if (apiEnabled) {
        try {
          const res = await api.get(
            `/threat_modeling/${assessmentId}/surface-map/${imageId}`
          )
          const sm = res?.data?.surface_map
          if (!cancelled && sm) {
            const comps = Array.isArray(sm.components)
              ? sm.components.map(migrateTMComponent)
              : []
            const bounds = Array.isArray(sm.trust_boundaries)
              ? sm.trust_boundaries.map(migrateTMBoundary)
              : []
            const envs = Array.isArray(sm.environments)
              ? sm.environments.map(migrateTMEnvironment)
              : []
            if (comps.length || bounds.length || envs.length) {
              setComponents(comps)
              setBoundaries(bounds)
              setEnvironments(envs)
              skipNextPersistRef.current = true
            } else {
              hydrateFromLocal()
            }
          }
        } catch {
          hydrateFromLocal()
        }
      } else {
        hydrateFromLocal()
      }
      if (!cancelled) {
        setInitialized(true)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [storageKey, apiEnabled, assessmentId, imageId])

  // Persist: localStorage immediately, API debounced.
  useEffect(() => {
    if (!initialized) return
    if (storageKey) {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ components, boundaries, environments })
        )
      } catch {
        /* ignore */
      }
    }
    if (!apiEnabled) return
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }

    setSaveState("saving")
    const t = setTimeout(async () => {
      try {
        await api.put(`/threat_modeling/${assessmentId}/surface-map/${imageId}`, {
          components: components.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            environment: c.environment,
            exposure: c.exposure,
            trust_level: c.trustLevel,
            authn: c.authn,
            authz: c.authz,
            desc: c.desc,
          })),
          trust_boundaries: boundaries.map((b) => ({
            id: b.id,
            name: b.name,
            source: b.source,
            destination: b.destination,
            protocol: b.protocol,
            authentication: b.authentication,
            threat_level: b.threatLevel,
          })),
          environments: environments.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.type,
            desc: e.desc,
            member_components: e.memberComponents,
          })),
          mermaid: code,
        })
        setSaveState("saved")
      } catch {
        setSaveState("error")
      }
    }, 800)
    return () => clearTimeout(t)
  }, [
    components,
    boundaries,
    environments,
    storageKey,
    initialized,
    apiEnabled,
    assessmentId,
    imageId,
    code,
  ])

  useEffect(() => {
    setSelectedCompIds((prev) => prev.filter((id) => components.some((c) => c.id === id)))
  }, [components])

  useEffect(() => {
    setSelectedEnvIds((prev) => prev.filter((id) => environments.some((e) => e.id === id)))
  }, [environments])

  const filteredComponents = useMemo(() => {
    const term = compSearch.trim().toLowerCase()
    if (!term) return components
    return components.filter((c) =>
      [c.name, c.environment, c.type, c.exposure, c.desc]
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
  }, [components, compSearch])

  const filteredEnvironments = useMemo(() => {
    const term = envSearch.trim().toLowerCase()
    if (!term) return environments
    return environments.filter((e) =>
      [e.name, e.type, e.desc].join(" ").toLowerCase().includes(term)
    )
  }, [environments, envSearch])

  const publicCount = useMemo(
    () => components.filter((c) => c.exposure === "Public").length,
    [components]
  )
  const knownEnvironmentNames = useMemo(() => {
    const names = new Set<string>()
    environments.forEach((e) => names.add(e.name))
    components.forEach((c) => {
      if (c.environment) names.add(c.environment)
    })
    return Array.from(names)
  }, [environments, components])

  const compHeaderState: boolean | "indeterminate" =
    filteredComponents.length > 0 &&
    filteredComponents.every((c) => selectedCompIds.includes(c.id))
      ? true
      : selectedCompIds.length > 0
      ? "indeterminate"
      : false

  const envHeaderState: boolean | "indeterminate" =
    filteredEnvironments.length > 0 &&
    filteredEnvironments.every((e) => selectedEnvIds.includes(e.id))
      ? true
      : selectedEnvIds.length > 0
      ? "indeterminate"
      : false

  // -- Component handlers --------------------------------------------------

  const handleSelectAllComponents = () => {
    const filteredIds = filteredComponents.map((c) => c.id)
    const allSelected =
      filteredIds.length > 0 && filteredIds.every((id) => selectedCompIds.includes(id))
    setSelectedCompIds((prev) =>
      allSelected
        ? prev.filter((id) => !filteredIds.includes(id))
        : Array.from(new Set([...prev, ...filteredIds]))
    )
  }

  const handleToggleComponentSelection = (id: string) => {
    setSelectedCompIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleBulkCompTrustChange = (trustLevel: TMTrustLevel) => {
    setComponents((prev) =>
      prev.map((c) => (selectedCompIds.includes(c.id) ? { ...c, trustLevel } : c))
    )
    toast.success(`Trust level set to ${trustLevel}`)
  }

  const handleBulkCompExposureChange = (exposure: TMExposure) => {
    setComponents((prev) =>
      prev.map((c) => (selectedCompIds.includes(c.id) ? { ...c, exposure } : c))
    )
    toast.success(`Exposure set to ${exposure}`)
  }

  const handleBulkCompTypeChange = (type: TMComponentType) => {
    setComponents((prev) =>
      prev.map((c) => (selectedCompIds.includes(c.id) ? { ...c, type } : c))
    )
    toast.success(`Type set to ${type}`)
  }

  const handleBulkCompAuthNChange = (authn: TMAuthN) => {
    setComponents((prev) =>
      prev.map((c) => (selectedCompIds.includes(c.id) ? { ...c, authn } : c))
    )
    toast.success(`AuthN set to ${authn}`)
  }

  const handleBulkCompAuthZChange = (authz: TMAuthZ) => {
    setComponents((prev) =>
      prev.map((c) => (selectedCompIds.includes(c.id) ? { ...c, authz } : c))
    )
    toast.success(`AuthZ set to ${authz}`)
  }

  const handleBulkCompDelete = () => {
    const n = selectedCompIds.length
    setComponents((prev) => prev.filter((c) => !selectedCompIds.includes(c.id)))
    setSelectedCompIds([])
    toast.success(`Deleted ${n} component${n === 1 ? "" : "s"}`)
  }

  const updateComponentField = <K extends keyof TMComponent>(
    id: string,
    field: K,
    value: TMComponent[K]
  ) => {
    setComponents((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    )
  }

  const deleteComponent = (id: string) => {
    setComponents((prev) => prev.filter((c) => c.id !== id))
    toast.success("Component removed")
  }

  const addComponentHandler = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newComp.name.trim()) {
      toast.error("Component name is required")
      return
    }
    const id = `manual-${Date.now()}`
    setComponents((prev) => [...prev, { ...newComp, id }])
    setShowAddCompModal(false)
    setNewComp({
      name: "",
      environment: "Internal Network",
      trustLevel: "Medium",
      exposure: "Internal",
      type: "Application",
      authn: "JWT",
      authz: "RBAC",
      desc: "",
    })
    toast.success("Component registered")
  }

  // -- Environment (Trust Boundary) handlers -------------------------------

  const handleSelectAllEnvironments = () => {
    const filteredIds = filteredEnvironments.map((e) => e.id)
    const allSelected =
      filteredIds.length > 0 && filteredIds.every((id) => selectedEnvIds.includes(id))
    setSelectedEnvIds((prev) =>
      allSelected
        ? prev.filter((id) => !filteredIds.includes(id))
        : Array.from(new Set([...prev, ...filteredIds]))
    )
  }

  const handleToggleEnvironmentSelection = (id: string) => {
    setSelectedEnvIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleBulkEnvTypeChange = (type: TMEnvironmentType) => {
    setEnvironments((prev) =>
      prev.map((e) => (selectedEnvIds.includes(e.id) ? { ...e, type } : e))
    )
    toast.success(`Environment type set to ${type}`)
  }

  const handleBulkEnvDelete = () => {
    const n = selectedEnvIds.length
    setEnvironments((prev) => prev.filter((e) => !selectedEnvIds.includes(e.id)))
    setSelectedEnvIds([])
    toast.success(`Deleted ${n} environment${n === 1 ? "" : "s"}`)
  }

  const updateEnvironmentField = <K extends keyof TMEnvironment>(
    id: string,
    field: K,
    value: TMEnvironment[K]
  ) => {
    setEnvironments((prev) => {
      if (field === "name") {
        const target = prev.find((e) => e.id === id)
        const oldName = target?.name
        const newName = value as unknown as string
        if (target && oldName && oldName !== newName) {
          setComponents((comps) =>
            comps.map((c) =>
              c.environment === oldName ? { ...c, environment: newName } : c
            )
          )
        }
      }
      return prev.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    })
  }

  const deleteEnvironment = (id: string) => {
    setEnvironments((prev) => prev.filter((e) => e.id !== id))
    toast.success("Environment removed")
  }

  const addEnvironmentHandler = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newEnv.name.trim()) {
      toast.error("Trust boundary name is required")
      return
    }
    const id = `manual-env-${Date.now()}`
    const name = newEnv.name.trim()
    const picked = newEnv.memberComponents
    setEnvironments((prev) => [
      ...prev.map((e) =>
        picked.length === 0
          ? e
          : {
              ...e,
              memberComponents: e.memberComponents.filter(
                (cid) => !picked.includes(cid)
              ),
            }
      ),
      { ...newEnv, id, name },
    ])
    if (picked.length > 0) {
      setComponents((prev) =>
        prev.map((c) => (picked.includes(c.id) ? { ...c, environment: name } : c))
      )
    }
    setShowAddEnvModal(false)
    setNewEnv({ name: "", type: "Internal", desc: "", memberComponents: [] })
    toast.success("Trust boundary registered")
  }

  // Toggle a component's membership in one environment. Membership lives on
  // the environment (`env.memberComponents`); the component's own
  // `environment` field is kept in sync to whichever env was checked last.
  const toggleEnvMember = (envId: string, componentId: string) => {
    type Membership = { envName: string; checked: boolean }
    let nextMembership: Membership | null = null
    setEnvironments((prev) =>
      prev.map((e) => {
        if (e.id !== envId) return e
        const has = e.memberComponents.includes(componentId)
        nextMembership = { envName: e.name, checked: !has } as Membership
        return {
          ...e,
          memberComponents: has
            ? e.memberComponents.filter((id) => id !== componentId)
            : [...e.memberComponents, componentId],
        }
      })
    )
    const membership = nextMembership as Membership | null
    if (membership?.checked) {
      setComponents((prev) =>
        prev.map((c) =>
          c.id === componentId ? { ...c, environment: membership.envName } : c
        )
      )
      setEnvironments((prev) =>
        prev.map((e) =>
          e.id === envId
            ? e
            : {
                ...e,
                memberComponents: e.memberComponents.filter(
                  (id) => id !== componentId
                ),
              }
        )
      )
    }
  }

  // Calls the backend Surface Discovery skill for this image and replaces
  // the inventory with the AI-generated payload.
  const handleAutoDiscover = async () => {
    if (!apiEnabled) {
      toast.error("Auto-discover requires an active assessment image")
      return
    }
    setAutoDiscoverLoading(true)
    try {
      const res = await api.post(
        `/threat_modeling/${assessmentId}/surface-map/${imageId}/generate?save=true&overwrite=true`
      )
      const sm = res?.data?.surface_map
      if (sm) {
        const comps = Array.isArray(sm.components)
          ? sm.components.map(migrateTMComponent)
          : []
        const bounds = Array.isArray(sm.trust_boundaries)
          ? sm.trust_boundaries.map(migrateTMBoundary)
          : []
        const envs = Array.isArray(sm.environments)
          ? sm.environments.map(migrateTMEnvironment)
          : []
        setComponents(comps)
        setBoundaries(bounds)
        setEnvironments(envs)
        skipNextPersistRef.current = true
        toast.success(
          `Discovered ${comps.length} components across ${envs.length} trust zones`
        )
      } else {
        toast.error("Surface discovery returned an empty payload")
      }
    } catch (err) {
      console.error("surface discovery failed", err)
      toast.error("Auto-discover failed. Check server logs.")
    } finally {
      setAutoDiscoverLoading(false)
    }
  }

  // Silence unused-variable warnings for `boundaries` — it is hydrated from
  // the API and persisted on save, but no longer rendered in the UI.
  void boundaries

  return (
    <TooltipProvider delayDuration={150}>
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="border-b bg-muted/30 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg border bg-background text-primary">
              <ShieldCheck className="size-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                ThreatModeller Inventory
                <Badge variant="secondary" className="text-[10px] font-medium">
                  AI Generated
                </Badge>
                {apiEnabled && (
                  <span
                    className={cn(
                      "group inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-tight backdrop-blur-sm transition-all",
                      saveState === "saving" &&
                        "border-amber-500/40 bg-amber-500/10 text-amber-700 shadow-[0_0_0_3px_rgba(245,158,11,0.06)] dark:text-amber-300",
                      saveState === "saved" &&
                        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 shadow-[0_0_0_3px_rgba(16,185,129,0.06)] dark:text-emerald-300",
                      saveState === "error" &&
                        "border-rose-500/40 bg-rose-500/10 text-rose-700 shadow-[0_0_0_3px_rgba(244,63,94,0.06)] dark:text-rose-300",
                      saveState === "idle" &&
                        "border-border bg-muted/50 text-muted-foreground"
                    )}
                    title="Surface map sync status"
                    aria-live="polite"
                  >
                    <span className="relative flex size-1.5">
                      {saveState === "saving" && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
                      )}
                      <span
                        className={cn(
                          "relative inline-flex size-1.5 rounded-full",
                          saveState === "saving" && "bg-amber-500",
                          saveState === "saved" && "bg-emerald-500",
                          saveState === "error" && "bg-rose-500",
                          saveState === "idle" && "bg-muted-foreground/60"
                        )}
                      />
                    </span>
                    {saveState === "saving"
                      ? "Saving"
                      : saveState === "saved"
                      ? "Saved"
                      : saveState === "error"
                      ? "Save failed"
                      : "Synced"}
                  </span>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                Components, trust boundaries & environments identified by AI from the
                diagram. Edits autosave.
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <div className="flex flex-wrap items-center gap-2">
              {apiEnabled && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleAutoDiscover}
                  disabled={autoDiscoverLoading}
                >
                  {autoDiscoverLoading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Wand2 />
                  )}
                  {autoDiscoverLoading ? "Discovering…" : "Auto-discover with AI"}
                </Button>
              )}
            </div>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-6 p-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="grid size-9 place-items-center rounded-md border bg-background text-primary">
                <Server className="size-4" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-none">
                  {components.length}
                </div>
                <div className="text-[11px] text-muted-foreground">Components</div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="grid size-9 place-items-center rounded-md border bg-background text-primary">
                <Layers className="size-4" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-none">
                  {environments.length}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Trust Boundaries
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="grid size-9 place-items-center rounded-md border bg-background text-primary">
                <Globe className="size-4" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-none">{publicCount}</div>
                <div className="text-[11px] text-muted-foreground">
                  Publicly Exposed
                </div>
              </div>
            </div>
          </div>

          {/* COMPONENTS SECTION */}
          <section className="space-y-3">
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-0.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Server className="size-4 text-primary" /> Component Inventory
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Inline-edit parameters or batch-update via checkboxes.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={compSearch}
                    onChange={(e) => setCompSearch(e.target.value)}
                    placeholder="Search components…"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Button type="button" size="sm" onClick={() => setShowAddCompModal(true)}>
                  <Plus /> Add Component
                </Button>
              </div>
            </div>

            {selectedCompIds.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-7 place-items-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                    <CheckSquare className="size-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold leading-none">
                      {selectedCompIds.length} components selected
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Batch update or remove selected entries.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Set Trust <ChevronDown className="text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Trust Level</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {TM_TRUST_LEVELS.map((tr) => (
                        <DropdownMenuItem
                          key={tr}
                          onClick={() => handleBulkCompTrustChange(tr)}
                        >
                          {tr}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Set Type <ChevronDown className="text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Component Type</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {TM_COMPONENT_TYPES.map((t) => (
                        <DropdownMenuItem
                          key={t}
                          onClick={() => handleBulkCompTypeChange(t)}
                        >
                          {t}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Set Exposure <ChevronDown className="text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Exposure</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {TM_EXPOSURES.map((ex) => (
                        <DropdownMenuItem
                          key={ex}
                          onClick={() => handleBulkCompExposureChange(ex)}
                        >
                          {ex}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Set AuthN <ChevronDown className="text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Authentication</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {TM_AUTHN_OPTIONS.map((a) => (
                        <DropdownMenuItem
                          key={a}
                          onClick={() => handleBulkCompAuthNChange(a)}
                        >
                          {a}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Set AuthZ <ChevronDown className="text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Authorization</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {TM_AUTHZ_OPTIONS.map((a) => (
                        <DropdownMenuItem
                          key={a}
                          onClick={() => handleBulkCompAuthZChange(a)}
                        >
                          {a}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkCompDelete}
                  >
                    <Trash /> Delete
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedCompIds([])}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-10 text-center">
                      <Checkbox
                        aria-label="Select all components"
                        checked={compHeaderState}
                        onCheckedChange={handleSelectAllComponents}
                      />
                    </TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead>
                      Type
                      <EnumInfo
                        title="Component Type"
                        options={TM_COMPONENT_TYPES}
                        info={TM_INFO_COMPONENT_TYPE}
                      />
                    </TableHead>
                    <TableHead>
                      Trust Level
                      <EnumInfo
                        title="Trust Level"
                        options={TM_TRUST_LEVELS}
                        info={TM_INFO_TRUST}
                      />
                    </TableHead>
                    <TableHead>
                      Exposure
                      <EnumInfo
                        title="Exposure"
                        options={TM_EXPOSURES}
                        info={TM_INFO_EXPOSURE}
                      />
                    </TableHead>
                    <TableHead>
                      AuthN
                      <EnumInfo
                        title="Authentication"
                        options={TM_AUTHN_OPTIONS}
                        info={TM_INFO_AUTHN}
                      />
                    </TableHead>
                    <TableHead>
                      AuthZ
                      <EnumInfo
                        title="Authorization"
                        options={TM_AUTHZ_OPTIONS}
                        info={TM_INFO_AUTHZ}
                      />
                    </TableHead>
                    <TableHead className="w-12 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredComponents.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No components.{" "}
                        {apiEnabled ? (
                          <>
                            Click{" "}
                            <span className="font-medium text-foreground">
                              Auto-discover with AI
                            </span>{" "}
                            or{" "}
                            <span className="font-medium text-foreground">
                              Add Component
                            </span>
                            .
                          </>
                        ) : (
                          <>
                            Load an assessment above or click{" "}
                            <span className="font-medium text-foreground">
                              Add Component
                            </span>
                            .
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredComponents.map((c) => {
                      const isChecked = selectedCompIds.includes(c.id)
                      return (
                        <React.Fragment key={c.id}>
                        <TableRow
                          data-state={isChecked ? "selected" : undefined}
                          className="border-b-0"
                        >
                          <TableCell className="text-center">
                            <Checkbox
                              aria-label={`Select ${c.name}`}
                              checked={isChecked}
                              onCheckedChange={() =>
                                handleToggleComponentSelection(c.id)
                              }
                            />
                          </TableCell>
                          <TableCell className="max-w-xs whitespace-normal align-top">
                            <div className="flex items-start gap-2.5">
                              <div className="mt-0.5 grid size-7 place-items-center rounded-md border bg-muted/40">
                                {componentTypeIcon(c.type)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <Input
                                  value={c.name}
                                  onChange={(e) =>
                                    updateComponentField(c.id, "name", e.target.value)
                                  }
                                  className="h-7 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none hover:bg-muted/40 focus-visible:bg-background focus-visible:ring-1"
                                />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={c.type}
                              onValueChange={(v) =>
                                updateComponentField(c.id, "type", v as TMComponentType)
                              }
                            >
                              <SelectTrigger size="sm" className="h-7 w-[130px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TM_COMPONENT_TYPES.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={c.trustLevel}
                              onValueChange={(v) =>
                                updateComponentField(
                                  c.id,
                                  "trustLevel",
                                  v as TMTrustLevel
                                )
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className={cn(
                                  "h-7 w-[120px] text-xs font-semibold",
                                  getTMTrustClass(c.trustLevel)
                                )}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TM_TRUST_LEVELS.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={c.exposure}
                              onValueChange={(v) =>
                                updateComponentField(c.id, "exposure", v as TMExposure)
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className={cn(
                                  "h-7 w-[130px] text-xs font-semibold",
                                  getTMExposureClass(c.exposure)
                                )}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TM_EXPOSURES.map((ex) => (
                                  <SelectItem key={ex} value={ex}>
                                    {ex}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={c.authn}
                              onValueChange={(v) =>
                                updateComponentField(c.id, "authn", v as TMAuthN)
                              }
                            >
                              <SelectTrigger size="sm" className="h-7 w-36 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TM_AUTHN_OPTIONS.map((a) => (
                                  <SelectItem key={a} value={a}>
                                    {a}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={c.authz}
                              onValueChange={(v) =>
                                updateComponentField(c.id, "authz", v as TMAuthZ)
                              }
                            >
                              <SelectTrigger size="sm" className="h-7 w-40 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TM_AUTHZ_OPTIONS.map((a) => (
                                  <SelectItem key={a} value={a}>
                                    {a}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => deleteComponent(c.id)}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Delete ${c.name}`}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow
                          data-state={isChecked ? "selected" : undefined}
                          className="hover:bg-transparent"
                        >
                          <TableCell />
                          <TableCell colSpan={6} className="pt-0 align-top">
                            <Label
                              htmlFor={`comp-desc-${c.id}`}
                              className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              <FileText className="size-3" />
                              Description
                            </Label>
                            <Textarea
                              id={`comp-desc-${c.id}`}
                              value={c.desc}
                              onChange={(e) =>
                                updateComponentField(c.id, "desc", e.target.value)
                              }
                              rows={4}
                              placeholder="Describe this component — purpose, data handled, dependencies, ownership, anything threat-relevant…"
                              className="min-h-[120px] w-full resize-y border-border/60 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-foreground/90 shadow-none focus-visible:bg-background focus-visible:ring-1"
                            />
                          </TableCell>
                          <TableCell />
                        </TableRow>
                        </React.Fragment>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          <Separator />

          {/* TRUST BOUNDARIES SECTION */}
          <section className="space-y-3">
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-0.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Layers className="size-4 text-primary" /> Trust Boundaries
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Logical trust zones (VPCs, accounts, clusters, namespaces, tiers).
                  Components belong to one boundary.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={envSearch}
                    onChange={(e) => setEnvSearch(e.target.value)}
                    placeholder="Search trust boundaries…"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Button type="button" size="sm" onClick={() => setShowAddEnvModal(true)}>
                  <Plus /> Add Trust Boundary
                </Button>
              </div>
            </div>

            {selectedEnvIds.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-7 place-items-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                    <CheckSquare className="size-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold leading-none">
                      {selectedEnvIds.length} trust boundaries selected
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Batch update trust type or remove entries.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        Set Type <ChevronDown className="text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Environment Type</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {TM_ENVIRONMENT_TYPES.map((t) => (
                        <DropdownMenuItem
                          key={t}
                          onClick={() => handleBulkEnvTypeChange(t)}
                        >
                          {t}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkEnvDelete}
                  >
                    <Trash /> Delete
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedEnvIds([])}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-10 text-center">
                      <Checkbox
                        aria-label="Select all trust boundaries"
                        checked={envHeaderState}
                        onCheckedChange={handleSelectAllEnvironments}
                      />
                    </TableHead>
                    <TableHead>Trust Boundary</TableHead>
                    <TableHead>
                      Type
                      <EnumInfo
                        title="Trust Boundary Type"
                        options={TM_ENVIRONMENT_TYPES}
                        info={TM_INFO_ENV_TYPE}
                      />
                    </TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-40">Components</TableHead>
                    <TableHead className="w-12 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEnvironments.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No trust boundaries. Click{" "}
                        <span className="font-medium text-foreground">
                          Auto-discover with AI
                        </span>{" "}
                        to regenerate, or add one with{" "}
                        <span className="font-medium text-foreground">
                          Add Trust Boundary
                        </span>
                        .
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEnvironments.map((env) => {
                      const isChecked = selectedEnvIds.includes(env.id)
                      const memberSet = new Set(env.memberComponents)
                      return (
                        <TableRow
                          key={env.id}
                          data-state={isChecked ? "selected" : undefined}
                        >
                          <TableCell className="text-center">
                            <Checkbox
                              aria-label={`Select ${env.name}`}
                              checked={isChecked}
                              onCheckedChange={() =>
                                handleToggleEnvironmentSelection(env.id)
                              }
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <Input
                              value={env.name}
                              onChange={(e) =>
                                updateEnvironmentField(env.id, "name", e.target.value)
                              }
                              className="h-7 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none hover:bg-muted/40 focus-visible:bg-background focus-visible:ring-1"
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={env.type}
                              onValueChange={(v) =>
                                updateEnvironmentField(
                                  env.id,
                                  "type",
                                  v as TMEnvironmentType
                                )
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className={cn(
                                  "h-7 w-[140px] text-xs font-semibold",
                                  getTMEnvClass(env.type)
                                )}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TM_ENVIRONMENT_TYPES.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top">
                            <Textarea
                              value={env.desc}
                              onChange={(e) =>
                                updateEnvironmentField(env.id, "desc", e.target.value)
                              }
                              rows={2}
                              placeholder="Describe this trust boundary (VPC, account, region, namespace…)"
                              className="min-h-12 resize-none border-transparent bg-transparent px-1 py-1 text-[11px] text-muted-foreground shadow-none hover:bg-muted/40 focus-visible:bg-background focus-visible:ring-1"
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-full justify-between text-xs"
                                >
                                  <span className="truncate">
                                    {memberSet.size} of {components.length}
                                  </span>
                                  <ChevronDown className="text-muted-foreground" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="max-h-72 w-64 overflow-y-auto"
                              >
                                <DropdownMenuLabel className="text-[11px]">
                                  Components in &ldquo;{env.name}&rdquo;
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {components.length === 0 ? (
                                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                                    No components yet.
                                  </div>
                                ) : (
                                  components.map((comp) => (
                                    <DropdownMenuCheckboxItem
                                      key={comp.id}
                                      checked={memberSet.has(comp.id)}
                                      onCheckedChange={() =>
                                        toggleEnvMember(env.id, comp.id)
                                      }
                                      onSelect={(e) => e.preventDefault()}
                                      className="text-xs"
                                    >
                                      <span className="flex min-w-0 items-center gap-2">
                                        {componentTypeIcon(comp.type)}
                                        <span className="truncate">
                                          {comp.name || comp.id}
                                        </span>
                                      </span>
                                    </DropdownMenuCheckboxItem>
                                  ))
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => deleteEnvironment(env.id)}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Delete ${env.name}`}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </CardContent>

        {/* ADD COMPONENT DIALOG */}
        <Dialog open={showAddCompModal} onOpenChange={setShowAddCompModal}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Register Component</DialogTitle>
              <DialogDescription>
                Add a custom component to the inventory. Manual entries survive Mermaid
                re-syncs.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={addComponentHandler} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-name">Component Name</Label>
                <Input
                  id="tm-new-comp-name"
                  required
                  value={newComp.name}
                  onChange={(e) => setNewComp({ ...newComp, name: e.target.value })}
                  placeholder="e.g., custom-vault-hsm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tm-new-comp-env">Trust Boundary</Label>
                  <Input
                    id="tm-new-comp-env"
                    list="tm-env-options"
                    value={newComp.environment}
                    onChange={(e) =>
                      setNewComp({ ...newComp, environment: e.target.value })
                    }
                    placeholder="e.g., VPC-prod / k8s-cluster-1"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Choose an existing environment or type a new one to register it.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tm-new-comp-type" className="flex items-center">
                    Component Type
                    <EnumInfo
                      title="Component Type"
                      options={TM_COMPONENT_TYPES}
                      info={TM_INFO_COMPONENT_TYPE}
                    />
                  </Label>
                  <Select
                    value={newComp.type}
                    onValueChange={(v) =>
                      setNewComp({ ...newComp, type: v as TMComponentType })
                    }
                  >
                    <SelectTrigger id="tm-new-comp-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TM_COMPONENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tm-new-comp-trust" className="flex items-center">
                    Trust Level
                    <EnumInfo
                      title="Trust Level"
                      options={TM_TRUST_LEVELS}
                      info={TM_INFO_TRUST}
                    />
                  </Label>
                  <Select
                    value={newComp.trustLevel}
                    onValueChange={(v) =>
                      setNewComp({ ...newComp, trustLevel: v as TMTrustLevel })
                    }
                  >
                    <SelectTrigger id="tm-new-comp-trust">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TM_TRUST_LEVELS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tm-new-comp-exposure" className="flex items-center">
                    Exposure
                    <EnumInfo
                      title="Exposure"
                      options={TM_EXPOSURES}
                      info={TM_INFO_EXPOSURE}
                    />
                  </Label>
                  <Select
                    value={newComp.exposure}
                    onValueChange={(v) =>
                      setNewComp({ ...newComp, exposure: v as TMExposure })
                    }
                  >
                    <SelectTrigger id="tm-new-comp-exposure">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TM_EXPOSURES.map((ex) => (
                        <SelectItem key={ex} value={ex}>
                          {ex}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tm-new-comp-authn" className="flex items-center">
                    <KeyRound className="mr-1 size-3.5 text-muted-foreground" />
                    Authentication
                    <EnumInfo
                      title="Authentication (AuthN)"
                      options={TM_AUTHN_OPTIONS}
                      info={TM_INFO_AUTHN}
                    />
                  </Label>
                  <Select
                    value={newComp.authn}
                    onValueChange={(v) =>
                      setNewComp({ ...newComp, authn: v as TMAuthN })
                    }
                  >
                    <SelectTrigger id="tm-new-comp-authn">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TM_AUTHN_OPTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tm-new-comp-authz" className="flex items-center">
                    <Fingerprint className="mr-1 size-3.5 text-muted-foreground" />
                    Authorization
                    <EnumInfo
                      title="Authorization (AuthZ)"
                      options={TM_AUTHZ_OPTIONS}
                      info={TM_INFO_AUTHZ}
                    />
                  </Label>
                  <Select
                    value={newComp.authz}
                    onValueChange={(v) =>
                      setNewComp({ ...newComp, authz: v as TMAuthZ })
                    }
                  >
                    <SelectTrigger id="tm-new-comp-authz">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TM_AUTHZ_OPTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tm-new-comp-desc">Description</Label>
                <Textarea
                  id="tm-new-comp-desc"
                  rows={3}
                  value={newComp.desc}
                  onChange={(e) => setNewComp({ ...newComp, desc: e.target.value })}
                  placeholder="Summarize the core security properties of this component…"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddCompModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Confirm Registration</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ADD TRUST BOUNDARY DIALOG */}
        <Dialog open={showAddEnvModal} onOpenChange={setShowAddEnvModal}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Register Trust Boundary</DialogTitle>
              <DialogDescription>
                Define a logical trust zone (VPC, account, cluster, namespace, tier)
                and pick which components live inside it.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={addEnvironmentHandler} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tm-new-env-name">Trust Boundary Name</Label>
                <Input
                  id="tm-new-env-name"
                  required
                  value={newEnv.name}
                  onChange={(e) => setNewEnv({ ...newEnv, name: e.target.value })}
                  placeholder="e.g., VPC-prod-us-east-1 / k8s-cluster-payments"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tm-new-env-type" className="flex items-center">
                  Trust Type
                  <EnumInfo
                    title="Trust Boundary Type"
                    options={TM_ENVIRONMENT_TYPES}
                    info={TM_INFO_ENV_TYPE}
                  />
                </Label>
                <Select
                  value={newEnv.type}
                  onValueChange={(v) =>
                    setNewEnv({ ...newEnv, type: v as TMEnvironmentType })
                  }
                >
                  <SelectTrigger id="tm-new-env-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TM_ENVIRONMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  External = internet-facing, Semi-Trusted = DMZ/perimeter, Internal =
                  private, Restricted = CDE/PCI/secrets.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tm-new-env-desc">Description</Label>
                <Textarea
                  id="tm-new-env-desc"
                  rows={3}
                  value={newEnv.desc}
                  onChange={(e) => setNewEnv({ ...newEnv, desc: e.target.value })}
                  placeholder="Account ID, region, CIDR, owner team, compliance tags…"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Components in this Trust Boundary</Label>
                  <span className="text-[10px] text-muted-foreground">
                    {newEnv.memberComponents.length} of {components.length} selected
                  </span>
                </div>
                {components.length === 0 ? (
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    No components yet. Add components first, then assign them here.
                  </p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/10 p-2">
                    {components.map((comp) => {
                      const checked = newEnv.memberComponents.includes(comp.id)
                      return (
                        <label
                          key={comp.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              const isChecked = v === true
                              setNewEnv((prev) => ({
                                ...prev,
                                memberComponents: isChecked
                                  ? [...prev.memberComponents, comp.id]
                                  : prev.memberComponents.filter((id) => id !== comp.id),
                              }))
                            }}
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            {componentTypeIcon(comp.type)}
                            <span className="truncate font-medium">
                              {comp.name || comp.id}
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {comp.type}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  A component can only belong to one trust boundary. Checking it here
                  moves it from any previous boundary.
                </p>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddEnvModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Confirm Trust Boundary</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Shared <datalist> for environment autocomplete across inputs */}
        <datalist id="tm-env-options">
          {knownEnvironmentNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Card>
    </TooltipProvider>
  )
}

export default ThreatModelInventory
