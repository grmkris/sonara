# Claude Code

Production runs on **Railway** — project `fearless-nourishment` (`33e35438-b78d-4cf9-8fe6-d0ba87e3c111`). The `railway` CLI is installed locally and linked to this project; reach for it (`railway status`, `railway logs --service server`, `railway variables --service <name> --kv`) when introspecting prod.

> **The `DATABASE_URL` in `apps/{web,server}/.env` is local-dev only — it points at a Neon DB the project no longer uses for prod.** Don't infer the production stack from `.env`. Prod uses Railway Postgres injected at runtime via `${{Postgres.DATABASE_URL}}`; the server applies migrations on every boot via `runMigrations()` in `apps/server/src/server.ts`.

See `AGENTS.md` (§Production for IDs + day-to-day CLI; rest of the doc for repo conventions, the procedure pattern, the credits flow, and the don't-touch list). `DEPLOY.md` covers from-scratch deploy; `INFRASTRUCTURE.md` has topology diagrams. Update `AGENTS.md` when a new convention is worth keeping.
