# Mutation dashboard - design

Status: draft for review. Date: 2026-10-05. Plugin: `sonar-mutation-report-plugin` (next version after 0.2.0).

## Purpose

Give managers and developers a clear, ordered view of the mutation results the agent uploads, inside
SonarQube, without depending on the Overall Code / New Code tabs.

Success looks like:

- A manager sees within seconds which projects have pull requests failing the mutation gate, and how
  healthy and how adopted mutation testing is across projects.
- A developer opened on their own PR sees the verdict, the score against the threshold, and the exact
  files and lines of surviving mutants.

## Context and constraints (decided)

- The agent tests the diff of a PR. Results are per PR. `main` and other branches are not shown.
  There is no nightly full run, so no repo-wide score exists.
- Target: self-hosted SonarQube Server, Developer Edition, 2026.1 and later, same as sonartest. Custom
  plugins are not possible on SonarQube Cloud (out of scope).
- History window: 30 days by default (Sonar housekeeping default). Longer history is a later,
  separate decision (raise housekeeping, or move to BI).
- Scale for now: up to about 30 projects and a few hundred PRs a month in total.
- Read-only: no settings, no actions.
- All data already uploaded stays available. Nothing is removed from the report schema or the metrics.

## Pages

Two pages in the plugin jar, using Sonar's page extension mechanism.

### 1. Mutation overview (global page, "More" menu)

For managers. Layout "A" (approved mockup):

- Headline tiles: open PRs failing now, PR pass rate (30 days), projects using mutation
  (with / total), median new-code score.
- Filters: all projects or only those with mutation data; window fixed at 30 days.
- Table, default sort "failing open PRs" (descending), every column sortable: project, failing open
  PRs, pass rate 30d, median score, adoption (PRs with data / analyzed PRs), latest PR (number, status,
  score, age). A project name opens its project page. Projects with no mutation data sort to the bottom
  and show adoption as 0 / N.

### 2. Mutation (project page, project "More" menu)

Opened on the project: the **PR list** (30 days). Opened on a PR, or by clicking a row: the **PR detail**.
`main` and branches are hidden; opened there, the page shows a note and a link to the PR list.

PR list: four tiles (failing now, pass rate, median score, PRs with data) and a table: PR, title,
status pill, analyzed (age), new-code score with a bar and a threshold tick, survived, no coverage,
round. Filters: status, author, date.

PR detail, in order of importance: verdict and `new_mutation_score` against `mutation_threshold`;
counts (mutants in changed lines, killed, survived, no coverage, timeout/memory/unknown, test
strength); then tabs: **Files** (weakest first, with the whole-file score small as context),
**Survivors** (file, line, operator, status; line links open Sonar's code view), **Languages**,
**All metrics** (every uploaded measure, grouped, so nothing is hidden).

## Definitions (identical on every page)

- **Failing**: an open PR whose latest analysis has `new_mutation_score` below `mutation_threshold`.
- **Pass rate**: PRs whose latest analysis passed / PRs with mutation data, within the window.
- **Adoption**: PRs with mutation data / all analyzed PRs, within the window.
- **Median score**: median of the latest `new_mutation_score` per PR with data.
- A missing value is shown as "-" or "no data", never as 0.

Open question (settled in the first implementation spike): whether Sonar exposes reliably if a PR is
still open. Fallback if not: "open" means analyzed in the last 7 days, and the page says so.

## Architecture

- **Frontend**: TypeScript, bundled into the plugin jar's static resources by the Maven build, so the
  deliverable stays one jar. Styled to match Sonar; styles scoped to the plugin's pages.
- **Three separate units**:
  1. `api`: the only code that knows Sonar web API URLs and parameters. Returns typed data.
  2. `model`: pure functions for failing, pass rate, adoption, median, sorting, grouping. No I/O.
  3. `ui`: the two pages. Depends on `model` and `api`, never on raw responses.
- No server-side change: the sensor, metrics, computers and report schema stay as they are. A small Java
  class registers the two pages.

## Data flow

- Data comes from Sonar's web API with the **viewer's own session**, so Sonar's permissions decide which
  projects and PRs appear. No service account, no extra storage.
- Overview: visible projects, then each project's pull requests, then each PR's mutation measures.
  At most 6 requests in flight; rows render as they arrive; results cached for 5 minutes with a refresh
  control; progress shown ("12 / 18 projects").
- Project page: PR list from the pull request API plus measures per PR. PR detail: the PR's measures,
  its per-file measures (component tree), and its survivor issues (rules
  `external_mutation-report:survived` and `external_mutation-report:no-coverage`).

## Errors and edge cases

- One project fails to load: its row shows "unavailable" and a retry; the rest of the page is unaffected.
- No mutation data for a project or PR: "no data", counted in adoption, not as 0%.
- Missing optional metric (for example per-test data): "-".
- Opened on `main` or a branch: note plus link to the PR list.
- Server without pull request analysis (not our target): a clear message instead of an empty page.
- Pages appear in the menu of every project on the server (Sonar cannot show a page for only some
  projects); projects without data see "no mutation data".

## Testing

- Unit tests for `model` and `api` response parsing, using recorded and fake API responses.
- Plugin loads and both pages render on a local SonarQube (zip distribution). PR states use fake data
  there because that distribution has no PR analysis.
- End to end on sonartest, project `qa-rm-testing-gates`: upload several mock PRs (passing and failing),
  check both pages in a browser, compare screenshots with the approved mockups.
- Performance target: overview loads in 5 seconds or less for 30 projects and 300 PRs.

## Risks

- The page extension API is semi-public: re-test on each Sonar version.
- Open vs merged PR detection (see Definitions).
- Each jar iteration on sonartest needs the Sonar admin, and a restart affects everyone on that server.
- Scale beyond the stated size needs a different data source (BI or a pre-aggregated store).

## Out of scope

Nightly or repo-wide mutation scores, history beyond 30 days, SonarQube Cloud, editing or alerting,
changes to the agent or to the report schema, replacing the committed report with a CI artifact.

## Approved mockups

`.superpowers/brainstorm/` in the plugin repo (not committed): overview layout A and the project page in
both states.
