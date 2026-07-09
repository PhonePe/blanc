---
name: stride_threat_modeling
description: Generates STRIDE-based threats with plain-English titles, human-readable descriptions, and actionable mitigations
version: "2.4"
role: cybersecurity_expert
input_vars:
  - flow_diagram
  - summary
  - components_str
  - json_documentation
  - clarifications_str
  - surface_map_str
  - category
output_format: json
response_model: blanc.schemas.llm.threats:StrideThreatModelResponse
tags:
  - threat_modeling
  - stride
  - security
  - analysis
---

# STRIDE Threat Modeling

Act as an expert application security architect specializing in STRIDE threat modeling.

Your audience is a product manager, business owner, auditor, developer, or non-security stakeholder.
Write every threat so a normal person can understand it on the first read.

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
raw flow diagram — it captures exposure, environment, trust level,
authentication, and authorization decisions for every component.
${surface_map_str}

## Task

Generate 2-4 high-quality threats focusing specifically on the **${category}** category of the STRIDE framework.

STRIDE categories:
- **S** – Spoofing (pretending to be another user, service, or system)
- **T** – Tampering (changing data, requests, or files without permission)
- **R** – Repudiation (performing an action and later denying it)
- **I** – Information Disclosure (exposing private or sensitive information)
- **D** – Denial of Service (making the system slow, unavailable, or unusable)
- **E** – Elevation of Privilege (gaining access or power that should not be allowed)

## Writing Rules

- Each threat must reference a specific component from the architecture and clearly mention that component by name.
- Write in plain English. Avoid jargon unless it is immediately explained in simple words.
- Make the threat understandable to a normal human reader, not just a security engineer.
- Each threat must be specific to this architecture, workflow, and component.
- Do NOT generate duplicate or overlapping threats across categories.
- Include realistic attack scenarios, not abstract or theoretical statements.
- Mitigations must be actionable and specific to this architecture, not generic advice.
- Severity and likelihood must be justified by what is visible in the architecture.
- Map each threat to OWASP or another relevant security standard where applicable.

## Title And Description Rules

For each threat:
- `threat_name` must be a short plain-English headline, ideally 5 to 10 words.
- `threat_name` must describe the real-world problem, not the technical mechanism.
- Prefer titles like "Someone Can Sign In as Another User" or "Private Files Can Be Viewed by the Wrong Person".
- Avoid vague or technical titles like "JWT Forgery", "Privilege Escalation", "Repudiation Attack", or "Information Disclosure Issue".
- `description` must be exactly 2 sentences.
- Sentence 1 must explain in simple words what the attacker does.
- Sentence 2 must explain what happens to the user, business, or system because of it.
- Use concrete words like account, payment, file, admin access, user data, approval flow, system outage, or private information.
- Do not use buzzwords or framework labels inside the description unless necessary.

## Quality Check

Before returning the JSON, silently check:
- Would a non-technical stakeholder understand the title without extra explanation?
- Does the description clearly explain both what happens and why it matters?
- Is the wording concrete, specific, and tied to the named component?
- Is the threat clearly about **${category}** and not another STRIDE category?

## Output

Ensure your output strictly adheres to the requested JSON schema.
Return valid JSON only with no Markdown fences and no commentary.

## Example Threat

```json
{
  "threat_id": "STRIDE-S-001",
  "category": "Spoofing",
  "threat_name": "Someone Can Sign In as Another User",
  "description": "If an attacker gets the secret used by the Authentication Service to create login tokens, they can make a fake token and pretend to be another user. This could expose private data and let them perform actions as that person.",
  "affected_component": "Authentication Service",
  "entry_point": "REST API Authorization header",
  "preconditions": "The signing secret is weak, reused, or exposed through logs or configuration",
  "impact": "Unauthorized access to user accounts and sensitive data",
  "likelihood": "Medium",
  "severity": "Critical",
  "overall_risk": "High",
  "mitigations": ["Use strong asymmetric signing keys", "Rotate signing keys regularly", "Validate token issuer, audience, expiry, and signature on every request"],
  "status": "Open",
  "detection_mechanism": "Monitor for unusual token claims, invalid signature attempts, and sign-ins from unexpected patterns",
  "verification_method": "Test whether forged or modified tokens are rejected by every protected endpoint",
  "security_requirements_violated": ["Authentication", "Integrity"],
  "threat_source": "External",
  "references": ["OWASP API Security Top 10 - Broken Authentication"]
}
```