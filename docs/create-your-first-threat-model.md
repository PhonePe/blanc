## Create your Threat Model

This walkthrough takes you from a blank dashboard to an approved threat model. It assumes your admin has already [onboarded your organization](onboard-your-organization.md) and that the API and studio are both running.

## 1. Sign in

Open the studio at [http://localhost:3000](http://localhost:3000) and sign in with the account seeded during onboarding. If Google OAuth is configured in `docker.yml`, you can also sign in through Google.

## 2. Start a new assessment

From the dashboard, go to **Assessments → New Assessment**. Blanc will ask how you want to provide your design:

* **Upload existing diagrams** - bring PNG, JPG, or PDF architecture / sequence diagrams you already have.
* **Draw in Blanc Studio** - sketch a diagram directly in Blanc Studio and hand the resulting Mermaid to the pipeline.

### Assessment metadata

Regardless of which input mode you pick, you'll fill in a few fields that scope the assessment:

| Field                | Purpose                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| **Assessment type**  | `SECURITY` (default) or `COMPLIANCE`.                                                       |
| **Framework**        | `STRIDE` (default) or `BUSINESS_LOGIC`. Additional frameworks (PASTA, …) are on the roadmap. |
| **Diagram type**     | `flowchart TD`, `sequenceDiagram`, or `C4Context` - the value is the Mermaid header string. Blanc's downstream parser also recognises `C4Container`, `C4Component`, `classDiagram`, `stateDiagram`, and `erDiagram` from user-provided Mermaid, even though those aren't in the `DiagramType` enum. |
| **App / Team**       | The application and team the design belongs to.                                             |
| **Feature + version**| The feature under review and its version, for change-tracking over time.                    |
| **Interface / OS**   | Web / Mobile, and the target OS where relevant.                                             |

You can also attach **supporting PDFs** (PRDs, BRDs, RFCs, design docs). Blanc ingests these into the RAG store and uses them to answer clarification questions later in the pipeline. If a source PDF contains multiple diagrams, use `POST /assessment/extract-pdf-images` beforehand to cherry-pick which embedded images to ingest.

## 3. Watch the pipeline run

Once you submit, the assessment enters the `PROCESSING` state and moves through Blanc's six-stage pipeline. You'll see the current stage update live on the assessment detail page - the API returns the `AssessmentStage` enum verbatim (SCREAMING_SNAKE_CASE) so you can hard-code the values if you're integrating:

1. **`INITIALIZING`** - the assessment record is created and queued.
2. **`IMAGE_PROCESSING`** - for image mode, the vision LLM produces a Mermaid data-flow diagram per image. Mermaid mode skips this step.
3. **`SUMMARIZING`** - an analysis summary of what the diagram represents.
4. **`COMPONENT_ANALYSIS`** - the component inventory and trust boundaries (the **surface map**).
5. **`CLARIFICATION`** - framework-agnostic questions about auth, transport, exposure, environment, and data sensitivity. Blanc auto-answers as many as it can from your onboarding responses and the RAG store.
6. **`THREAT_MODELING`** - per-framework threat generation (STRIDE or Business Logic) using the merged image data plus your answers.

Every LLM call is logged with token counts and cost, so you can audit spend per assessment from the **LLM Usage** view (`/dashboard/threat/llm-usage` in the UI, `GET /llm-usage/{assessment_id}` on the API).

### Two-phase gating

Blanc pauses per-image at the end of Phase A (mermaid + surface-map inventory) in the `AWAITING_REVIEW` **image state** so you can review and edit the extracted diagram and inventory before the expensive downstream stages run. Hit **Continue** on the image (or `POST /assessment/{id}/images/{image_id}/continue`) to move it into Phase B (summary + clarification + threat modeling). Use `POST /assessment/{id}/continue` to advance all images at once.

## 4. Answer clarification questions

If Blanc cannot auto-answer everything, the assessment moves into `NEEDS_INPUT` and surfaces the remaining questions. For each one:

* Read the question and, if you like, the suggested defaults.
* Provide an answer.
* Optionally, edit the Mermaid diagram or the surface-map inventory inline if the vision model got a component wrong.

When you save and continue, Blanc merges your answers back into the assessment context and resumes the pipeline at the threat-modeling stage. You can also trigger a fresh auto-answer pass per image with `POST /assessment/{id}/images/{image_id}/auto-answer`, and retry a failed image or the whole assessment via `POST /assessment/{id}/images/{image_id}/retry` and `POST /assessment/{id}/retry-analysis` respectively.

## 5. Review the threats

When the pipeline finishes, the assessment moves to `REVIEW`. Assign reviewers via `POST /reviews/{assessment_id}/assign-reviewers` - assigned reviewers see the assessment under **Assessments under review** and can act on each threat. Each threat carries full provenance - the component or flow it applies to, the framework category (e.g. STRIDE `Tampering`), a rationale, and the LLM prompt that produced it.

You (or your assigned reviewers) can:

* **Approve** a threat to keep it in the final report.
* **Reject** a threat that doesn't apply.
* **Attach a single review comment** per threat (`POST /reviews/{assessment_id}/threats/{threat_id}/review`). Threaded comments are not supported today; a subsequent call overwrites the previous comment.

## 6. Close out the assessment

Approval rules differ between the two endpoints - pick the one that matches your team's policy:

* **`POST /reviews/{id}/submit-review`** - all-must-approve. The assessment only flips to `APPROVED` once *every* assigned reviewer's status is `APPROVED`. A single `REJECTED` review moves it to `CHANGES_REQUESTED`.
* **`POST /reviews/{id}/approve`** - shortcut. Any *one* assigned reviewer's approval alone is enough to move the assessment to `APPROVED`.

Once approved, an assessment can be exported as:

* **CSV** - one row per threat, for import into ticketing systems or spreadsheets. `GET /threat_modeling/{assessment_id}/export`.
* **PDF** - audit- and compliance-ready. `GET /threat_modeling/{assessment_id}/export/pdf`.

## Where to go next

* **[Onboard your organization](onboard-your-organization.md)** - improve auto-answer coverage so clarification is faster on the next assessment.
* **[Design Principles](design-principles.md)** - understand *why* Blanc structures threat modeling the way it does.
* **[Roadmap](roadmap.md)** - see what's coming next.
