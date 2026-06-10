# Groupon MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a
Groupon‑style deals catalogue to LLM clients — both **consumer deal discovery**
and **merchant deal intelligence** — as MCP tools and resources, served over
Streamable HTTP behind OAuth 2.1.

## 1. What is this about

The server turns a deals dataset (deals, options, merchants, categories,
locations, reviews) into capabilities an MCP‑aware model can call:

- **Customers** discover deals — search with filters, inspect a deal, compare
  several side by side.
- **Merchants** get everything customers can, plus **intelligence** — category
  benchmarking, market‑gap analysis, and price positioning against peers.

A caller's **role is fixed by who they log in as**. The role is read from the
OAuth access token at session start, so a session only ever sees the tools its
role is allowed to use — customers never even see the merchant tools in
`tools/list`.

## 2. Approach

**Layered by concern**, one organizing principle throughout `src/`:

| Folder           | Responsibility                                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| `models/`        | Zod domain models — the validated shapes everything else speaks in             |
| `repositories/`  | **All** SQL lives here; repositories return Zod‑validated domain models        |
| `db/`            | Infrastructure — in‑memory SQLite client, schema, fixtures, seed               |
| `mcp/`           | The MCP delivery layer (see below)                                             |
| `utils/`         | Stateless helpers (console output, password hashing)                           |

Inside `mcp/`:

- `app.ts` — builds the Express host: OAuth routes, login, the Bearer‑guarded `/mcp` endpoint.
- `server.ts` — `buildMcpServer(role)` registers the tools/resources the role may use.
- `controllers.ts` — Streamable HTTP transport + per‑session lifecycle.
- `auth-provider.ts` — the OAuth 2.1 authorization‑server logic.
- `tools.ts` — the tool‑name registry and role rules; `results.ts` — tool‑result builders.

**Key design choices**

- **Streamable HTTP as transport.** The features offered by this MCP server
  may be consumed by external applications or sevices. That is why, rather than
  sticking to `StdioServerTransport` for development purposes, I chose
  `StreamableHTTPServerTransport` to offer a more production-like implementation.
- **SQLite, on purpose.** An in‑memory SQLite database keeps the project
  dependency‑free and trivial to run, so the focus stays on the part that
  matters — the MCP tools and the deal‑intelligence logic — instead of standing
  up external infrastructure. It still exercises a *real, structured* data layer,
  so the architecture is representative rather than a throwaway in‑memory array.
  That database is rebuilt + seeded on every launch — great for a deterministic demo,
  but note every restart invalidates issued OAuth tokens (you re‑authenticate
  after a restart)
- **Per‑session, role‑scoped servers.** Each session gets a fresh MCP server;
  the role comes from the access token, so the tool set is decided once and
  fixed for the session. Merchants are a superset of customers.
- **Repositories own persistence.** Tools never touch SQL — they call a
  repository that returns a fully‑assembled, validated domain model.
- **Full‑text search.** `search_deals` keyword matching uses SQLite **FTS5**
  (relevance‑ranked), not `LIKE`.
- **Self‑contained auth.** The server doubles as its own OAuth 2.1 authorization
  server (PKCE), verifying credentials against the seeded `users` table; the
  user's role is carried on the token.

**Tech stack:** TypeScript · Express 5 · `@modelcontextprotocol/sdk` ·
`better-sqlite3` (in‑memory) · Zod.

## 3. MCP tools

### Tools

| Tool                 | Role            | Input                                                                    | Returns                                                                |
| -------------------- | --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `search_deals`       | customer¹       | `query?`, `category?`, `location?`, `max_price?`, `min_discount?`, `limit?` | Active deals matching the filters (FTS keyword + slug/price/discount). |
| `get_deal`           | customer¹       | `deal_id`                                                                | Full detail for one deal: options, merchant, location, rating, fine print. |
| `compare_deals`      | customer¹       | `deal_ids` (2+)                                                          | Side‑by‑side: full deals, an aligned summary row each, and cheapest / biggest‑discount / highest‑rated picks. |
| `list_all_deals`     | **merchant**    | —                                                                        | Every deal including inactive ones (management view).                  |
| `category_insights`  | **merchant**    | `category`, `location?`                                                  | Deal count, avg/median discount, price range, top merchants.           |
| `find_market_gaps`   | **merchant**    | `location`                                                               | Categories under‑supplied in that location vs other markets, ranked by opportunity (`gap_score`). |
| `price_positioning`  | **merchant**    | `deal_id`                                                                | A deal's headline price/discount vs its category peers (peer medians + share it beats). |

¹ Customer tools are also available to merchants.

### Resources

Reference data for grounding the `category` / `location` filter values:

| Resource           | URI                | Contents                          |
| ------------------ | ------------------ | --------------------------------- |
| Categories         | `categories://all` | Every category (slug + name).     |
| Locations          | `locations://all`  | Every location (slug + region).   |

`category` / `location` filters take **slugs** — e.g. categories
`restaurants`, `wellness-beauty`, `fitness`; locations `madrid`, `barcelona`,
`valencia`.

## 4. How to run

**Prerequisites:** Node.js 24 and npm. (`better-sqlite3` is a native module — if
you switch Node versions, run `npm rebuild better-sqlite3`.)

```bash
npm install

# Development (no build step):
npm run dev       # tsx src/index.ts

# Production build:
npm run build     # tsc && tsc-alias  →  dist/
npm start         # node dist/index.js
```

The server listens on **http://localhost:3000**:

- MCP endpoint — `http://localhost:3000/mcp`
- Health check — `http://localhost:3000/health`

### Trying it with the MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector UI:

1. **Transport Type:** `Streamable HTTP`
2. **URL:** `http://localhost:3000/mcp`
3. Click **Connect** → run the **Guided OAuth flow** and log in with a seeded user.

The `/mcp` endpoint is OAuth‑protected, so you log in to get a token; the role
you log in as determines which tools you see.

**Seeded logins** (all use password `password123`):

| Role     | Email                | Sees                                                  |
| -------- | -------------------- | ----------------------------------------------------- |
| merchant | `javier@example.com` | Everything — all 7 tools + both resources             |
| customer | `laura@example.com`  | Discovery only — `search_deals`, `get_deal`, `compare_deals` + resources |

> Because the database is in‑memory, **restarting the server invalidates all
> tokens** — clear the Inspector's stored auth and log in again after a restart.
