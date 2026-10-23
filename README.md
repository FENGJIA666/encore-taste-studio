# ENCORE

**One artist. An entire night of possibility.**

ENCORE is a taste-powered event studio for independent live-music venues. Choose a headliner, neighborhood and organizer production budget. ENCORE brings cultural discovery, collaboration concepts, an itemized allocation, a proposed run of show and an exportable launch brief into one working experience.

The signature journey starts with **Khruangbin · Brooklyn · USD 2,400**. Create the night, refine it to **USD 1,600**, refresh a collaboration lead, and export the updated brief. Each action recomputes the plan and preserves a visible decision trail.

## Run locally

Requires Node.js 22 or later. The application has no runtime dependencies.

```sh
npm start
```

Open [the local studio](http://127.0.0.1:4173). To use another port:

```sh
PORT=4180 npm start
```

`npm run dev` enables server watch mode. `npm test` runs the planner, provider-contract and independent acceptance tests. `npm run check` checks JavaScript syntax.

## Explore the studio

**Sample studio** opens the complete planning experience immediately: four artist directions, curated cultural pairings, and fictional collaboration leads. Explore, create, refine, and export a fully labeled event concept.

**Live Qloo** uses a server-side API adapter. Put credentials in `.env.local` (ignored by Git):

```dotenv
QLOO_API_KEY=your_key_here
QLOO_API_URL=https://hackathon.api.qloo.com
```

The scripts load `.env`, then `.env.local`, with the latter taking precedence. Set the API host assigned to your issued key. Credentials stay on the server, and each plan carries its actual data-source label.

The [official event resources](https://qloo.devpost.com/resources) provide the API-key request route. See the [Qloo hackathon developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) for current access instructions.

## From creative spark to event brief

1. **Discover.** Resolve the artist and bring sound, cinema, and place into one cultural thread.
2. **Compose.** Select complementary collaboration concepts, then open “Why this connection?” to explore their source, cultural cues, creative role and selection reason.
3. **Allocate.** Spread the organizer's chosen total across five fixed-share production categories, with an exact matching sum.
4. **Refine.** Adjust the budget or refresh a partner. The studio shows which concepts carry forward, which arrive, and how the two- or three-concept format evolves. Every current concept receives its own named activation in the proposed schedule.
5. **Share.** Export the current concept, sources, budget, proposed schedule, launch copy, and decision record as Markdown.

Read [the implementation notes](docs/architecture.md) for the Qloo request contract, selection rules, allocation shares, source handling, and comparison behavior.

## Deploy on Vercel

Import this repository as an Other framework project with Node.js 22. `vercel.json` serves `public/` and maps `/api/*` to the shared Node handler. No database or runtime package dependency is required. The included film is available at `/film.html`.

Sample studio works without credentials. For Live Qloo, add `QLOO_API_KEY` and the assigned `QLOO_API_URL` as server-side project environment variables, then redeploy. The in-memory 60-second request cache is a best-effort optimization per warm function instance; the planner does not depend on it for correctness.

## Optional grounded language-model draft

The default copy is an editorial template. To connect an OpenAI-compatible chat-completions provider, set the following server variables:

```dotenv
LLM_API_KEY=your_key_here
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-4.1-mini
```

A drafting checkbox appears when the provider is configured. The model receives the selected concept facts and writes the launch paragraph, while the planner handles partner selection and budget allocation. The result retains its drafting-source label. Provider usage follows your account's pricing.

## Project layout

- `server.js`: local HTTP server, explicit static-file allowlist, input boundary and source status.
- `src/providers.js`: Qloo search/Insights requests and optional model drafting.
- `src/planner.js`: validation, auditable selection, exact allocation, comparison and plan assembly.
- `src/sample-data.js`: fictional partner catalog and authored cultural directions.
- `public/`: responsive interface, original CSS poster artwork and brief export.
- `test/`, `tests/`: targeted logic, API contract and independently authored acceptance tests.
- `docs/`: implementation notes and data contracts.
- `api/`: native Node function entry point for Vercel, sharing the local HTTP API handler.

## Verification status

The local Sample studio completes the demonstrated desktop and mobile journey: creation, budget refinement, partner refresh, launch-brief views, and Markdown download. **31 automated tests** and JavaScript syntax checks pass. The earlier independent acceptance covered **12 browser scenarios**; the current refinement adds **8 focused desktop/mobile browser checks** for source details, plan changes, matching activations and export. The automated tests include Qloo contracts using synthetic HTTP fixtures and cross-currency comparison regression checks; the browser checks cover the demonstrated USD workflow. Request reuse, concurrent deduplication, expiry and error handling are verified with synthetic Qloo HTTP fixtures.

Provider-contract tests use synthetic HTTP fixtures. Authenticated Qloo and optional language-model execution require configured credentials; each result identifies its actual source. The four deployment tests cover platform-parsed JSON, the sample refinement journey, input/origin boundaries, and local film routes.

MIT licensed. See [LICENSE](LICENSE).
