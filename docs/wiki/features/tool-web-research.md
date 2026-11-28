# Web research and crawl

> The agent can search the web, read a page, read several pages of one site and extract a page with its links, all through the ClawAI research service.

## Business why

- Current facts (versions, documentation) are not in a model's training data. The research service holds the provider credentials, so users do not manage search keys (`../../../CHANGELOG.md` 1.76.0: "Search and fetch both go through the research service, which holds the provider credentials").
- No backend work was needed to ship the first version: `POST /research/search` already existed with the normal-user `RESEARCH_USE` permission and nothing in the extension called it (F004 audit).
- Quota matters: "quota-safe research controls" shipped as 0.12.0 on 2026-07-31.
- _Unknown - ask the owner and record the answer._ (Research cost per call and its place in plans is not in the extension repo.)

## Product why

- Problem: the agent needs to look something up, then use it, with proof of what it read.
- Users: developers; CLI users (`--research`).
- How it shows up:
  - Composer control "Web research" (remembered after reload since 1.88.0).
  - Tool `workspace.web` with `search`, `fetch`, `crawl`, `extract`.
  - CLI `--research search|search-fetch|search-extract`; SDK `research: 'SEARCH_FETCH'`. No grant needed: "web calls are reads".
- Acceptance criteria found: results are ranked and marked untrusted (F004). A page that was refused, answered 4xx, redirected off the host or failed is listed in `skipped` with a redacted reason; `stoppedBy` says why a crawl ended (`../../parity/web-research-parity.md`).

## How it works

- Routes: `POST /research/search`, `POST /research/fetch` (cleaned text, links, final URL; timeout 500 to 60,000 ms). Files: `src/backend/research-client.ts`, `src/core/web-research.ts`, `src/core/web-research-operations.ts`, `src/core/web-crawl.ts`, `src/core/web-page-digest.ts`, `src/infrastructure/web-research-tool-executor.ts`, `src/sdk/web-research-http.ts`.
- `search` offers search; `search-fetch` adds `fetch` and `crawl`; `search-extract` adds `extract`. A call the mode does not offer is refused.
- Crawl (`../../TOOLS.md`): same host only, 10 pages by default (30 at most), 2 link hops (3 at most). The 1.87.0 audit describes it as breadth first, one page at a time, 120,000 characters in all and 12,000 per page, with the same limits.
- URL rail, applied to every start URL and followed link: http and https only, no embedded credentials, no loopback, private or link-local address; the answering address is checked again (`assertFetchableUrl`). The server has its own domain policy; "this is the cheap half of the defence" (F005).
- A fetched page over 65,536 characters is cut with a notice and a `truncated` flag, because the Runtime V2 JSON contract caps any string at that length (1.76.0).
- Fetch timeout is capped at 60,000 ms, because the service rejects more (1.87.0).
- Everything returned is marked untrusted.

## Decisions

- Client-side bounded crawl on top of `/research/fetch`, because the server's site crawl is reached only through admin workflows (`/research/runs` needs `ADMIN_SYSTEM_VIEW`) (1.87.0 audit). Alternative: a user-permission workflow route is proposed in the audit as the "exact backend change".
- No "crawl" value in the composer, because "adding a composer value the server would ignore would be a fake control" (1.87.0).
- Cut a long page with a notice, not silently, because "the model reads a truncated page as the whole page" (1.76.0).
- Research mode on a Runtime V2 run forces the legacy payload path (`requiresLegacyPayload`), because V2 had no carrier for it (1.77.0, 1.87.0 audit). The V2 tool `workspace.web` is registered regardless of the control.
- Content from web pages is data, never instructions.

## History

- 2026-07-31: quota-safe research controls (0.12.0).
- 2026-09-10: the agent can search the web and read a page (1.2.0, F004, F005).
- 2026-09-20: a web page longer than 65,536 characters no longer ends the run (1.76.0); live proof that the agent found the VS Code docs URL and listed three activation events (1.76.0).
- 2026-10-01: crawl and extract; fetch timeout fixed; headless `--research` (1.87.0 part 2).
- 2026-10-01: parity page records which abilities need a server change.

## Tests and evidence

- `tests/unit/web-research.test.ts`, `web-research-tool-executor`, `web-crawl`, `research-client`, `chat-service-research`: operations, URL rail, crawl limits, client and chat paths.
- `tests/unit/sdk-*` toolkits in `new-tools-toolkit-integration`.
- Live proof, as stated: 1.76.0 "`workspace.web` proven live. In a round the agent searched, found the official VS Code documentation URL, fetched the page and listed three activation events from it." No live statement is recorded for crawl or extract.

## Known gaps and risks

- Site map and feed discovery, ranking links by the question, 200 pages in parallel, extraction profiles and repository analysis "need a backend change" (`../../parity/web-research-parity.md`).
- Research on a V2 run, the plan, the self-crawl and the narrated log need a backend change.
- The server's choice between a plain and headless-browser fetch is not visible from the client.
- Web content can attempt prompt injection; results are marked untrusted but the model still reads them.

## Open questions

- GAP: Has the user-permission `POST /research/workflows` route been built?
- GAP: Was the V2 research-mode fallback removed?
- GAP: Cost and quota per crawl page is not recorded here.
- GAP: Who approved the page counts (10, 30) as product limits?
