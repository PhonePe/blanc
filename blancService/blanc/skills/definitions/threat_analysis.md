---
name: threat_analysis
description: Generates threats for a specific category of a threat modeling framework
version: "1.2"
role: cybersecurity_expert
input_vars:
  - system_role
  - flow_diagram
  - summary
  - components_str
  - json_documentation
  - clarifications_str
  - surface_map_str
  - category
  - framework_name
output_format: json
tags:
  - threat_modeling
  - analysis
  - security
---

# Threat Analysis

${system_role}

Make sure the threats are in layman's terms and easily understandable by non-security stakeholders.

## Architecture Context

### 1. Flow Diagram
${flow_diagram}

### 2. Summary
${summary}

### 3. Components
${components_str}

### 4. Documentation
${json_documentation}

### 5. Clarifications
${clarifications_str}

### 6. Surface Map (Authoritative Inventory)
The user-curated inventory of components, trust boundaries, and
environments. Treat this as the source of truth when it conflicts with the
raw flow diagram.
${surface_map_str}

## Task

Generate 2-4 high-quality threats focusing specifically on the **${category}** category of the ${framework_name} framework.

## Rules

- Each threat must reference a specific component from the architecture above
- Describe threats in plain language — avoid jargon a developer wouldn't understand
- Mitigations must be actionable and specific to this architecture, not generic security advice
- Severity and likelihood must be justified by what's visible in the architecture
- Do NOT generate duplicate or overlapping threats
- Focus on realistic, exploitable scenarios — not theoretical edge cases

## Output

Ensure your output strictly adheres to the requested JSON schema. Return valid JSON only — no Markdown fences, no commentary.
