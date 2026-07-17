## Onboarding

Before you can create your first threat model, an admin needs to onboard your organization into Blanc.

Onboarding is a *one-time* setup that captures how your organization is structured, what platforms and cloud providers you use, and which security controls apply by default. These answers are stored per organization and consumed by the **clarification stage** during every subsequent assessment - Blanc consults them (alongside the RAG store) to auto-answer as many clarification questions as it can before surfacing the rest to you.

## Who can onboard

The onboarding UI is gated to the `ADMIN` role. `admin_users` in `docker.yml` (or `config.yml` for local runs) is the authoritative source of that role - every login recomputes the user's role from the current list.

```yaml
# blancService/blanc/config/docker.yml
admin_users:
  - "admin@example.com"
```

To grant additional admins, add their emails to `admin_users` and either restart the API or call `POST /admin/reload_config` as an existing admin (the endpoint re-reads the YAML into the process cache). There is no in-app promote-to-admin flow today.

## The onboarding flow

Navigate to **Dashboard → Onboarding**. You will see two entry points:

* **Create a new organization** - start a fresh onboarding for an org that doesn't yet exist in Blanc.
* **Resume an existing organization** - pick up where you left off. Progress is saved per category, so you can complete onboarding across multiple sessions.

### 1. Create your organization

Give the organization a name. Blanc creates the org record and loads the set of `ORG`-scoped onboarding questions grouped by category.

### 2. Answer the category questions

Onboarding questions are grouped into categories (for example: cloud environment, identity, data classification, compliance posture). Each category shows:

* Total questions in the category
* How many you have answered
* A per-category completion percentage

Answer each question and save the category. Blanc persists the responses and updates the organization's overall onboarding progress. You can leave and come back at any point - an unanswered category simply stays at partial completion.

### 3. Track overall progress

The header shows an aggregate completion percentage across all categories for the organization. There is no hard gate that forces you to *finish* onboarding before creating assessments, but the more categories you complete, the fewer clarification questions Blanc needs to ask you during each assessment.

## What Blanc does with your answers

Every onboarding response you save is attached to future assessments for the org as **`org_context`** (and `app_context`, for app-scoped onboarding). That context is passed to the LLM at two points in the pipeline:

1. **Auto-answering clarification questions.** Blanc generates a set of security-focused clarification questions per assessment using the shipped prompt template at `blancService/blanc/skills/definitions/clarification_questions.md`. It then attempts to answer each one using your `org_context` + `app_context` + the RAG store, driven by `blancService/blanc/skills/definitions/auto_answer_clarification.md`. Only the questions it can't answer are surfaced to you.
2. **Generating threats.** The enriched surface map (with your onboarding context baked in) is passed to the STRIDE / Business Logic threat generators, so the threats reflect your organization's real posture - cloud environment, identity providers, compliance regime, data classification, etc.

The more categories you complete, the fewer questions Blanc has to ask you and the more contextually-relevant the generated threats become.

> Onboarding is intentionally lightweight - it is *not* a compliance questionnaire. Answer what you know today; you can update responses at any time as your platform evolves.

## Customising the questionnaire

Blanc does not ship a seed dataset of questions - admins own the questionnaire and seed it to match the organization's tech stack and compliance context. Everything lives in the `questions` and `categories` tables and is edited through the API (and, for convenience, through **Dashboard → Admin → Questions** in the studio).

Admin-only endpoints (`blanc/routers/question_router.py`):

| Method + path                           | Purpose                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET  /questions?entity_type=ORG\|APP`  | List all questions of a given scope.                                                 |
| `GET  /questions/grouped`               | Same, grouped by category with category names.                                       |
| `POST /questions`                       | Create a single question.                                                            |
| `POST /questions/bulk`                  | Bulk-create questions. Payload: `{ "questions": [{ question, options, entity_type, category_id }, ...] }`. |
| `GET  /categories`                      | List all categories.                                                                 |
| `POST /categories`                      | Create a category.                                                                   |
| `PUT  /categories/{category_id}`        | Rename a category.                                                                   |
| `DELETE /categories/{category_id}`      | Delete a category (fails if questions still reference it).                           |

Question schema (from `blanc/schemas/onboarding.py`):

| Field         | Notes                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| `question`    | Free-text question, plain string.                                                          |
| `options`     | Optional comma-separated list of allowed answers. Leave empty for free-text answers.       |
| `entity_type` | `ORG` or `APP` - controls which onboarding flow the question shows up in.                  |
| `category_id` | UUID of an existing category (create the category first).                                  |

Typical seeding flow for a new deployment:

```bash
# 1. Create the categories
curl -X POST https://blanc.internal.example.com/categories \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Cloud environment" }'

# 2. Bulk-create the questions under that category
curl -X POST https://blanc.internal.example.com/questions/bulk \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "questions": [
      { "question": "Which cloud provider hosts this application?",
        "options": "AWS,GCP,Azure,On-prem",
        "entity_type": "ORG",
        "category_id": "<uuid-from-step-1>" },
      { "question": "Is production data classified as PII?",
        "options": "Yes,No,Partial",
        "entity_type": "ORG",
        "category_id": "<uuid-from-step-1>" }
    ]
  }'
```

## Response API

For saving and reading answers programmatically (used by the studio, and useful if you're integrating onboarding into your own tooling):

| Method + path                          | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `POST /onboarding`                     | Save responses for one `(org_id, category_id)` pair.           |
| `GET  /onboarding/{org_id}`            | Fetch progress and answers across every category for an org.   |
| `GET  /category/{category_id}/name`    | Look up the human-readable name of a category.                 |
| `POST /app/onboarding`                 | Same shape as `/onboarding`, but scoped to an application.     |
| `GET  /app/onboarding/{app_id}`        | Fetch application-scoped onboarding progress.                  |

Request / response JSON shapes live in `blanc/schemas/onboarding.py`.

## Next steps

Once onboarding is in a reasonable state, jump to **[Create your Threat Model](create-your-first-threat-model.md)** to run your first assessment.
