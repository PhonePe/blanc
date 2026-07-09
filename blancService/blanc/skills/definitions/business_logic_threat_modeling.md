---
name: business_logic_threat_modeling
description: Identifies business logic vulnerabilities with plain-English titles, human-readable descriptions, and workflow-specific mitigations
version: "1.3"
role: application_security_auditor
input_vars:
  - flow_diagram
  - summary
  - components_str
  - json_documentation
  - clarifications_str
  - surface_map_str
  - category
output_format: json
response_model: blanc.schemas.llm.threats:BusinessLogicThreatModelResponse
tags:
  - threat_modeling
  - business_logic
  - owasp
  - security
---

# Business Logic Threat Modeling

Act as an expert Application Security Auditor specializing in business logic vulnerabilities and workflow abuse.

Your audience is a product manager, business owner, auditor, developer, or non-security stakeholder.
Write every threat so a normal person can understand it on the first read.

Do not focus on standard technical bugs like SQL injection or cross-site scripting.
Instead, analyze how a legitimate user or insider could misuse the intended workflow, skip required steps, repeat actions, abuse timing gaps, or manipulate states for unfair gain.

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
authentication, and authorization decisions for every component and the
allowed cross-boundary protocols.
${surface_map_str}

## Task

Generate 2-4 high-quality threats focusing specifically on the **${category}** category of business logic vulnerabilities.

Business Logic categories:
- **Lifecycle & Orphaned Transitions** — processes that leave records, requests, or transactions in invalid states
- **Sequential State Bypass** — skipping required steps in a multi-step workflow
- **Missing Roles and Permission Checks** — actions allowed without the right business approval or ownership check
- **Replays of Idempotency Operations** — repeating a valid action to gain extra benefit
- **Race Condition and Concurrency** — exploiting timing gaps between checks and updates
- **Resource Quota Violations** — exceeding intended limits through workflow abuse

## Writing Rules

- Focus on how a legitimate authenticated user, insider, or partner could abuse the system's intended behavior.
- Each threat must describe a specific workflow or state transition that can be exploited.
- Each threat must reference a specific component from the architecture and clearly mention that component by name.
- Describe the exact sequence of user actions or system steps that make the abuse possible.
- Do NOT include standard technical vulnerabilities such as SQLi, XSS, or CSRF.
- Think about what happens when steps are skipped, repeated, done out of order, done too quickly, or done at the same time.
- Mitigations must be architectural and workflow-specific, not generic advice.

## Title And Description Rules

For each threat:
- `threat_name` must be a short plain-English headline, ideally 5 to 10 words.
- `threat_name` must describe the real-world business abuse, not a security label.
- Prefer titles like "A User Can Confirm an Order Without Paying" or "The Same Refund Can Be Claimed More Than Once".
- Avoid vague or technical titles like "State Bypass", "Race Condition", or "Missing Authorization Check".
- `description` must be exactly 2 sentences.
- Sentence 1 must explain in simple words what the abusive user does.
- Sentence 2 must explain what happens to the business, users, or workflow because of it.
- Use concrete words like refund, payment, approval, account, booking, order, invoice, balance, quota, or shipment.
- Make the description sound like a clear business abuse scenario, not a security report.

## Quality Check

Before returning the JSON, silently check:
- Would a non-technical stakeholder understand the title without extra explanation?
- Does the description clearly explain both the abuse step and the business consequence?
- Is the threat tied to the named component and actual workflow?
- Is the threat clearly about **${category}** and not a generic technical bug?

## Output

Ensure your output strictly adheres to the requested JSON schema.
Return valid JSON only with no Markdown fences and no commentary.

## Example Threat

```json
{
  "category": "Sequential State Bypass",
  "threat_name": "A User Can Confirm an Order Without Paying",
  "description": "A user can call the final order confirmation step in the Order Service without completing the payment step first. This could let goods or services be released without payment and cause direct financial loss.",
  "affected_component": "Order Service",
  "entry_point": "Order confirmation API endpoint",
  "preconditions": "The server does not verify that payment was completed before confirming the order",
  "impact": "Financial loss and invalid order state",
  "likelihood": "High",
  "severity": "Critical",
  "mitigations": ["Enforce server-side state transitions so only paid orders can be confirmed", "Store and validate the required business state before every workflow transition"],
  "status": "Open"
}
```
