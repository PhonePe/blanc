"use client";

import { Scale } from "lucide-react";

import {
  FooterPill,
  PageHero,
  PageShell,
} from "@/components/dashboard-shell";
import { KBUploadCard, KB_REGISTRY } from "@/components/rag-kb-card";

export default function ComplianceRagPage() {
  const kb = KB_REGISTRY.compliance_related_knowledgebase;

  return (
    <PageShell accent="emerald" maxWidth="6xl">
      <PageHero
        icon={Scale}
        title="Regulator Guard"
        description="Upload legal frameworks, audit logs, GDPR/ISO/SOC standards, and regulatory requirements to keep the compliance RAG corpus fresh."
      />

      <div className="space-y-6">
        <KBUploadCard kb={kb} />
      </div>

      <FooterPill label="Blanc RAG · Compliance" tone="emerald" />
    </PageShell>
  );
}
