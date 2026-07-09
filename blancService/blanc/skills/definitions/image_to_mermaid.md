---
name: image_to_mermaid
description: Converts architecture diagram images into Mermaid.js diagrams
version: "1.4"
role: system_architecture_analyst
input_vars:
  - diagram_type
output_format: mermaid_code
response_model: blanc.schemas.llm.analysis:MermaidResponse
tags:
  - analysis
  - diagram
  - mermaid
  - vision
---

# Image to Mermaid Diagram

Analyze the provided architecture image and convert it into a **${diagram_type}** Mermaid.js diagram.

## Instructions

1. **Diagram Type**: You MUST use **${diagram_type}** as the diagram type. Do not use any other type.
2. **Faithfulness**: Only include components, actors, messages, and trust boundaries that are actually visible in the image.
3. **No Guessing**: If a label or interaction is not readable, omit it instead of approximating it.
4. **Components**: Represent all components as nodes. Use clear, descriptive labels.
5. **Subgraphs**: Use `subgraph` to group related components (e.g., clusters, services, external systems).
6. **External Systems**: Represent third-party or external systems clearly.
7. **Trust Boundaries**: Optionally indicate trust boundaries with subgraphs or annotations.
8. **Message/Label Safety**: Keep edge labels on a single physical line. Do not insert raw line breaks inside one edge/message statement.
9. **Special Characters**: Escape `<` and `>` as `&lt;` and `&gt;` inside labels/messages.
10. **Sequence Messages**: For long sequence messages, either keep them single-line or split into multiple messages instead of embedding raw newlines.

## Output Rules

- The `mermaid` field must contain only valid Mermaid.js code starting with **${diagram_type}**.
- Never put explanations, apologies, upload instructions, or refusals inside the `mermaid` field.
- Do not include unresolved placeholders like `<ID>`; write `ID` or escape as `&lt;ID&gt;`.

## Examples

### Flowchart (use when diagram_type is "flowchart TD")

```
flowchart TD
  A[User] -->|uploads file| B[Web Server]
  B --> C[Temporary Storage]
  C --> D[Virus Scan Service]
  D --> E[Database]
  subgraph OPSWAT_Service
      F1[External Scanner]
      F2[Threat Intel]
  end
  D --> OPSWAT_Service
```

### Sequence Diagram (use when diagram_type is "sequenceDiagram")

```
sequenceDiagram
    participant U as User
    participant W as Web Server
    participant S as Storage
    participant V as Virus Scanner
    participant DB as Database
    U->>W: Upload file
    W->>S: Store temporarily
    S->>V: Scan file
    V->>DB: Store result
    V-->>W: Return scan status
    W-->>U: Upload result
```

### C4 Context (use when diagram_type is "C4Context")

```
C4Context
    title System Context Diagram
    Person(user, "User", "Uploads files for scanning")
    System(webApp, "Web Application", "Handles uploads and displays results")
    System(scanner, "Virus Scan Service", "Scans files for threats")
    System_Ext(opswat, "OPSWAT", "External threat intelligence")
    SystemDb(db, "Database", "Stores scan results")

    Rel(user, webApp, "Uploads files")
    Rel(webApp, scanner, "Sends files for scanning")
    Rel(scanner, opswat, "Queries threat intel")
    Rel(scanner, db, "Stores results")
```
