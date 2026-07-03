"use client";

import { ShieldCheck } from "lucide-react";

import {
  FooterPill,
  PageHero,
  PageShell,
} from "@/components/dashboard-shell";
import { KBUploadCard, KB_REGISTRY } from "@/components/rag-kb-card";

export default function SecurityRagPage() {
  const kb = KB_REGISTRY.security_related_knowledgebase;

  return (
    <PageShell accent="rose" maxWidth="6xl">
      <PageHero
        icon={ShieldCheck}
        title="Security Shield"
        description="Upload security protocols, threat models, network architecture, and vulnerability reports to keep the security RAG corpus fresh."
      />

      <div className="space-y-6">
        <KBUploadCard kb={kb} />
      </div>

      <FooterPill label="ATM RAG · Security" tone="rose" />
    </PageShell>
  );
}
