# Enhancement & Improvement Plan

Audit of the codebase against `SPECIFICATION.md` (v1.0). Status legend: **DONE** = implemented & wired, **PARTIAL** = scaffold/incomplete, **MISSING** = not present.

---

## 1. Implementation Gap Analysis

### Feature-by-feature

| §  | Feature | Status | Notes |
|----|---------|--------|-------|
| 2.1 | Multi-Model Support | PARTIAL | Only Ollama provider (`apps/api/src/providers/ollama.ts`). No OpenAI/LM Studio/Groq/Mistral/OpenRouter/vLLM/custom. `GET /models`, `GET /models/:id`, `POST /models/test` exist. **No** `PUT /models/:id/config`, no per-model settings, no model metadata/pricing display. No provider abstraction registry. |
| 2.2 | Chat Interface | PARTIAL | Streaming (SSE), markdown (`react-markdown`+`remark-gfm`), conversation CRUD, rename/delete/pin/archive, search, export JSON/MD, regenerate, edit, optimistic UI. **Missing:** LaTeX (deps installed, not wired in `MessageView`), code highlighting (`rehype-highlight` installed, not wired), PDF export, WebSocket, virtual scrolling, service worker/offline, message queue, threads, reactions, message timestamps (typed but not shown). Persistence is **localStorage only** — not server-side. |
| 2.3 | Auth & Authorization | MISSING | No auth routes, no JWT usage (`@fastify/jwt` installed), no Prisma schema, no OAuth, no users, no RBAC. `bcrypt`, `passport` deps unused. |
| 2.4 | Persistent Memory | PARTIAL | localStorage KV in `chat.tsx`, manual add/edit/delete, context injection into system prompt. **Missing:** vector DB, semantic search, auto-extraction, importance scoring, TTL. |
| 2.5 | RAG | PARTIAL | In-memory `Map` store with Ollama embeddings + cosine (`apps/rag`). Ingest/query/ask. File upload .txt/.md only. **Missing:** ChromaDB (in docker-compose but unused), PDF/DOCX parsing, BM25 hybrid, reranking, knowledge bases, document management, web search providers, web browsing. No `/api/knowledge-bases` endpoints. |
| 2.6 | Plugin System | MISSING | No plugin loader, manifest, hooks, marketplace, or sandboxing. |
| 2.7 | Agents | PARTIAL | localStorage agents with system prompt + optional model (`AgentsPanel.tsx`). **Missing:** tools, knowledge bases, variables/template engine, access control, import/export, community presets, `/api/agents` endpoints. |
| 2.8 | Notes | MISSING | No notes/folders, editor, version history, collaboration, or `/api/notes`. |
| 2.9 | Channels | MISSING | No channels, real-time messaging, threads, reactions. WebSocket deps unused. |
| 2.10 | Voice & Video | MISSING | No STT/TTS, WebRTC, providers. |
| 2.11 | Image Generation | MISSING | No providers, gallery, `/api/images`. |
| 2.12 | Workflows & Automations | MISSING | No scheduler, workflow engine, `/api/workflows`. |
| 2.13 | Calendar | MISSING | No calendar, events, `/api/calendar`. |
| 2.14 | Usage Analytics | MISSING | No tracking, dashboards, arena, leaderboard. |
| 2.15 | Artifact Storage | MISSING | No KV store, `/api/artifacts`. |

### Architecture & Infrastructure

| Area | Status | Notes |
|------|--------|-------|
| Frontend stack | PARTIAL | React 18 + Vite + TS. Many deps installed but unused: `react-router-dom`, `zustand`, `socket.io-client`, `react-hook-form`, `zod` (client), `@tanstack/react-query`, `axios`, `rehype-highlight`, `rehype-katex`, `remark-math`, `katex`. Custom CSS instead of Tailwind/shadcn. |
| Backend stack | PARTIAL | Fastify only. Prisma/BullMQ/ioredis/socket.io/winston installed but **not wired**. No Prisma schema directory exists. |
| Databases | MISSING (runtime) | PostgreSQL, Redis, ChromaDB, MinIO in `docker-compose.yml` with healthchecks, but **no app code connects to them**. All state is browser localStorage or in-process `Map`. |
| Worker | PARTIAL | In-memory array queue, not BullMQ/Redis. Not connected to API. |
| Shared packages | PARTIAL | `@ai-chat/shared` has core types only. `@ai-chat/ui` is empty stub. `@ai-chat/config` works. |
| Security | MISSING | No CORS registered, no rate limiting registered, no JWT, no input validation beyond trivial checks, no CSRF. |
| Observability | MISSING | No Prometheus/Grafana, OpenTelemetry, Sentry. API has Fastify logger only. |
| Testing | MISSING | No test files anywhere despite spec mandate. `turbo run test` has no targets. |
| Docs/OpenAPI | MISSING | `docs/` empty. No OpenAPI spec. |

### Unrelated artifacts in repo
`ticketcopilot/` (fine-tuned model checkpoint) and large `output (1).{csv,json,xlsx}` + `ticketcopilot_dataset.jsonl` + `convert_to_jsonl.py` are fine-tuning dataset artifacts, **not part of the chat app spec**. Consider moving to a separate repo/dir.

---

## 2. Critical Issues (fix first)

1. **No database layer.** Spec requires PostgreSQL via Prisma. Without it, persistence, auth, multi-user, analytics, and server-side conversations are impossible. `apps/api/prisma/` does not exist despite `db:setup`/`db:migrate` scripts.
2. **No auth.** Every feature with per-user scope (memory, agents, notes, channels, analytics, artifacts) depends on it.
3. **Provider coupling.** API is hardcoded to Ollama. No `AIProvider` registry; the shared interface exists but only one impl. Multi-model (spec §2.1) is the headline feature.
4. **Frontend rendering gaps.** KaTeX + highlight deps installed but `MessageView.tsx` doesn't pass `rehype-katex`/`rehype-highlight` plugins — math/code won't render as specified.
5. **Infra dead weight.** docker-compose runs 4 data services that nothing uses. Either wire them or remove to reduce confusion/startup cost.
6. **No tests, no lint run baseline.** ESLint config present; unverified.

---

## 3. Enhancement Plan (prioritized phases)

### Phase A — Foundations (make the spec's Phase 1 real)
**Goal:** server-side persistence, real auth, provider abstraction.
- A1. Create `apps/api/prisma/schema.prisma` with models: `User`, `Role`, `Permission`, `Conversation`, `Message`, `Memory`, `Agent`, `KnowledgeBase`, `Document`. Run `prisma migrate dev`.
- A2. Wire Prisma client into API; replace localStorage conversations with `GET/POST/PUT/DELETE /api/conversations*` per spec §2.2.6.
- A3. Implement auth: `@fastify/jwt` + bcrypt, `POST /api/auth/{register,login,logout,refresh}`, `GET/PUT /api/users/me`. Register `@fastify/cors` + `@fastify/rate-limit`.
- A4. Build `AIProvider` registry in `packages/shared` + `apps/api/src/providers/`. Add `OpenAIProvider`, `CustomOpenAIProvider` (base for LM Studio/vLLM/OpenRouter/Groq/Mistral). Register by env config. Add `PUT /api/models/:id/config`.
- A5. Frontend: swap localStorage chat store for API calls via `@tanstack/react-query`; add login/register UI and route guards.

### Phase B — Chat polish & RAG hardening
**Goal:** meet spec §2.2 and §2.5 fully.
- B1. Wire `rehype-katex` + `remark-math` + `rehype-highlight` in `MessageView`. Add copy-code-block button, message timestamps, reactions UI, thread stub.
- B2. PDF export (print-to-pdf or `jspdf`); virtual scrolling (`@tanstack/react-virtual`) for long conversations; WebSocket via `socket.io` for live updates.
- B3. RAG: replace in-memory `Map` with ChromaDB client; add PDF/DOCX text extraction (`pdf-parse`, `mammoth`); implement knowledge bases CRUD (`/api/knowledge-bases*`); add BM25 hybrid + reranker; add web search provider abstraction (start with DuckDuckGo/SearXNG — no key needed).
- B4. Persistent memory: move to vector-backed store, implement auto-extraction prompt + semantic retrieval + TTL.

### Phase C — Agents & Plugins
- C1. Agent builder: server-backed agents with tools, knowledge-base attachment, template variables (`/api/agents*`), import/export JSON, access control.
- C2. Plugin system: manifest schema, loader, hook bus (`pre_chat`, `post_chat`, `filter`, `tool`), enable/disable + config endpoints, sandboxed VM execution.

### Phase D — Collaboration & productivity
- D1. Channels with WebSocket real-time, threads, reactions, mentions, presence (`/api/channels*`).
- D2. Notes: markdown editor + live preview, folders/tags, full-text search, version history, `/api/notes*`.
- D3. Workflows: cron-based scheduler (BullMQ repeated jobs), visual builder, trigger/action/condition model, `/api/workflows*`.
- D4. Calendar: FullCalendar integration, events CRUD, recurring rules, `/api/calendar*`.

### Phase E — Modalities & analytics
- E1. Voice: STT/TTS provider abstraction (Whisper + OpenAI TTS first), push-to-talk, `/api/voice/*`.
- E2. Image generation: provider abstraction (DALL-E + ComfyUI/AUTOMATIC1111), gallery, `/api/images/*`.
- E3. Usage analytics: track message/token/cost per request, time-series aggregation, admin dashboard, arena mode + ELO leaderboard, `/api/analytics/*`.
- E4. Artifact storage: KV store backed by PostgreSQL JSONB, `/api/artifacts/*`.

### Phase F — Hardening (spec §5–6)
- F1. Tests: Vitest unit (shared, providers), integration (API routes with test DB), RTL E2E for critical flows. Set `turbo run test` targets.
- F2. Security audit: input validation with Zod on every route, CSRF tokens, rate limits on auth, secret rotation, TLS.
- F3. Observability: Pino structured logs → Loki, OpenTelemetry traces, Prometheus metrics endpoint, Sentry.
- F4. OpenAPI generation (`@fastify/swagger`) + SDK; fill `docs/`.
- F5. Tailwind + shadcn/ui migration (currently hand-rolled CSS) to match spec §3.2.1.

---

## 4. Quick Wins (high value, low effort, do now)
1. Wire KaTeX + highlight in `MessageView` (deps already installed) — 1 file, ~5 lines.
2. Register `@fastify/cors` and `@fastify/rate-limit` in `apps/api/src/index.ts` (deps installed) — ~10 lines.
3. Remove unused infra from docker-compose (or wire them) to stop misleading `docker compose up`.
4. Move fine-tuning artifacts (`ticketcopilot/`, `output (1).*`, `*.jsonl`, `convert_to_jsonl.py`) out of the app repo.
5. Add a `GET /api/health` + connect DB/Redis health checks so the compose `depends_on` actually reflects readiness.
6. Empty `@ai-chat/ui` package — either implement shared components or remove the dependency.

---

## 5. Recommended order of execution
1. Quick Wins #1, #2, #4 (minutes).
2. Phase A (foundations) — unblocks ~80% of remaining spec.
3. Phase B (chat + RAG) — completes the two most-used features.
4. Phase C → D → E in parallel where possible.
5. Phase F continuously, with a dedicated hardening sprint before any production use.