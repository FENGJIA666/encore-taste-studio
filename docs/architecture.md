# ENCORE implementation notes

## Planning workflow

The Node.js server provides artist search, provider status, and plan creation. Browser-native JavaScript drives the responsive interface and exports the current result as Markdown. There are no runtime package dependencies.

1. **Resolve the artist.** Sample studio searches four editorial artist directions. Live Qloo sends `/search` with `types=urn:entity:artist` and retains the selected entity ID.
2. **Gather cultural inputs.** Live Qloo requests places, artists, and movies through `/v2/insights`, using `signal.interests.entities` and `feature.explainability=true`. Place requests include the organizer's locality, `filter.location.radius=0`, and previously excluded entity IDs. The provider resolves the locality and returns its entity ID.
3. **Select collaborators.** Place eligibility uses an explicit set of business and cultural `genre:place` / `category:place` taxonomy IDs. Geographic features such as water and channels are outside this collaboration catalog. When Qloo supplies the resolved locality ID, each candidate must contain that same ID in its returned locality membership. Original query ranks are preserved after filtering. A greedy rule combines within-query rank, editorial theme fit for samples, and category variety. Previously refreshed choices remain excluded. Each result retains its selection reason and an internal ENCORE selection score. The “Why this connection?” disclosure exposes the actual source, supplied cultural cues and chosen creative role.
4. **Allocate the production budget.** Fixed shares are 35% partner activation, 25% food and welcome, 20% creative production, 10% community outreach, and 10% flexible reserve. The final bucket receives the rounding remainder, ensuring the total matches the organizer's budget exactly.
5. **Apply the studio format.** Budgets below 1,800 use two collaboration concepts; budgets of 1,800 or more use three. The threshold is in the selected currency and represents a format policy.
6. **Compose and refine.** The planner assembles the proposed schedule, source labels, launch copy, and decision record. Subsequent requests preserve feedback and return a before-and-after comparison when both plans use the same currency and provider. The summary identifies retained, new and replaced concepts by entity identity, records applied exclusions and shows the current concept slots. A currency or provider change starts a fresh comparison context. Each selected concept receives exactly one named activation in the proposed run of show; re-planning rebuilds the schedule from the current choices.
7. **Export.** The browser generates a Markdown brief from the displayed plan, including source details, current concept activations and the same refinement summary.

## Data and source contracts

Sample studio uses fictional partners and editorial cultural pairings. The entered neighborhood supplies the scenario context. The UI and export retain the Sample studio label.

Live Qloo retains result rank, actual primary-genre/category IDs, returned locality membership, cultural tags, and available affinity/explainability fields. Cultural cues use genre, category, cuisine, ambience, interests, activities and decor tag types; demographic and operational tags do not enter the launch paragraph. Qloo affinities are query-relative, so ENCORE uses rank within each query rather than comparing raw values between independent requests. The ENCORE selection score describes its own ranking rule and is distinct from a Qloo affinity score.

Strict location filtering requests the named locality boundary. Verified membership is established by matching the resolved locality entity ID to the IDs returned on each place, rather than by assuming a successful request proves geography. Returned locality is retained on each lead for review; a result without membership evidence displays “Location to confirm”. Collaboration leads and schedules are proposals. Budget allocations are the organizer's planning amounts; provider quotations and participation are established directly with the relevant partners.

The format threshold is not a cross-currency price comparison. Selection scores do not predict ticket sales or other business outcomes.

## Provider configuration

Startup loads `.env`, then `.env.local`, with `.env.local` taking precedence. Credentials stay on the server. The browser receives provider-readiness booleans and planning results.

The Qloo host must match the issued key. The adapter permits HTTPS requests to the configured Qloo API hosts and reports provider failures explicitly. Configuration errors keep their setup message; malformed JSON is reported without raw provider content. A documented search 404 becomes an empty result, while an Insights 404 remains an explicit failure.

Successful Qloo entity responses are cached in server memory for 60 seconds, with at most 128 entries. Identical simultaneous requests share one network request. Cache keys hash the credential and canonical request URL, separating credentials without exposing them. Failures are not cached. Budget-only refinements reuse the same cultural evidence; changing partner exclusions requests a different place query while the unchanged music and film queries reuse their recent evidence. Each Insights receipt says whether it used a fresh response, a shared request, or recent cached evidence, and retains its original retrieval timestamp. No stale result is relabelled as a new fetch. Sample output is selected through Sample studio; a failed live request does not change its source automatically.

The optional OpenAI-compatible drafting adapter receives the selected concept facts and writes the launch paragraph. Partner selection and budget allocation remain in the planner. The output retains its actual drafting source. The default writing source is the editorial template.

## Verification boundaries

Automated provider-contract tests use synthetic HTTP fixtures. Authenticated integration evidence separately verifies search, three Insights domains, strict Brooklyn membership, budget recomputation, partner exclusion and source timestamps. A controlled offline comparison on frozen real-Qloo candidate pools measures the contribution of Qloo ranking by removing both rank score and rank tie-breaking from a category-only baseline; it does not represent a no-Qloo or business-outcome benchmark. Local and public-production browser acceptance exercise Sample studio. The production checks also verify anonymous API access, film playback, byte-range media requests and private-path 404 responses. Authenticated Qloo and LLM execution and submission confirmation each require their own observed result.

The current verification snapshot is recorded in [README](../README.md#verification-status) with the public API/deployment adapter covered by `tests/deployment.test.js`.

## Hosting

`src/api.js` is shared by the local Node server and the native Vercel function in `api/`. It accepts both streamed local request bodies and JSON bodies parsed by the hosting platform, preserving the 64 KB limit and same-origin check. `public/` is the static output directory. The local server has an explicit file allowlist; the public hosting layer serves only deployment output. Both apply the same content security policy.

The initial production release uses the existing Vercel Hobby plan, with no database or paid add-on. Publication uses Vercel CLI; pushing a Git commit alone does not redeploy this project unless a Git integration is connected. Request caching is best-effort within each warm function instance and has no role in planner correctness.
