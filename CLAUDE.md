# Claude Code

Production runs on **Railway** — project `sonara` (id `33e35438-b78d-4cf9-8fe6-d0ba87e3c111`). 

**Topology:** a **Caddy gateway** (`apps/gateway`) is the single public service. It path-routes `/api/auth/*`, `/rpc/*`, `/api/upload/*`, `/ws` to the **server** and everything else to the **web** (Next.js) app, all over Railway's internal network (`*.railway.internal`). So the browser only ever sees one origin → cookies are first-party, no CORS. The **server** (`apps/server`, Bun + Hono) is the single source of truth: Better Auth, the credits/oRPC HTTP router, image upload, Dodo webhook, and the live WebSocket session. The **web** app holds no business logic, no DB access, no secrets — just UI + a little SSR. Public traffic enters via Cloudflare DNS on the `sonara.fm` zone (id `3c4eff43a369f04340f8f83efb4870db`): `sonara.fm` → **gateway**, `www.sonara.fm` → 301 to apex. WSS is same-origin: `wss://sonara.fm/ws`. (The legacy `api.sonara.fm` fallback has been removed — all traffic enters via the gateway.)

The `railway` and `cloudflare` MCP servers are wired in `.mcp.json`; the `railway` CLI is also installed and linked. CF MCP is **Code Mode** — exactly two tools (`mcp__cloudflare__search` then `mcp__cloudflare__execute`); see `AGENTS.md §Cloudflare` for the API token's scope and how to expand it. Reach for `railway status`, `railway logs --service server`, `railway variables --service <name> --kv` when introspecting prod.

> **The `DATABASE_URL` in `apps/{web,server}/.env` is local-dev only** — it points at a localhost Postgres you bring up via `bun run db:start` (see `packages/db/docker-compose.yml`). Don't infer the production stack from `.env`. Prod uses Railway Postgres injected at runtime via `${{Postgres.DATABASE_URL}}`; the server applies migrations on every boot via `runMigrations()` in `apps/server/src/server.ts`.

See `AGENTS.md` (§Production for IDs + day-to-day CLI; rest of the doc for repo conventions, the procedure pattern, the credits flow, and the don't-touch list). `DEPLOY.md` covers from-scratch deploy; `INFRASTRUCTURE.md` has topology diagrams. Update `AGENTS.md` when a new convention is worth keeping.
