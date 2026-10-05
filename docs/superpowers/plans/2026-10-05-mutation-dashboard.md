# Mutation Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only pages to the Sonar plugin (a global "Mutation overview" for managers and a project page "Mutation" with a PR list and PR detail) that present the uploaded mutation data per pull request.

**Architecture:** TypeScript frontend in `frontend/`, bundled by esbuild into `src/main/resources/static/{overview,project}.js` and packaged into the single plugin jar. A small Java `PageDefinition` registers the two pages. The frontend has three isolated units: `api` (the only code that knows Sonar web API URLs), `model` (pure calculations), `ui` (DOM rendering, depends on a `DataSource` interface, never on raw responses).

**Tech Stack:** TypeScript, esbuild, vitest + jsdom, Maven (`exec-maven-plugin` runs npm), Java 17, Sonar plugin API 10.11.

**Spec:** `docs/specs/2026-10-05-mutation-dashboard-design.md` (read it first; approved mockups are in `.superpowers/brainstorm/` and are not committed).

## Global Constraints

- Target: self-hosted SonarQube Server, Developer Edition, 2026.1 and later. Plugin API compile target stays `10.11.0.2468`, Java 17 bytecode. Output stays one jar.
- Read-only pages. No change to the sensor, metrics, computers or report schema.
- Pages show **pull requests only**. `main` and branches are never summarized.
- Window 30 days. Open-PR fallback: analyzed within the last 7 days.
- At most 6 API requests in flight. Cache API responses 5 minutes. A refresh control clears the cache.
- Definitions (identical everywhere): **Failing** = open PR whose latest `new_mutation_score` is below `mutation_threshold`. **Pass rate** = passing PRs / PRs with mutation data (in window). **Adoption** = PRs with mutation data / all analyzed PRs (in window). **Median score** = median of the latest `new_mutation_score` per PR with data.
- A score equal to the threshold passes (`>=`).
- A missing value is shown as `-` or "no data", never as `0`.
- Data is fetched with the viewer's own session (relative URLs, `window.baseUrl` prefix). No tokens in the frontend.
- Never use the em dash character in code, comments, docs or commit messages. Use a plain "-".
- Never add Claude as co-author in commit messages (project owner rule).
- Overview must load in 5 seconds or less for 30 projects and 300 PRs.

## Deviations from the spec (decided while planning, must be reported to the owner)

The spec and mockups mention data that the plugin does not publish and Sonar's PR API does not expose:

1. **No "Round" column** and no "round / tools / agent version" in the PR header. These live only in the report JSON, not as measures. (Adding a `mutation_round` metric is a separate server-side change.)
2. **No author filter.** `api/project_pull_requests/list` does not return the author. Filters are status and date only.
3. **Survivor "operator"** is parsed from the sensor's issue message (`... the <Operator> mutation.` / `(<Operator> mutant not executed)`), shown as empty when it cannot be parsed.

## Review Focus

Inputs the spec implies but no task would otherwise test, most likely to bite first:

1. PR with no or partial mutation measures: must show `-` / "no data" and count in adoption, never `0`.
2. Project with zero PRs, or only PRs older than 30 days: a "no PRs in the last 30 days" row, not an error and not a division by zero.
3. One project returns 403/404/500: only that row shows "unavailable" with retry; the rest of the page still loads.
4. Score exactly equal to the threshold passes; a missing `mutation_threshold` falls back to 80 and is flagged as assumed.
5. More than 500 files or issues in one PR (pagination), and project or PR keys containing `:`, `/`, spaces (URL encoding).

---

## File Structure

```
frontend/
  package.json, package-lock.json, tsconfig.json, vitest.config.ts, build.mjs
  src/
    types.ts            domain types + DataSource interface (the unit boundary)
    model.ts            pure calculations: failing/pass/adoption/median/sort
    format.ts           pure formatting + Sonar URL helpers
    context.ts          parseContext(options) -> PageContext
    styles.ts           CSS string + injectStyles
    api.ts              SonarApi implements DataSource (limiter, cache, pagination, parsing)
    ui/dom.ts           h() element helper
    ui/overview.ts      renderOverview
    ui/prList.ts        renderPrList
    ui/prDetail.ts      renderPrDetail
    ui/projectPage.ts   renderProjectPage (routes list <-> detail <-> branch note)
    entry-overview.ts   registerExtension for mutationreport/overview
    entry-project.ts    registerExtension for mutationreport/project
  test/ fixtures.ts + one *.test.ts per unit
  dev/ index.html + main.ts   local harness with fake data (no Sonar needed)
src/main/java/com/nice/sonar/mutation/MutationPages.java
src/test/java/com/nice/sonar/mutation/MutationPagesTest.java
scripts/upload-mock-prs.sh
```

`src/main/resources/static/`, `frontend/node_modules/` and `frontend/dev/dist/` are build outputs: gitignored.

---

### Task 1: Frontend toolchain, Maven integration, hello bundles

**Files:**
- Create: `frontend/package.json` (via npm), `frontend/tsconfig.json`, `frontend/vitest.config.ts`, `frontend/build.mjs`, `frontend/src/entry-overview.ts`, `frontend/src/entry-project.ts`, `frontend/test/entry.test.ts`
- Modify: `pom.xml`, `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (vitest), `npm run build` writing `src/main/resources/static/overview.js` and `project.js`; Maven runs both before packaging; `-Dfrontend.skip=true` skips them. Entry files call `window.registerExtension(key, fn)` where `fn(options)` receives `options.el`.

- [ ] **Step 1: Scaffold the npm project**

```bash
cd ~/Desktop/Repo/sonar-mutation-report-plugin
mkdir -p frontend/src frontend/test && cd frontend
npm init -y >/dev/null
npm pkg set name=mutation-dashboard private=true type=module version=0.0.0
npm pkg set scripts.test="vitest run" scripts.build="node build.mjs" scripts.dev="node build.mjs --dev"
npm install --save-dev esbuild typescript vitest jsdom
```

- [ ] **Step 2: Write config files**

`frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src", "test", "dev"]
}
```

`frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['test/**/*.test.ts'] } });
```

`frontend/build.mjs`:
```js
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dev = process.argv.includes('--dev');
const out = fileURLToPath(new URL('../src/main/resources/static/', import.meta.url));
mkdirSync(out, { recursive: true });
const common = { bundle: true, format: 'iife', target: 'es2020', minify: !dev, logLevel: 'info' };
await build({ ...common, entryPoints: ['src/entry-overview.ts'], outfile: out + 'overview.js' });
await build({ ...common, entryPoints: ['src/entry-project.ts'], outfile: out + 'project.js' });
if (dev) {
  await build({ ...common, minify: false, entryPoints: ['dev/main.ts'], outfile: 'dev/dist/dev.js' });
}
```

- [ ] **Step 3: Write the failing entry test**

`frontend/test/entry.test.ts`:
```ts
import { describe, expect, it, beforeEach, vi } from 'vitest';

type Fn = (options: { el: HTMLElement; [k: string]: unknown }) => (() => void) | void;

describe('extension entry points', () => {
  let registered: Record<string, Fn>;
  beforeEach(() => {
    registered = {};
    vi.resetModules();
    (window as unknown as { registerExtension: (k: string, f: Fn) => void }).registerExtension = (k, f) => {
      registered[k] = f;
    };
  });

  it('overview registers under mutationreport/overview and cleans up', async () => {
    await import('../src/entry-overview');
    expect(Object.keys(registered)).toEqual(['mutationreport/overview']);
    const el = document.createElement('div');
    const cleanup = registered['mutationreport/overview']({ el }) as () => void;
    expect(el.textContent).toContain('Mutation overview');
    cleanup();
    expect(el.innerHTML).toBe('');
  });

  it('project registers under mutationreport/project and cleans up', async () => {
    await import('../src/entry-project');
    expect(Object.keys(registered)).toEqual(['mutationreport/project']);
    const el = document.createElement('div');
    const cleanup = registered['mutationreport/project']({ el, component: { key: 'p' } }) as () => void;
    expect(el.textContent).toContain('Mutation');
    cleanup();
    expect(el.innerHTML).toBe('');
  });
});
```

- [ ] **Step 4: Run it, expect FAIL**

Run: `cd frontend && npx vitest run test/entry.test.ts`
Expected: FAIL (cannot resolve `../src/entry-overview`).

- [ ] **Step 5: Write the minimal entries (replaced in later tasks)**

`frontend/src/entry-overview.ts`:
```ts
type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/overview', (options) => {
  options.el.textContent = 'Mutation overview';
  return () => {
    options.el.innerHTML = '';
  };
});
```

`frontend/src/entry-project.ts`:
```ts
type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/project', (options) => {
  options.el.textContent = 'Mutation';
  return () => {
    options.el.innerHTML = '';
  };
});
```

- [ ] **Step 6: Run the test, expect PASS**

Run: `cd frontend && npx vitest run test/entry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Wire npm into Maven and ignore outputs**

In `pom.xml` add to `<properties>`: `<frontend.skip>false</frontend.skip>`. In `<build><plugins>` add (before surefire):

```xml
      <plugin>
        <groupId>org.codehaus.mojo</groupId>
        <artifactId>exec-maven-plugin</artifactId>
        <version>3.5.0</version>
        <configuration>
          <workingDirectory>${project.basedir}/frontend</workingDirectory>
          <skip>${frontend.skip}</skip>
        </configuration>
        <executions>
          <execution>
            <id>npm-ci</id>
            <phase>generate-resources</phase>
            <goals><goal>exec</goal></goals>
            <configuration><executable>npm</executable><arguments><argument>ci</argument></arguments></configuration>
          </execution>
          <execution>
            <id>npm-test</id>
            <phase>generate-resources</phase>
            <goals><goal>exec</goal></goals>
            <configuration><executable>npm</executable><arguments><argument>test</argument></arguments></configuration>
          </execution>
          <execution>
            <id>npm-build</id>
            <phase>generate-resources</phase>
            <goals><goal>exec</goal></goals>
            <configuration><executable>npm</executable><arguments><argument>run</argument><argument>build</argument></arguments></configuration>
          </execution>
        </executions>
      </plugin>
```

Append to `.gitignore`:
```
frontend/node_modules/
frontend/dev/dist/
src/main/resources/static/
```

- [ ] **Step 8: Verify the jar contains the bundles**

Run: `mvn -q clean package 2>&1 | tail -15 && unzip -l target/sonar-mutation-report-plugin-*.jar | grep static`
Expected: BUILD SUCCESS, lines for `static/overview.js` and `static/project.js`.

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vitest.config.ts frontend/build.mjs frontend/src frontend/test pom.xml .gitignore
git commit -m "feat(dashboard): frontend toolchain, Maven npm build, hello bundles"
```

---

### Task 2: Register the two pages in Sonar and prove they load

**Files:**
- Create: `src/main/java/com/nice/sonar/mutation/MutationPages.java`, `src/test/java/com/nice/sonar/mutation/MutationPagesTest.java`
- Modify: `src/main/java/com/nice/sonar/mutation/MutationReportPlugin.java`

**Interfaces:**
- Consumes: Task 1 bundles on the classpath at `/static/overview.js` and `/static/project.js`.
- Produces: pages `mutationreport/overview` (GLOBAL) and `mutationreport/project` (COMPONENT, PROJECT qualifier). Sonar loads `static/<pageKey>.js` and expects `window.registerExtension('<plugin>/<page>', fn)`.

- [ ] **Step 1: Write the failing test**

```java
package com.nice.sonar.mutation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.sonar.api.web.page.Context;
import org.sonar.api.web.page.Page;

class MutationPagesTest {

  private static List<Page> pages() {
    Context context = new Context();
    new MutationPages().define(context);
    return List.copyOf(context.getPages());
  }

  @Test
  void registersTheOverviewAsAGlobalPage() {
    Page overview = pages().stream().filter(p -> p.getKey().equals("mutationreport/overview")).findFirst().orElseThrow();
    assertThat(overview.getScope()).isEqualTo(Page.Scope.GLOBAL);
    assertThat(overview.getName()).isEqualTo("Mutation overview");
    assertThat(overview.isAdmin()).isFalse();
  }

  @Test
  void registersTheProjectPageForProjectsOnly() {
    Page project = pages().stream().filter(p -> p.getKey().equals("mutationreport/project")).findFirst().orElseThrow();
    assertThat(project.getScope()).isEqualTo(Page.Scope.COMPONENT);
    assertThat(project.getName()).isEqualTo("Mutation");
    assertThat(project.getComponentQualifiers()).containsExactly(Page.Qualifier.PROJECT);
  }

  @Test
  void registersExactlyTwoPages() {
    assertThat(pages()).hasSize(2);
  }

  @Test
  void bundlesForBothPagesArePackagedAsStaticResources() {
    assertThat(getClass().getResource("/static/overview.js")).isNotNull();
    assertThat(getClass().getResource("/static/project.js")).isNotNull();
  }
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `mvn -q test -Dtest=MutationPagesTest 2>&1 | tail -15`
Expected: compilation error, `MutationPages` does not exist.

- [ ] **Step 3: Implement**

```java
package com.nice.sonar.mutation;

import org.sonar.api.web.page.Context;
import org.sonar.api.web.page.Page;
import org.sonar.api.web.page.PageDefinition;

/** Registers the two mutation dashboard pages. The JavaScript lives in static/ (built from frontend/). */
public class MutationPages implements PageDefinition {

  public static final String OVERVIEW_KEY = "mutationreport/overview";
  public static final String PROJECT_KEY = "mutationreport/project";

  @Override
  public void define(Context context) {
    context.addPage(Page.builder(OVERVIEW_KEY)
        .setName("Mutation overview")
        .setScope(Page.Scope.GLOBAL)
        .build());
    context.addPage(Page.builder(PROJECT_KEY)
        .setName("Mutation")
        .setScope(Page.Scope.COMPONENT)
        .setComponentQualifiers(Page.Qualifier.PROJECT)
        .build());
  }
}
```

Modify `MutationReportPlugin.define`: add `MutationPages.class` to the `addExtensions(...)` call.

- [ ] **Step 4: Run tests, expect PASS**

Run: `mvn -q test 2>&1 | grep -E "Tests run|BUILD|ERROR" | tail -5`
Expected: all tests pass including the 4 new ones.

- [ ] **Step 5: Prove the pages load on the local SonarQube**

```bash
S=~/.sonarlocal/sonarqube-26.1.0.118079; export SONAR_JAVA_PATH=/opt/homebrew/opt/openjdk@21/bin/java
$S/bin/macosx-universal-64/sonar.sh stop >/dev/null 2>&1; sleep 8
rm -f $S/extensions/plugins/sonar-mutation-report-plugin-*.jar
mvn -q clean package -DskipTests && cp target/sonar-mutation-report-plugin-*.jar $S/extensions/plugins/
$S/bin/macosx-universal-64/sonar.sh start >/dev/null 2>&1
for i in $(seq 1 40); do curl -s localhost:9000/api/system/status | grep -q '"UP"' && break; sleep 5; done
curl -s -o /dev/null -w "%{http_code}\n" localhost:9000/static/mutationreport/overview.js
```
Expected: `200`. Then open `http://localhost:9000/extension/mutationreport/overview` in a browser (login admin / Local-Pass-12345) and confirm the text "Mutation overview" renders. For the project page open `http://localhost:9000/project/extension/mutationreport/project?id=agent-e2e`.
If the static URL is not `/static/mutationreport/overview.js`, find the right path in the browser network tab, then update the Global Constraints note and this step. Do not continue until both pages render.

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/nice/sonar/mutation/MutationPages.java src/main/java/com/nice/sonar/mutation/MutationReportPlugin.java src/test/java/com/nice/sonar/mutation/MutationPagesTest.java
git commit -m "feat(dashboard): register overview and project pages"
```

---

### Task 3: Domain types and the pure model

**Files:**
- Create: `frontend/src/types.ts`, `frontend/src/model.ts`, `frontend/test/model.test.ts`, `frontend/test/fixtures.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task):

```ts
// types.ts
export const DEFAULT_THRESHOLD = 80;
export interface ProjectRef { key: string; name: string }
export interface PullRequestRef { key: string; title: string; branch: string; base: string; analysisDate: string }
export interface PrResult { pr: PullRequestRef; hasData: boolean; score: number | null; threshold: number; thresholdAssumed: boolean; measures: Record<string, number> }
export interface ProjectResult { project: ProjectRef; prs: PrResult[]; error: string | null }
export interface MetricInfo { key: string; name: string; description: string; type: string }
export interface FileRow { fileKey: string; path: string; language: string; score: number | null; alive: number; changedLines: number | null; wholeFileScore: number | null }
export interface SurvivorRow { fileKey: string; path: string; line: number; status: 'SURVIVED' | 'NO_COVERAGE'; operator: string }
export interface DataSource { listProjects(); loadProject(project); loadPullRequest(projectKey, prKey); loadFiles(projectKey, prKey); loadSurvivors(projectKey, prKey); loadMetrics(); loadAllMeasures(projectKey, prKey, metricKeys); clearCache() }
// model.ts
export const WINDOW_DAYS = 30; export const OPEN_WINDOW_DAYS = 7;
ageDays(iso, now), inWindow(r, now), isOpen(r, now), isFailing(r), isPassing(r), median(values),
summarizeProject(res, now): ProjectSummary, summarizeOverview(results, now): OverviewSummary,
sortProjects(list, key, dir), sortFilesWeakestFirst(files)
```

- [ ] **Step 1: Write `frontend/src/types.ts`**

```ts
export const DEFAULT_THRESHOLD = 80;

export interface ProjectRef {
  key: string;
  name: string;
}

export interface PullRequestRef {
  key: string;
  title: string;
  branch: string;
  base: string;
  analysisDate: string;
}

export interface PrResult {
  pr: PullRequestRef;
  /** The PR was analyzed with a mutation report (any mutation measure exists). */
  hasData: boolean;
  /** new_mutation_score, or null when absent. */
  score: number | null;
  threshold: number;
  /** True when mutation_threshold was missing and DEFAULT_THRESHOLD was used. */
  thresholdAssumed: boolean;
  measures: Record<string, number>;
}

export interface ProjectResult {
  project: ProjectRef;
  prs: PrResult[];
  /** Set when loading this project failed; prs is then empty. */
  error: string | null;
}

export interface MetricInfo {
  key: string;
  name: string;
  description: string;
  type: string;
}

export interface FileRow {
  fileKey: string;
  path: string;
  language: string;
  score: number | null;
  alive: number;
  changedLines: number | null;
  wholeFileScore: number | null;
}

export interface SurvivorRow {
  fileKey: string;
  path: string;
  line: number;
  status: 'SURVIVED' | 'NO_COVERAGE';
  operator: string;
}

/** Everything the UI needs from Sonar. The only implementation that touches the network is SonarApi. */
export interface DataSource {
  listProjects(): Promise<ProjectRef[]>;
  /** Never rejects: a failure becomes ProjectResult.error. */
  loadProject(project: ProjectRef): Promise<ProjectResult>;
  loadPullRequest(projectKey: string, prKey: string): Promise<PrResult | null>;
  loadFiles(projectKey: string, prKey: string): Promise<FileRow[]>;
  loadSurvivors(projectKey: string, prKey: string): Promise<SurvivorRow[]>;
  loadMetrics(): Promise<MetricInfo[]>;
  loadAllMeasures(projectKey: string, prKey: string, metricKeys: string[]): Promise<Record<string, number>>;
  clearCache(): void;
}
```

- [ ] **Step 2: Write the failing model tests**

`frontend/test/fixtures.ts`:
```ts
import type { DataSource, FileRow, MetricInfo, PrResult, ProjectRef, ProjectResult, SurvivorRow } from '../src/types';

export const NOW = new Date('2026-10-05T12:00:00Z');

export function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

export function makePr(key: string, over: Partial<PrResult> & { hours?: number; title?: string } = {}): PrResult {
  const { hours = 3, title = `PR ${key}`, ...rest } = over;
  return {
    pr: { key, title, branch: `feature/${key}`, base: 'main', analysisDate: hoursAgo(hours) },
    hasData: true,
    score: 85,
    threshold: 80,
    thresholdAssumed: false,
    measures: { new_mutation_score: 85, new_mutation_total: 40, new_mutation_killed: 34, new_mutation_survived: 4, new_mutation_no_coverage: 2 },
    ...rest,
  };
}

export function noData(key: string, hours = 3): PrResult {
  return makePr(key, { hours, hasData: false, score: null, measures: {} });
}

export class FakeData implements DataSource {
  calls: string[] = [];
  constructor(
    public projects: ProjectResult[],
    public files: Record<string, FileRow[]> = {},
    public survivors: Record<string, SurvivorRow[]> = {},
    public metrics: MetricInfo[] = [],
    public allMeasures: Record<string, number> = {},
  ) {}
  async listProjects(): Promise<ProjectRef[]> {
    this.calls.push('listProjects');
    return this.projects.map((p) => p.project);
  }
  async loadProject(project: ProjectRef): Promise<ProjectResult> {
    this.calls.push(`loadProject:${project.key}`);
    return this.projects.find((p) => p.project.key === project.key)!;
  }
  async loadPullRequest(projectKey: string, prKey: string): Promise<PrResult | null> {
    const p = this.projects.find((x) => x.project.key === projectKey);
    return p?.prs.find((r) => r.pr.key === prKey) ?? null;
  }
  async loadFiles(projectKey: string, prKey: string): Promise<FileRow[]> {
    return this.files[`${projectKey}#${prKey}`] ?? [];
  }
  async loadSurvivors(projectKey: string, prKey: string): Promise<SurvivorRow[]> {
    return this.survivors[`${projectKey}#${prKey}`] ?? [];
  }
  async loadMetrics(): Promise<MetricInfo[]> {
    return this.metrics;
  }
  async loadAllMeasures(): Promise<Record<string, number>> {
    return this.allMeasures;
  }
  clearCache(): void {
    this.calls.push('clearCache');
  }
}

export function project(key: string, prs: PrResult[], error: string | null = null): ProjectResult {
  return { project: { key, name: key }, prs, error };
}
```

`frontend/test/model.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  inWindow, isFailing, isOpen, isPassing, median, sortFilesWeakestFirst, sortProjects, summarizeOverview, summarizeProject,
} from '../src/model';
import type { FileRow } from '../src/types';
import { NOW, makePr, noData, project } from './fixtures';

describe('isFailing / isPassing', () => {
  it('score below threshold fails', () => {
    expect(isFailing(makePr('1', { score: 79.9 }))).toBe(true);
    expect(isPassing(makePr('1', { score: 79.9 }))).toBe(false);
  });
  it('score equal to the threshold passes', () => {
    expect(isFailing(makePr('1', { score: 80 }))).toBe(false);
    expect(isPassing(makePr('1', { score: 80 }))).toBe(true);
  });
  it('no data and null score are neither failing nor passing', () => {
    expect(isFailing(noData('1'))).toBe(false);
    expect(isPassing(noData('1'))).toBe(false);
    const nullScore = makePr('2', { score: null });
    expect(isFailing(nullScore)).toBe(false);
    expect(isPassing(nullScore)).toBe(false);
  });
});

describe('windows', () => {
  it('30 day window', () => {
    expect(inWindow(makePr('1', { hours: 24 * 29 }), NOW)).toBe(true);
    expect(inWindow(makePr('1', { hours: 24 * 31 }), NOW)).toBe(false);
  });
  it('future analysis dates (clock skew) count as in window and open', () => {
    expect(inWindow(makePr('1', { hours: -2 }), NOW)).toBe(true);
    expect(isOpen(makePr('1', { hours: -2 }), NOW)).toBe(true);
  });
  it('open means analyzed in the last 7 days', () => {
    expect(isOpen(makePr('1', { hours: 24 * 6 }), NOW)).toBe(true);
    expect(isOpen(makePr('1', { hours: 24 * 8 }), NOW)).toBe(false);
  });
});

describe('median', () => {
  it('odd, even, empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('summarizeProject', () => {
  it('counts failing open PRs, pass rate, median, adoption, latest', () => {
    const res = project('p', [
      makePr('1', { score: 70, hours: 2 }),
      makePr('2', { score: 90, hours: 30 }),
      makePr('3', { score: 80, hours: 50 }),
      noData('4', 60),
      makePr('5', { score: 50, hours: 24 * 40 }), // outside the window: ignored
    ]);
    const s = summarizeProject(res, NOW);
    expect(s.total).toBe(4);
    expect(s.withData).toBe(3);
    expect(s.failingOpen).toBe(1);
    expect(s.passRate).toBeCloseTo((2 / 3) * 100);
    expect(s.medianScore).toBe(80);
    expect(s.latest?.pr.key).toBe('1');
  });
  it('a failing PR that is no longer open does not count as failing now', () => {
    const s = summarizeProject(project('p', [makePr('1', { score: 10, hours: 24 * 10 })]), NOW);
    expect(s.failingOpen).toBe(0);
    expect(s.passRate).toBe(0);
  });
  it('zero PRs: no division by zero, nulls not zeros', () => {
    const s = summarizeProject(project('p', []), NOW);
    expect(s).toMatchObject({ total: 0, withData: 0, failingOpen: 0, passRate: null, medianScore: null, latest: null });
  });
  it('only PRs without data: passRate and median are null', () => {
    const s = summarizeProject(project('p', [noData('1'), noData('2')]), NOW);
    expect(s.total).toBe(2);
    expect(s.withData).toBe(0);
    expect(s.passRate).toBeNull();
    expect(s.medianScore).toBeNull();
  });
  it('keeps the error', () => {
    expect(summarizeProject(project('p', [], 'boom'), NOW).error).toBe('boom');
  });
});

describe('summarizeOverview', () => {
  it('aggregates across projects and ignores errored projects in counts', () => {
    const o = summarizeOverview(
      [
        project('a', [makePr('1', { score: 70 }), makePr('2', { score: 90 })]),
        project('b', [makePr('3', { score: 100 })]),
        project('c', [noData('4')]),
        project('d', [], 'unavailable'),
      ],
      NOW,
    );
    expect(o.failingOpen).toBe(1);
    expect(o.passRate).toBeCloseTo((2 / 3) * 100);
    expect(o.projectsWithData).toBe(2);
    expect(o.projectsTotal).toBe(4);
    expect(o.medianScore).toBe(90);
  });
  it('empty input gives nulls', () => {
    const o = summarizeOverview([], NOW);
    expect(o).toMatchObject({ failingOpen: 0, passRate: null, projectsWithData: 0, projectsTotal: 0, medianScore: null });
  });
});

describe('sortProjects', () => {
  const list = () => [
    summarizeProject(project('beta', [makePr('1', { score: 90 })]), NOW),
    summarizeProject(project('alpha', [makePr('2', { score: 60 }), makePr('3', { score: 50 })]), NOW),
    summarizeProject(project('gamma', [noData('4')]), NOW),
    summarizeProject(project('delta', [makePr('5', { score: 70 })]), NOW),
  ];
  it('default: failing open desc, ties by name, no-data projects last', () => {
    expect(sortProjects(list(), 'failingOpen', 'desc').map((s) => s.key)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
  });
  it('projects without data stay last even when ascending', () => {
    expect(sortProjects(list(), 'medianScore', 'asc').map((s) => s.key)).toEqual(['alpha', 'delta', 'beta', 'gamma']);
  });
  it('sorts by name', () => {
    expect(sortProjects(list(), 'name', 'asc').map((s) => s.key)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });
  it('does not mutate the input', () => {
    const l = list();
    const before = l.map((s) => s.key);
    sortProjects(l, 'name', 'asc');
    expect(l.map((s) => s.key)).toEqual(before);
  });
});

describe('sortFilesWeakestFirst', () => {
  const f = (path: string, score: number | null): FileRow => ({ fileKey: path, path, language: 'ts', score, alive: 0, changedLines: null, wholeFileScore: null });
  it('ascending score, null scores last', () => {
    expect(sortFilesWeakestFirst([f('a', 80), f('b', null), f('c', 40)]).map((x) => x.path)).toEqual(['c', 'a', 'b']);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd frontend && npx vitest run test/model.test.ts`
Expected: FAIL (cannot resolve `../src/model`).

- [ ] **Step 4: Implement `frontend/src/model.ts`**

```ts
import type { FileRow, PrResult, ProjectResult } from './types';

export const WINDOW_DAYS = 30;
export const OPEN_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export function ageDays(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS;
}

/** Negative ages (clock skew) count as inside the window. Unparseable dates are outside it. */
export function inWindow(r: PrResult, now: Date): boolean {
  const age = ageDays(r.pr.analysisDate, now);
  return Number.isNaN(age) ? false : age <= WINDOW_DAYS;
}

/** Sonar does not reliably expose open vs merged: open means analyzed recently. */
export function isOpen(r: PrResult, now: Date): boolean {
  const age = ageDays(r.pr.analysisDate, now);
  return !Number.isNaN(age) && age <= OPEN_WINDOW_DAYS;
}

export function isFailing(r: PrResult): boolean {
  return r.hasData && r.score !== null && r.score < r.threshold;
}

export function isPassing(r: PrResult): boolean {
  return r.hasData && r.score !== null && r.score >= r.threshold;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface ProjectSummary {
  key: string;
  name: string;
  error: string | null;
  /** PRs analyzed in the window. */
  total: number;
  /** PRs in the window with mutation data. */
  withData: number;
  failingOpen: number;
  passRate: number | null;
  medianScore: number | null;
  latest: PrResult | null;
}

export function summarizeProject(res: ProjectResult, now: Date): ProjectSummary {
  const prs = res.prs.filter((r) => inWindow(r, now));
  const withData = prs.filter((r) => r.hasData);
  const scored = withData.filter((r) => r.score !== null);
  const passing = withData.filter(isPassing).length;
  const latest = [...prs].sort((a, b) => b.pr.analysisDate.localeCompare(a.pr.analysisDate))[0] ?? null;
  return {
    key: res.project.key,
    name: res.project.name,
    error: res.error,
    total: prs.length,
    withData: withData.length,
    failingOpen: prs.filter((r) => isFailing(r) && isOpen(r, now)).length,
    passRate: withData.length ? (passing / withData.length) * 100 : null,
    medianScore: median(scored.map((r) => r.score as number)),
    latest,
  };
}

export interface OverviewSummary {
  failingOpen: number;
  passRate: number | null;
  projectsWithData: number;
  projectsTotal: number;
  medianScore: number | null;
}

export function summarizeOverview(results: ProjectResult[], now: Date): OverviewSummary {
  const ok = results.filter((r) => !r.error);
  const prs = ok.flatMap((r) => r.prs.filter((p) => inWindow(p, now)));
  const withData = prs.filter((p) => p.hasData);
  const passing = withData.filter(isPassing).length;
  return {
    failingOpen: prs.filter((p) => isFailing(p) && isOpen(p, now)).length,
    passRate: withData.length ? (passing / withData.length) * 100 : null,
    projectsWithData: ok.filter((r) => r.prs.some((p) => inWindow(p, now) && p.hasData)).length,
    projectsTotal: results.length,
    medianScore: median(withData.filter((p) => p.score !== null).map((p) => p.score as number)),
  };
}

export type SortKey = 'name' | 'failingOpen' | 'passRate' | 'medianScore' | 'adoption' | 'latest';
export type SortDir = 'asc' | 'desc';

function sortValue(s: ProjectSummary, key: SortKey): number | string | null {
  switch (key) {
    case 'name': return s.name.toLowerCase();
    case 'failingOpen': return s.failingOpen;
    case 'passRate': return s.passRate;
    case 'medianScore': return s.medianScore;
    case 'adoption': return s.total ? s.withData / s.total : 0;
    case 'latest': return s.latest ? s.latest.pr.analysisDate : null;
  }
}

/** Projects without mutation data (or errored) always sort last, whatever the direction. Ties by name. */
export function sortProjects(list: ProjectSummary[], key: SortKey, dir: SortDir): ProjectSummary[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const aEmpty = a.withData === 0 || a.error !== null;
    const bEmpty = b.withData === 0 || b.error !== null;
    if (key !== 'name' && aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av !== bv && av !== null && bv !== null) return (av < bv ? -1 : 1) * sign;
    if (av !== bv && (av === null || bv === null)) return av === null ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

export function sortFilesWeakestFirst(files: FileRow[]): FileRow[] {
  return [...files].sort((a, b) => {
    if (a.score === b.score) return a.path.localeCompare(b.path);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd frontend && npx vitest run test/model.test.ts && npx tsc --noEmit -p .`
Expected: all model tests PASS, `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/model.ts frontend/test/model.test.ts frontend/test/fixtures.ts
git commit -m "feat(dashboard): domain types and pure model with tests"
```

---

### Task 4: Formatting, context parsing, styles, DOM helper

**Files:**
- Create: `frontend/src/format.ts`, `frontend/src/context.ts`, `frontend/src/styles.ts`, `frontend/src/ui/dom.ts`, `frontend/test/format.test.ts`, `frontend/test/context.test.ts`

**Interfaces:**
- Consumes: `PrResult` from Task 3.
- Produces:

```ts
// format.ts
fmtPct(n: number | null | undefined, digits = 1): string      // '-' for null/NaN
fmtInt(n: number | null | undefined): string                   // '-' for null/NaN
fmtAge(iso: string, now: Date): string                         // '3h ago', '-' if invalid
sonarBase(): string                                            // window.baseUrl without trailing slash
projectPageUrl(projectKey: string): string
codeUrl(projectKey: string, prKey: string, fileKey: string, line?: number): string
scoreColor(score: number | null, threshold: number): string
// context.ts
type PageContext = {kind:'project';project:string} | {kind:'pr';project:string;pr:string} | {kind:'branch';project:string;name:string}
parseContext(options: unknown): PageContext
// styles.ts
injectStyles(doc?: Document): void
// ui/dom.ts
h(tag, props?, ...children): HTMLElement
```

- [ ] **Step 1: Write the failing tests**

`frontend/test/format.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { codeUrl, fmtAge, fmtInt, fmtPct, projectPageUrl, scoreColor, sonarBase } from '../src/format';
import { NOW, hoursAgo } from './fixtures';

afterEach(() => {
  delete (globalThis as { baseUrl?: string }).baseUrl;
});

describe('fmtPct / fmtInt', () => {
  it('formats numbers', () => {
    expect(fmtPct(70.94)).toBe('70.9%');
    expect(fmtPct(80, 0)).toBe('80%');
    expect(fmtInt(12.4)).toBe('12');
  });
  it('null, undefined and NaN are a dash, never 0', () => {
    expect(fmtPct(null)).toBe('-');
    expect(fmtPct(undefined)).toBe('-');
    expect(fmtPct(Number.NaN)).toBe('-');
    expect(fmtInt(null)).toBe('-');
    expect(fmtInt(Number.NaN)).toBe('-');
  });
});

describe('fmtAge', () => {
  it('minutes, hours, days', () => {
    expect(fmtAge(hoursAgo(0.5), NOW)).toBe('30m ago');
    expect(fmtAge(hoursAgo(3), NOW)).toBe('3h ago');
    expect(fmtAge(hoursAgo(50), NOW)).toBe('2d ago');
  });
  it('future dates do not go negative; invalid dates are a dash', () => {
    expect(fmtAge(hoursAgo(-1), NOW)).toBe('1m ago');
    expect(fmtAge('not a date', NOW)).toBe('-');
  });
});

describe('urls', () => {
  it('uses window.baseUrl and encodes keys', () => {
    (globalThis as { baseUrl?: string }).baseUrl = '/sonar/';
    expect(sonarBase()).toBe('/sonar');
    expect(projectPageUrl('a:b c')).toBe('/sonar/project/extension/mutationreport/project?id=a%3Ab%20c');
    expect(codeUrl('p', 'feature/x', 'p:src/a.ts', 7)).toBe(
      '/sonar/code?id=p&pullRequest=feature%2Fx&selected=p%3Asrc%2Fa.ts&line=7',
    );
  });
  it('no baseUrl and no line', () => {
    expect(codeUrl('p', '1', 'p:a.ts')).toBe('/code?id=p&pullRequest=1&selected=p%3Aa.ts');
  });
});

describe('scoreColor', () => {
  it('green at or above threshold, orange below, grey for null', () => {
    expect(scoreColor(80, 80)).toBe('#00aa00');
    expect(scoreColor(79, 80)).toBe('#ed7d20');
    expect(scoreColor(null, 80)).toBe('#8a95a5');
  });
});
```

`frontend/test/context.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseContext } from '../src/context';

describe('parseContext', () => {
  it('project without a branch-like is the project page', () => {
    expect(parseContext({ component: { key: 'p' } })).toEqual({ kind: 'project', project: 'p' });
  });
  it('a pull request branch-like', () => {
    expect(parseContext({ component: { key: 'p' }, branchLike: { key: '14', title: 't', branch: 'f', base: 'main' } })).toEqual({
      kind: 'pr', project: 'p', pr: '14',
    });
  });
  it('a named branch', () => {
    expect(parseContext({ component: { key: 'p' }, branchLike: { name: 'main', isMain: true } })).toEqual({
      kind: 'branch', project: 'p', name: 'main',
    });
  });
  it('missing or odd options fall back to an empty project', () => {
    expect(parseContext(undefined)).toEqual({ kind: 'project', project: '' });
    expect(parseContext({ component: { key: 'p' }, branchLike: 'weird' })).toEqual({ kind: 'project', project: 'p' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run test/format.test.ts test/context.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`frontend/src/format.ts`:
```ts
export function fmtPct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : `${n.toFixed(digits)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : String(Math.round(n));
}

export function fmtAge(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '-';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function sonarBase(): string {
  return ((globalThis as { baseUrl?: string }).baseUrl ?? '').replace(/\/$/, '');
}

export function projectPageUrl(projectKey: string): string {
  return `${sonarBase()}/project/extension/mutationreport/project?id=${encodeURIComponent(projectKey)}`;
}

export function codeUrl(projectKey: string, prKey: string, fileKey: string, line?: number): string {
  const base = `${sonarBase()}/code?id=${encodeURIComponent(projectKey)}&pullRequest=${encodeURIComponent(prKey)}&selected=${encodeURIComponent(fileKey)}`;
  return line ? `${base}&line=${line}` : base;
}

export function scoreColor(score: number | null, threshold: number): string {
  if (score === null) return '#8a95a5';
  return score >= threshold ? '#00aa00' : '#ed7d20';
}
```

`frontend/src/context.ts`:
```ts
export type PageContext =
  | { kind: 'project'; project: string }
  | { kind: 'pr'; project: string; pr: string }
  | { kind: 'branch'; project: string; name: string };

/** Sonar passes the project as options.component and, when a branch or PR is selected, options.branchLike. */
export function parseContext(options: unknown): PageContext {
  const o = (options ?? {}) as { component?: { key?: string }; branchLike?: unknown };
  const project = o.component?.key ?? '';
  const bl = o.branchLike;
  if (bl && typeof bl === 'object') {
    const b = bl as Record<string, unknown>;
    if ('key' in b && ('base' in b || 'branch' in b || 'target' in b)) {
      return { kind: 'pr', project, pr: String(b.key) };
    }
    if ('name' in b) return { kind: 'branch', project, name: String(b.name) };
  }
  return { kind: 'project', project };
}
```

`frontend/src/ui/dom.ts`:
```ts
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}
```

`frontend/src/styles.ts`:
```ts
export const CSS = `
.md{font:14px/1.4 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#2c3e50;padding:16px 24px}
.md h1{font-size:20px;margin:0 0 12px}
.md-kpis{display:flex;gap:12px;margin:12px 0 16px}
.md-kpi{flex:1;border:1px solid #e1e6f0;border-radius:4px;padding:10px 12px;background:#fff}
.md-kpi .v{font-size:22px;font-weight:700}.md-kpi .l{font-size:12px;color:#6b7686}
.md-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
.md-table th{text-align:left;padding:8px;border-bottom:2px solid #cdd7e9;color:#6b7686;font-weight:600;white-space:nowrap;user-select:none}
.md-table th.sortable{cursor:pointer}
.md-table td{padding:8px;border-bottom:1px solid #e1e6f0;white-space:nowrap}
.md-table th.desc::after{content:" \\25BC"}.md-table th.asc::after{content:" \\25B2"}
.md-fail{color:#d4333f;font-weight:600}.md-pass{color:#00aa00;font-weight:600}.md-muted{color:#8a95a5}
.md-pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.md-pill.fail{background:#fbe9ea;color:#d4333f}.md-pill.pass{background:#e6f6e6;color:#008a00}.md-pill.none{background:#eef1f6;color:#6b7686}
.md-bar{display:inline-block;position:relative;width:90px;height:8px;background:#e1e6f0;border-radius:4px;vertical-align:middle;margin-left:6px}
.md-bar i{display:block;height:100%;border-radius:4px}.md-bar b{position:absolute;top:-2px;width:2px;height:12px;background:#2c3e50}
.md-tabs{display:flex;gap:4px;border-bottom:1px solid #cdd7e9;margin:12px 0}
.md-tab{padding:6px 12px;border:0;border-bottom:2px solid transparent;color:#6b7686;background:none;cursor:pointer;font:inherit}
.md-tab.on{border-color:#236a97;color:#236a97;font-weight:600}
.md-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #cdd7e9;padding-bottom:8px}
.md-head .t{font-size:18px;font-weight:700}.md-head .m{font-size:12px;color:#6b7686}
.md-big{font-size:28px;font-weight:700;text-align:right}
.md-row{display:flex;gap:16px}.md-row>*{flex:1}
.md a,.md .md-link{color:#236a97;cursor:pointer;text-decoration:none;background:none;border:0;font:inherit;padding:0}
.md-note{background:#fff8e1;border:1px solid #f0d98c;border-radius:4px;padding:8px 12px;margin-bottom:12px}
.md-filters{display:flex;gap:12px;align-items:center;margin:8px 0;font-size:13px;color:#6b7686}
.md-lbl{font-size:12px;color:#6b7686;font-weight:600;text-transform:uppercase;margin:10px 0 4px}
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById('md-css')) return;
  const style = doc.createElement('style');
  style.id = 'md-css';
  style.textContent = CSS;
  doc.head.append(style);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p .`
Expected: all tests PASS; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/format.ts frontend/src/context.ts frontend/src/styles.ts frontend/src/ui/dom.ts frontend/test/format.test.ts frontend/test/context.test.ts
git commit -m "feat(dashboard): formatting, context parsing, styles, dom helper"
```

---

### Task 5: The Sonar API client

**Files:**
- Create: `frontend/src/api.ts`, `frontend/test/api.test.ts`

**Interfaces:**
- Consumes: types from Task 3, `sonarBase()` from Task 4.
- Produces: `class SonarApi implements DataSource` with constructor `(fetchFn?: typeof fetch, now?: () => number, baseUrl?: string)`; exported constants `MAX_CONCURRENCY = 6`, `CACHE_TTL_MS = 300000`, `PAGE_SIZE = 500`, `MAX_METRIC_KEYS = 50`, `PR_METRICS: string[]`, `SURVIVOR_RULES: string`; helper `toMeasureMap(measures): Record<string, number>`; `parseOperator(message): string`.

Sonar endpoints used (all GET, session cookie): `/api/components/search?qualifiers=TRK` (projects the viewer can browse), `/api/project_pull_requests/list?project=`, `/api/measures/component?component=&pullRequest=&metricKeys=`, `/api/measures/component_tree?component=&pullRequest=&qualifiers=FIL&metricKeys=`, `/api/issues/search?componentKeys=&pullRequest=&rules=`, `/api/metrics/search`. New-code measures may arrive as `period.value` instead of `value`; both are read.

- [ ] **Step 1: Write the failing tests**

`frontend/test/api.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CACHE_TTL_MS, MAX_CONCURRENCY, PAGE_SIZE, SonarApi, parseOperator, toMeasureMap } from '../src/api';

type Handler = (url: string) => unknown | Promise<unknown> | { status: number };

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const out = (await handler(url)) as { status?: number } & Record<string, unknown>;
    if (out && typeof out === 'object' && 'status' in out && Object.keys(out).length === 1) {
      return { ok: false, status: out.status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => out };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const prList = (n: number) => ({
  pullRequests: Array.from({ length: n }, (_, i) => ({
    key: String(i + 1), title: `t${i + 1}`, branch: `b${i + 1}`, base: 'main', analysisDate: '2026-10-05T10:00:00Z',
  })),
});

describe('toMeasureMap / parseOperator', () => {
  it('reads value and period.value, skips non numbers', () => {
    expect(toMeasureMap([{ metric: 'a', value: '1.5' }, { metric: 'new_b', period: { value: '70' } }, { metric: 'c', value: 'x' }, { metric: 'd' }]))
      .toEqual({ a: 1.5, new_b: 70 });
  });
  it('parses the operator from the sensor messages', () => {
    expect(parseOperator('A test executes this line but does not detect the EqualityOperator mutation. Strengthen the assertions.')).toBe('EqualityOperator');
    expect(parseOperator('No test reaches this line (BlockStatement mutant not executed). Add a test that exercises it.')).toBe('BlockStatement');
    expect(parseOperator('something else')).toBe('');
  });
});

describe('SonarApi requests', () => {
  it('encodes parameters and prefixes the base url', async () => {
    const { fn, calls } = fakeFetch(() => ({ pullRequests: [] }));
    await new SonarApi(fn, Date.now, '/sonar').loadProject({ key: 'a:b c', name: 'n' });
    expect(calls[0]).toBe('/sonar/api/project_pull_requests/list?project=a%3Ab%20c');
  });

  it('listProjects paginates', async () => {
    const page = (p: number) => ({ paging: { total: PAGE_SIZE + 2 }, components: Array.from({ length: p === 1 ? PAGE_SIZE : 2 }, (_, i) => ({ key: `k${p}-${i}`, name: `n${p}-${i}` })) });
    const { fn, calls } = fakeFetch((url) => page(url.includes('p=2') ? 2 : 1));
    const projects = await new SonarApi(fn).listProjects();
    expect(projects).toHaveLength(PAGE_SIZE + 2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('qualifiers=TRK');
  });
});

describe('loadProject', () => {
  const measures = (score?: string) => ({
    component: { measures: score === undefined ? [] : [
      { metric: 'new_mutation_score', period: { value: score } },
      { metric: 'new_mutation_total', period: { value: '40' } },
      { metric: 'mutation_threshold', value: '85' },
    ] },
  });
  it('builds PrResults with data, threshold and score', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(2) : measures(url.includes('pullRequest=1') ? '70.9' : undefined)));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.error).toBeNull();
    expect(res.prs[0]).toMatchObject({ hasData: true, score: 70.9, threshold: 85, thresholdAssumed: false });
    expect(res.prs[1]).toMatchObject({ hasData: false, score: null });
  });
  it('missing threshold falls back to 80 and is flagged', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(1) : { component: { measures: [{ metric: 'new_mutation_score', value: '50' }] } }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.prs[0]).toMatchObject({ threshold: 80, thresholdAssumed: true });
  });
  it('a failing request becomes an error result, never a rejection', async () => {
    const { fn } = fakeFetch(() => ({ status: 403 }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.error).toContain('403');
    expect(res.prs).toEqual([]);
  });
  it('a PR that Sonar has no measures for (404) counts as no data', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(1) : { status: 404 }));
    const res = await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(res.error).toBeNull();
    expect(res.prs[0].hasData).toBe(false);
  });
});

describe('limiter and cache', () => {
  it('never runs more than MAX_CONCURRENCY requests at once', async () => {
    let active = 0;
    let peak = 0;
    const { fn } = fakeFetch(async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return url.includes('project_pull_requests') ? prList(30) : { component: { measures: [] } };
    });
    await new SonarApi(fn).loadProject({ key: 'p', name: 'p' });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY);
  });
  it('serves repeated identical requests from cache until the TTL expires or it is cleared', async () => {
    let t = 0;
    const { fn, calls } = fakeFetch(() => ({ pullRequests: [] }));
    const api = new SonarApi(fn, () => t);
    await api.loadProject({ key: 'p', name: 'p' });
    await api.loadProject({ key: 'p', name: 'p' });
    expect(calls).toHaveLength(1);
    t = CACHE_TTL_MS + 1;
    await api.loadProject({ key: 'p', name: 'p' });
    expect(calls).toHaveLength(2);
    api.clearCache();
    await api.loadProject({ key: 'p', name: 'p' });
    expect(calls).toHaveLength(3);
  });
  it('failed requests are not cached', async () => {
    let fail = true;
    const { fn, calls } = fakeFetch(() => (fail ? { status: 500 } : { pullRequests: [] }));
    const api = new SonarApi(fn);
    expect((await api.loadProject({ key: 'p', name: 'p' })).error).not.toBeNull();
    fail = false;
    expect((await api.loadProject({ key: 'p', name: 'p' })).error).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe('files, survivors, metrics', () => {
  it('loadFiles keeps only files with mutation data and maps the measures', async () => {
    const { fn } = fakeFetch(() => ({
      paging: { total: 2 },
      components: [
        { key: 'p:a.ts', path: 'a.ts', language: 'ts', measures: [
          { metric: 'new_mutation_score', period: { value: '50' } }, { metric: 'new_mutation_alive', period: { value: '4' } },
          { metric: 'new_mutation_lines', period: { value: '9' } }, { metric: 'mutation_score', value: '55' }] },
        { key: 'p:b.ts', path: 'b.ts', language: 'ts', measures: [] },
      ],
    }));
    expect(await new SonarApi(fn).loadFiles('p', '1')).toEqual([
      { fileKey: 'p:a.ts', path: 'a.ts', language: 'ts', score: 50, alive: 4, changedLines: 9, wholeFileScore: 55 },
    ]);
  });
  it('loadFiles paginates beyond 500 components', async () => {
    const comp = (i: number) => ({ key: `p:f${i}`, path: `f${i}`, language: 'ts', measures: [{ metric: 'new_mutation_score', period: { value: '1' } }] });
    const { fn, calls } = fakeFetch((url) => ({ paging: { total: PAGE_SIZE + 1 }, components: url.includes('p=2') ? [comp(PAGE_SIZE)] : Array.from({ length: PAGE_SIZE }, (_, i) => comp(i)) }));
    expect(await new SonarApi(fn).loadFiles('p', '1')).toHaveLength(PAGE_SIZE + 1);
    expect(calls).toHaveLength(2);
  });
  it('loadSurvivors maps rule to status, resolves paths and parses the operator', async () => {
    const { fn, calls } = fakeFetch(() => ({
      paging: { total: 2 },
      components: [{ key: 'p:a.ts', path: 'a.ts' }],
      issues: [
        { component: 'p:a.ts', line: 10, rule: 'external_mutation-report:survived', message: 'A test executes this line but does not detect the Eq mutation. x' },
        { component: 'p:a.ts', line: 3, rule: 'external_mutation-report:no-coverage', message: 'No test reaches this line (Block mutant not executed). y' },
      ],
    }));
    const rows = await new SonarApi(fn).loadSurvivors('p', 'feature/x');
    expect(rows).toEqual([
      { fileKey: 'p:a.ts', path: 'a.ts', line: 3, status: 'NO_COVERAGE', operator: 'Block' },
      { fileKey: 'p:a.ts', path: 'a.ts', line: 10, status: 'SURVIVED', operator: 'Eq' },
    ]);
    expect(calls[0]).toContain('pullRequest=feature%2Fx');
  });
  it('loadMetrics keeps only the Mutation Analysis domain', async () => {
    const { fn } = fakeFetch(() => ({ metrics: [
      { key: 'mutation_score', name: 'Mutation: Score', description: 'd', type: 'PERCENT', domain: 'Mutation Analysis' },
      { key: 'coverage', name: 'Coverage', description: '', type: 'PERCENT', domain: 'Coverage' },
    ] }));
    expect((await new SonarApi(fn).loadMetrics()).map((m) => m.key)).toEqual(['mutation_score']);
  });
  it('loadAllMeasures chunks long key lists and merges', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `m${i}`);
    const { fn, calls } = fakeFetch((url) => {
      const ks = decodeURIComponent(url.split('metricKeys=')[1]).split(',');
      return { component: { measures: ks.map((k) => ({ metric: k, value: '1' })) } };
    });
    const all = await new SonarApi(fn).loadAllMeasures('p', '1', keys);
    expect(Object.keys(all)).toHaveLength(120);
    expect(calls).toHaveLength(3);
  });
});

describe('loadPullRequest', () => {
  it('returns the PR result or null when the PR is not in the list', async () => {
    const { fn } = fakeFetch((url) => (url.includes('project_pull_requests') ? prList(2) : { component: { measures: [{ metric: 'new_mutation_score', value: '90' }] } }));
    const api = new SonarApi(fn);
    expect((await api.loadPullRequest('p', '2'))?.score).toBe(90);
    expect(await api.loadPullRequest('p', '99')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: FAIL (cannot resolve `../src/api`).

- [ ] **Step 3: Implement `frontend/src/api.ts`**

```ts
import { sonarBase } from './format';
import {
  DEFAULT_THRESHOLD, type DataSource, type FileRow, type MetricInfo, type PrResult, type ProjectRef, type ProjectResult,
  type PullRequestRef, type SurvivorRow,
} from './types';

export const MAX_CONCURRENCY = 6;
export const CACHE_TTL_MS = 5 * 60_000;
export const PAGE_SIZE = 500;
export const MAX_METRIC_KEYS = 50;
export const SURVIVOR_RULES = 'external_mutation-report:survived,external_mutation-report:no-coverage';
export const PR_METRICS = [
  'new_mutation_score', 'mutation_threshold', 'new_mutation_total', 'new_mutation_killed', 'new_mutation_survived',
  'new_mutation_no_coverage', 'new_mutation_timed_out', 'new_mutation_memory_error', 'new_mutation_unknown',
  'new_mutation_test_strength',
];
const FILE_METRICS = ['new_mutation_score', 'new_mutation_alive', 'new_mutation_lines', 'mutation_score', 'new_mutation_total'];
const MUTATION_DOMAIN = 'Mutation Analysis';

type Params = Record<string, string | number | undefined>;
interface RawMeasure { metric: string; value?: string; period?: { value?: string } }

export function toMeasureMap(measures: RawMeasure[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of measures) {
    const raw = m.value ?? m.period?.value;
    if (raw === undefined) continue;
    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n)) out[m.metric] = n;
  }
  return out;
}

export function parseOperator(message: string): string {
  const a = /detect the (\S+) mutation/.exec(message);
  if (a) return a[1];
  const b = /\((\S+) mutant not executed\)/.exec(message);
  return b ? b[1] : '';
}

class HttpError extends Error {
  constructor(public status: number, path: string) {
    super(`HTTP ${status} ${path}`);
  }
}

export class SonarApi implements DataSource {
  private cache = new Map<string, { at: number; value: Promise<unknown> }>();
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(
    private fetchFn: typeof fetch = (...args) => fetch(...args),
    private now: () => number = Date.now,
    private baseUrl: string = sonarBase(),
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  /** Counting semaphore with direct hand-off, so the cap is never exceeded. */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENCY) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }

  private get<T>(path: string, params: Params): Promise<T> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.baseUrl}${path}?${qs}`;
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
    const value = this.slot(async () => {
      const res = await this.fetchFn(url, { credentials: 'same-origin' });
      if (!res.ok) throw new HttpError(res.status, path);
      return (await res.json()) as T;
    });
    this.cache.set(url, { at: this.now(), value });
    value.catch(() => this.cache.delete(url));
    return value;
  }

  private async all<T, R>(path: string, params: Params, pick: (r: R) => T[]): Promise<T[]> {
    const out: T[] = [];
    for (let p = 1; ; p++) {
      const r = await this.get<R & { paging?: { total?: number } }>(path, { ...params, ps: PAGE_SIZE, p });
      const items = pick(r);
      out.push(...items);
      const total = r.paging?.total ?? out.length;
      if (items.length === 0 || out.length >= total) break;
    }
    return out;
  }

  async listProjects(): Promise<ProjectRef[]> {
    const items = await this.all<{ key: string; name: string }, { components: { key: string; name: string }[] }>(
      '/api/components/search', { qualifiers: 'TRK' }, (r) => r.components ?? []);
    return items.map((c) => ({ key: c.key, name: c.name }));
  }

  private async pullRequests(projectKey: string): Promise<PullRequestRef[]> {
    const r = await this.get<{ pullRequests?: Array<{ key: string; title?: string; branch?: string; base?: string; target?: string; analysisDate?: string }> }>(
      '/api/project_pull_requests/list', { project: projectKey });
    return (r.pullRequests ?? []).map((p) => ({
      key: p.key, title: p.title ?? '', branch: p.branch ?? '', base: p.base ?? p.target ?? '', analysisDate: p.analysisDate ?? '',
    }));
  }

  private async measures(component: string, prKey: string, keys: string[]): Promise<Record<string, number>> {
    const r = await this.get<{ component?: { measures?: RawMeasure[] } }>('/api/measures/component', {
      component, pullRequest: prKey, metricKeys: keys.join(','),
    });
    return toMeasureMap(r.component?.measures ?? []);
  }

  private async prResult(projectKey: string, pr: PullRequestRef): Promise<PrResult> {
    let measures: Record<string, number> = {};
    try {
      measures = await this.measures(projectKey, pr.key, PR_METRICS);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e; // no analysis data for this PR: treat as no data
    }
    const score = measures.new_mutation_score ?? null;
    const hasData = Object.keys(measures).some((k) => k.includes('mutation'));
    const hasThreshold = measures.mutation_threshold !== undefined;
    return {
      pr, hasData, score, measures,
      threshold: hasThreshold ? measures.mutation_threshold : DEFAULT_THRESHOLD,
      thresholdAssumed: !hasThreshold,
    };
  }

  async loadProject(project: ProjectRef): Promise<ProjectResult> {
    try {
      const prs = await this.pullRequests(project.key);
      const results = await Promise.all(prs.map((p) => this.prResult(project.key, p)));
      return { project, prs: results, error: null };
    } catch (e) {
      return { project, prs: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  async loadPullRequest(projectKey: string, prKey: string): Promise<PrResult | null> {
    const pr = (await this.pullRequests(projectKey)).find((p) => p.key === prKey);
    return pr ? this.prResult(projectKey, pr) : null;
  }

  async loadFiles(projectKey: string, prKey: string): Promise<FileRow[]> {
    type Comp = { key: string; path?: string; name?: string; language?: string; measures?: RawMeasure[] };
    const comps = await this.all<Comp, { components: Comp[] }>(
      '/api/measures/component_tree',
      { component: projectKey, pullRequest: prKey, qualifiers: 'FIL', metricKeys: FILE_METRICS.join(',') },
      (r) => r.components ?? []);
    const rows: FileRow[] = [];
    for (const c of comps) {
      const m = toMeasureMap(c.measures ?? []);
      if (m.new_mutation_total === undefined && m.new_mutation_score === undefined) continue;
      rows.push({
        fileKey: c.key, path: c.path ?? c.name ?? c.key, language: c.language ?? '',
        score: m.new_mutation_score ?? null, alive: m.new_mutation_alive ?? 0,
        changedLines: m.new_mutation_lines ?? null, wholeFileScore: m.mutation_score ?? null,
      });
    }
    return rows;
  }

  async loadSurvivors(projectKey: string, prKey: string): Promise<SurvivorRow[]> {
    type Issue = { component: string; line?: number; rule: string; message?: string };
    const paths = new Map<string, string>();
    const issues = await this.all<Issue, { issues: Issue[]; components?: Array<{ key: string; path?: string }> }>(
      '/api/issues/search',
      { componentKeys: projectKey, pullRequest: prKey, rules: SURVIVOR_RULES },
      (r) => {
        for (const c of r.components ?? []) if (c.path) paths.set(c.key, c.path);
        return r.issues ?? [];
      });
    return issues
      .filter((i) => i.line !== undefined)
      .map((i): SurvivorRow => ({
        fileKey: i.component,
        path: paths.get(i.component) ?? i.component,
        line: i.line as number,
        status: i.rule.endsWith(':no-coverage') ? 'NO_COVERAGE' : 'SURVIVED',
        operator: parseOperator(i.message ?? ''),
      }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  }

  async loadMetrics(): Promise<MetricInfo[]> {
    const r = await this.all<{ key: string; name: string; description?: string; type: string; domain?: string }, { metrics: Array<{ key: string; name: string; description?: string; type: string; domain?: string }> }>(
      '/api/metrics/search', {}, (x) => x.metrics ?? []);
    return r.filter((m) => m.domain === MUTATION_DOMAIN).map((m) => ({ key: m.key, name: m.name, description: m.description ?? '', type: m.type }));
  }

  async loadAllMeasures(projectKey: string, prKey: string, metricKeys: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (let i = 0; i < metricKeys.length; i += MAX_METRIC_KEYS) {
      Object.assign(out, await this.measures(projectKey, prKey, metricKeys.slice(i, i + MAX_METRIC_KEYS)));
    }
    return out;
  }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p .`
Expected: all PASS, `tsc` clean. If `loadFiles paginates` or the limiter test is flaky, fix the implementation, not the test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/test/api.test.ts
git commit -m "feat(dashboard): Sonar API client with limiter, cache, pagination"
```

---

### Task 6: Overview page

**Files:**
- Create: `frontend/src/ui/overview.ts`, `frontend/test/overview.test.ts`
- Modify: `frontend/src/entry-overview.ts`

**Interfaces:**
- Consumes: `DataSource`, model (`summarizeProject`, `summarizeOverview`, `sortProjects`, `SortKey`, `SortDir`), `h`, `injectStyles`, `fmt*`, `projectPageUrl`.
- Produces: `renderOverview(root: HTMLElement, data: DataSource, now?: () => Date): { reload(): Promise<void> }`. Row cells carry `data-col="<name>"`; rows `data-project="<key>"`; tiles `data-tile="failingOpen|passRate|projects|median"`; sort headers `th[data-sort="<SortKey>"]`; filter checkbox `input[data-filter="withData"]` (checked by default); refresh button `button[data-action="refresh"]`; per-row retry `button[data-action="retry"]`.

- [ ] **Step 1: Write the failing tests**

`frontend/test/overview.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOverview } from '../src/ui/overview';
import { FakeData, NOW, makePr, noData, project } from './fixtures';

const flush = () => vi.waitFor(() => expect(root.querySelector('[data-loading="true"]')).toBeNull());
let root: HTMLElement;
const mount = (data: FakeData) => renderOverview(root, data, () => NOW);
const rows = () => [...root.querySelectorAll('tbody tr[data-project]')].map((r) => r.getAttribute('data-project'));
const cell = (key: string, col: string) => root.querySelector(`tr[data-project="${key}"] [data-col="${col}"]`)?.textContent ?? '';
const tile = (name: string) => root.querySelector(`[data-tile="${name}"] .v`)?.textContent ?? '';

beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const sample = () => new FakeData([
  project('timeoff', [makePr('1', { score: 60 }), makePr('2', { score: 65 }), makePr('3', { score: 90 }), noData('4')]),
  project('policy', [makePr('5', { score: 95 })]),
  project('billing', [noData('6'), noData('7')]),
]);

describe('overview', () => {
  it('shows tiles and sorts by failing open PRs, no-data projects last (filter off)', async () => {
    mount(sample());
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(rows()).toEqual(['timeoff', 'policy', 'billing']);
    expect(tile('failingOpen')).toBe('2');
    expect(tile('projects')).toBe('2 / 3');
  });

  it('only-with-data filter is on by default and hides projects without data', async () => {
    mount(sample());
    await flush();
    expect(rows()).toEqual(['timeoff', 'policy']);
  });

  it('shows dashes, not zeros, for projects without data', async () => {
    mount(sample());
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(cell('billing', 'passRate')).toBe('-');
    expect(cell('billing', 'median')).toBe('-');
    expect(cell('billing', 'adoption')).toBe('0 / 2');
  });

  it('renders pass rate, median, adoption and latest PR', async () => {
    mount(sample());
    await flush();
    expect(cell('timeoff', 'passRate')).toContain('33.3%');
    expect(cell('timeoff', 'median')).toBe('65.0%');
    expect(cell('timeoff', 'adoption')).toBe('3 / 4 PRs');
    expect(cell('policy', 'latest')).toContain('#5');
    expect(cell('policy', 'latest')).toContain('PASS');
  });

  it('clicking a sort header re-sorts and toggles direction', async () => {
    mount(sample());
    await flush();
    const th = root.querySelector<HTMLElement>('th[data-sort="name"]')!;
    th.click();
    expect(rows()).toEqual(['policy', 'timeoff']);
    th.click();
    expect(rows()).toEqual(['timeoff', 'policy']);
  });

  it('a project that fails shows unavailable with retry; the rest still render', async () => {
    const data = sample();
    data.projects.push(project('secret', [], 'HTTP 403 /api/x'));
    mount(data);
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(cell('secret', 'failing')).toContain('unavailable');
    expect(rows()).toContain('policy');
    data.projects[3] = project('secret', [makePr('9', { score: 99 })]);
    root.querySelector<HTMLButtonElement>('tr[data-project="secret"] [data-action="retry"]')!.click();
    await vi.waitFor(() => expect(cell('secret', 'latest')).toContain('#9'));
  });

  it('a project with PRs only outside the window shows no PRs in the last 30 days', async () => {
    mount(new FakeData([project('old', [makePr('1', { hours: 24 * 60 })])]));
    await flush();
    root.querySelector<HTMLInputElement>('[data-filter="withData"]')!.click();
    expect(cell('old', 'latest')).toContain('no PRs in the last 30 days');
  });

  it('refresh clears the cache and reloads', async () => {
    const data = sample();
    mount(data);
    await flush();
    root.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
    await flush();
    expect(data.calls).toContain('clearCache');
    expect(data.calls.filter((c) => c === 'listProjects')).toHaveLength(2);
  });

  it('empty Sonar: shows an empty message, no crash', async () => {
    mount(new FakeData([]));
    await flush();
    expect(root.textContent).toContain('No projects');
  });

  it('project name links to the project page', async () => {
    mount(sample());
    await flush();
    const a = root.querySelector<HTMLAnchorElement>('tr[data-project="timeoff"] a')!;
    expect(a.getAttribute('href')).toContain('/project/extension/mutationreport/project?id=timeoff');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run test/overview.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `frontend/src/ui/overview.ts`**

```ts
import { fmtAge, fmtPct, projectPageUrl } from '../format';
import { isFailing, sortProjects, summarizeOverview, summarizeProject, type ProjectSummary, type SortDir, type SortKey } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PrResult, ProjectRef, ProjectResult } from '../types';
import { clear, h } from './dom';

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Project' },
  { key: 'failingOpen', label: 'Failing open PRs' },
  { key: 'passRate', label: 'Pass rate 30d' },
  { key: 'medianScore', label: 'Median score' },
  { key: 'adoption', label: 'Adoption' },
  { key: 'latest', label: 'Latest PR' },
];

export function renderOverview(root: HTMLElement, data: DataSource, now: () => Date = () => new Date()): { reload(): Promise<void> } {
  injectStyles();
  const results = new Map<string, ProjectResult>();
  let projects: ProjectRef[] = [];
  let loading = true;
  let sortKey: SortKey = 'failingOpen';
  let sortDir: SortDir = 'desc';
  let onlyWithData = true;

  const body = h('div', { class: 'md' });
  root.replaceChildren(body);

  function latestCell(s: ProjectSummary): HTMLElement {
    const td = h('td', { 'data-col': 'latest' });
    if (s.error) return td;
    if (s.total === 0) {
      td.append(h('span', { class: 'md-muted' }, 'no PRs in the last 30 days'));
      return td;
    }
    const r = s.latest as PrResult;
    if (!r.hasData) {
      td.append(`#${r.pr.key} `, h('span', { class: 'md-muted' }, 'no mutation data'));
      return td;
    }
    const failing = isFailing(r);
    td.append(`#${r.pr.key} `, h('span', { class: `md-pill ${failing ? 'fail' : 'pass'}` }, `${failing ? 'FAIL' : 'PASS'} ${fmtPct(r.score)}`), ` ${fmtAge(r.pr.analysisDate, now())}`);
    return td;
  }

  function row(s: ProjectSummary): HTMLElement {
    const tr = h('tr', { 'data-project': s.key });
    tr.append(h('td', {}, h('a', { href: projectPageUrl(s.key) }, h('b', {}, s.name))));
    if (s.error) {
      tr.append(
        h('td', { 'data-col': 'failing', colspan: 5 }, h('span', { class: 'md-muted' }, `unavailable (${s.error}) `),
          h('button', { class: 'md-link', 'data-action': 'retry', onclick: () => retry(s.key) }, 'retry')),
      );
      return tr;
    }
    tr.append(
      h('td', { 'data-col': 'failing', class: s.failingOpen ? 'md-fail' : 'md-muted' }, String(s.failingOpen)),
      h('td', { 'data-col': 'passRate' }, fmtPct(s.passRate, s.passRate === null ? 1 : 0)),
      h('td', { 'data-col': 'median' }, fmtPct(s.medianScore)),
      h('td', { 'data-col': 'adoption', class: s.total > 0 && s.withData === 0 ? 'md-fail' : '' }, `${s.withData} / ${s.total}${s.withData > 0 ? ' PRs' : ''}`),
      latestCell(s),
    );
    return tr;
  }

  function paint(): void {
    const list = [...results.values()];
    const o = summarizeOverview(list, now());
    let summaries = list.map((r) => summarizeProject(r, now()));
    if (onlyWithData) summaries = summaries.filter((s) => s.withData > 0 || s.error !== null);
    summaries = sortProjects(summaries, sortKey, sortDir);

    const kpi = (name: string, v: string, label: string, cls = '') =>
      h('div', { class: 'md-kpi', 'data-tile': name }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'l' }, label));

    const head = h('tr', {}, ...COLUMNS.map((c) =>
      h('th', { class: `sortable ${sortKey === c.key ? sortDir : ''}`, 'data-sort': c.key, onclick: () => {
        if (sortKey === c.key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        else { sortKey = c.key; sortDir = c.key === 'name' ? 'asc' : 'desc'; }
        paint();
      } }, c.label)));

    clear(body);
    body.append(
      h('h1', {}, 'Mutation overview'),
      h('div', { class: 'md-kpis' },
        kpi('failingOpen', String(o.failingOpen), 'open PRs failing now', o.failingOpen ? 'md-fail' : ''),
        kpi('passRate', fmtPct(o.passRate, 0), 'PR pass rate (30d)'),
        kpi('projects', `${o.projectsWithData} / ${o.projectsTotal}`, 'projects using mutation'),
        kpi('median', fmtPct(o.medianScore), 'median new-code score')),
      h('div', { class: 'md-filters' },
        h('label', {}, h('input', { type: 'checkbox', 'data-filter': 'withData', ...(onlyWithData ? { checked: 'checked' } : {}), onclick: (e: Event) => {
          onlyWithData = (e.target as HTMLInputElement).checked;
          paint();
        } }), ' Only projects with mutation data'),
        h('span', {}, 'Last 30 days'),
        h('button', { class: 'md-link', 'data-action': 'refresh', onclick: () => void reload() }, 'Refresh'),
        loading ? h('span', { 'data-loading': 'true' }, `Loading ${results.size} / ${projects.length} projects...`) : null),
      projects.length === 0 && !loading
        ? h('p', { class: 'md-muted' }, 'No projects found.')
        : h('table', { class: 'md-table' }, h('thead', {}, head), h('tbody', {}, ...summaries.map(row))),
    );
  }

  async function retry(key: string): Promise<void> {
    const p = projects.find((x) => x.key === key);
    if (!p) return;
    results.set(key, await data.loadProject(p));
    paint();
  }

  async function reload(): Promise<void> {
    data.clearCache();
    results.clear();
    loading = true;
    paint();
    try {
      projects = await data.listProjects();
    } catch (e) {
      loading = false;
      clear(body);
      body.append(h('h1', {}, 'Mutation overview'), h('p', { class: 'md-fail' }, `Could not load projects: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    paint();
    await Promise.all(projects.map(async (p) => {
      results.set(p.key, await data.loadProject(p));
      paint();
    }));
    loading = false;
    paint();
  }

  // First load must not clear a cache that has nothing in it, but a second call to reload() must.
  const first = (async () => {
    loading = true;
    paint();
    try {
      projects = await data.listProjects();
    } catch (e) {
      loading = false;
      clear(body);
      body.append(h('h1', {}, 'Mutation overview'), h('p', { class: 'md-fail' }, `Could not load projects: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    paint();
    await Promise.all(projects.map(async (p) => {
      results.set(p.key, await data.loadProject(p));
      paint();
    }));
    loading = false;
    paint();
  })();
  void first;

  return { reload };
}
```

Note: the duplicated load logic above is deliberate for the first pass; the refactor step below removes the duplication.

- [ ] **Step 4: Run, expect PASS (or fix)**

Run: `cd frontend && npx vitest run test/overview.test.ts && npx tsc --noEmit -p .`
Expected: PASS. The `refresh` test expects `listProjects` twice (initial + refresh) and `clearCache` once; the initial load must not call `clearCache`.

- [ ] **Step 5: Refactor out the duplicated load, keep tests green**

Replace the duplicated `first` IIFE and `reload` body with one function `load(clearFirst: boolean)`:
```ts
  async function load(clearFirst: boolean): Promise<void> {
    if (clearFirst) data.clearCache();
    results.clear();
    loading = true;
    paint();
    try {
      projects = await data.listProjects();
    } catch (e) {
      loading = false;
      clear(body);
      body.append(h('h1', {}, 'Mutation overview'), h('p', { class: 'md-fail' }, `Could not load projects: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    paint();
    await Promise.all(projects.map(async (p) => {
      results.set(p.key, await data.loadProject(p));
      paint();
    }));
    loading = false;
    paint();
  }
  const reload = () => load(true);
  void load(false);
  return { reload };
```
(delete the old `reload` function, the `first` IIFE and the old `return { reload }`; the `Refresh` button handler already calls `reload()`).
Run: `cd frontend && npx vitest run test/overview.test.ts` -> PASS.

- [ ] **Step 6: Wire the entry**

`frontend/src/entry-overview.ts`:
```ts
import { SonarApi } from './api';
import { renderOverview } from './ui/overview';

type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/overview', (options) => {
  renderOverview(options.el, new SonarApi());
  return () => {
    options.el.innerHTML = '';
  };
});
```
Update `frontend/test/entry.test.ts`: the overview test's `expect(el.textContent).toContain('Mutation overview')` still holds (the page renders the heading synchronously); `SonarApi` is constructed without network calls until `listProjects`, which runs `fetch`; stub it in that test with `vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ components: [], paging: { total: 0 } }) }))`.
Run: `cd frontend && npx vitest run` -> all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui/overview.ts frontend/src/entry-overview.ts frontend/test/overview.test.ts frontend/test/entry.test.ts
git commit -m "feat(dashboard): mutation overview page"
```

---

### Task 7: Project page - PR list and routing

**Files:**
- Create: `frontend/src/ui/prList.ts`, `frontend/src/ui/projectPage.ts`, `frontend/test/prList.test.ts`, `frontend/test/projectPage.test.ts`
- Modify: `frontend/src/entry-project.ts`

**Interfaces:**
- Consumes: Task 3 to 5 units; `renderPrDetail` (Task 8, stubbed here via an injectable parameter).
- Produces:

```ts
// prList.ts
renderPrList(root: HTMLElement, data: DataSource, project: ProjectRef, onOpen: (pr: PrResult) => void, now?: () => Date): Promise<void>
// projectPage.ts
type DetailRenderer = (root: HTMLElement, data: DataSource, projectKey: string, pr: PrResult, onBack: () => void, now?: () => Date) => Promise<void> | void
renderProjectPage(root: HTMLElement, data: DataSource, ctx: PageContext, now?: () => Date, detail?: DetailRenderer): Promise<void>
```
Markup contract: tiles `[data-tile="failingOpen|passRate|median|withData"]`; filter selects `select[data-filter="status"]` (values `all|failing|passing|nodata`) and `select[data-filter="days"]` (`7|14|30`); rows `tr[data-pr="<key>"]` with cells `data-col="status|analyzed|score|survived|noCoverage"`; PR link `button[data-action="open"]`.

- [ ] **Step 1: Write the failing tests**

`frontend/test/prList.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPrList } from '../src/ui/prList';
import { FakeData, NOW, makePr, noData, project } from './fixtures';

let root: HTMLElement;
const keys = () => [...root.querySelectorAll('tbody tr[data-pr]')].map((r) => r.getAttribute('data-pr'));
const cell = (k: string, c: string) => root.querySelector(`tr[data-pr="${k}"] [data-col="${c}"]`)?.textContent ?? '';
const tile = (n: string) => root.querySelector(`[data-tile="${n}"] .v`)?.textContent ?? '';

beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const data = () => new FakeData([project('p', [
  makePr('14', { score: 70.9, hours: 3, measures: { new_mutation_survived: 19, new_mutation_no_coverage: 12 } }),
  makePr('13', { score: 84, hours: 30, measures: { new_mutation_survived: 3, new_mutation_no_coverage: 1 } }),
  noData('12', 60),
  makePr('10', { score: 80, hours: 24 * 9 }),
  makePr('1', { score: 50, hours: 24 * 40 }),
])]);

describe('PR list', () => {
  it('lists PRs of the last 30 days, newest first, and the tiles', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(keys()).toEqual(['14', '13', '12', '10']);
    expect(tile('failingOpen')).toBe('1');
    expect(tile('withData')).toBe('3 / 4');
    expect(tile('passRate')).toBe('67%');
  });

  it('shows status, score and counts; dashes for a PR without data', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(cell('14', 'status')).toBe('FAIL');
    expect(cell('14', 'score')).toContain('70.9%');
    expect(cell('14', 'survived')).toBe('19');
    expect(cell('13', 'status')).toBe('PASS');
    expect(cell('12', 'status')).toBe('NO DATA');
    expect(cell('12', 'score')).toBe('-');
    expect(cell('12', 'survived')).toBe('-');
  });

  it('a score equal to the threshold shows PASS', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(cell('10', 'status')).toBe('PASS');
  });

  it('status filter', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    const sel = root.querySelector<HTMLSelectElement>('select[data-filter="status"]')!;
    sel.value = 'failing';
    sel.dispatchEvent(new Event('change'));
    expect(keys()).toEqual(['14']);
    sel.value = 'nodata';
    sel.dispatchEvent(new Event('change'));
    expect(keys()).toEqual(['12']);
  });

  it('date filter', async () => {
    await renderPrList(root, data(), { key: 'p', name: 'p' }, () => {}, () => NOW);
    const sel = root.querySelector<HTMLSelectElement>('select[data-filter="days"]')!;
    sel.value = '7';
    sel.dispatchEvent(new Event('change'));
    expect(keys()).toEqual(['14', '13', '12']);
  });

  it('clicking a PR calls onOpen with its result', async () => {
    const onOpen = vi.fn();
    await renderPrList(root, data(), { key: 'p', name: 'p' }, onOpen, () => NOW);
    root.querySelector<HTMLButtonElement>('tr[data-pr="13"] [data-action="open"]')!.click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ pr: expect.objectContaining({ key: '13' }) }));
  });

  it('zero PRs: message, no crash', async () => {
    await renderPrList(root, new FakeData([project('p', [])]), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('No pull requests in the last 30 days');
  });

  it('load error: message with the cause', async () => {
    await renderPrList(root, new FakeData([project('p', [], 'HTTP 403 /api/x')]), { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('HTTP 403');
  });

  it('a threshold that was assumed is flagged', async () => {
    const d = new FakeData([project('p', [makePr('1', { thresholdAssumed: true })])]);
    await renderPrList(root, d, { key: 'p', name: 'p' }, () => {}, () => NOW);
    expect(root.textContent).toContain('threshold assumed');
  });
});
```

`frontend/test/projectPage.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderProjectPage } from '../src/ui/projectPage';
import { FakeData, NOW, makePr, project } from './fixtures';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});
const data = () => new FakeData([project('p', [makePr('14', { score: 70 }), makePr('13', { score: 90 })])]);

describe('project page routing', () => {
  it('project context shows the PR list', async () => {
    await renderProjectPage(root, data(), { kind: 'project', project: 'p' }, () => NOW);
    expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2);
  });

  it('pr context shows the detail of that PR with a back link', async () => {
    const detail = vi.fn((r: HTMLElement) => { r.textContent = 'DETAIL'; });
    await renderProjectPage(root, data(), { kind: 'pr', project: 'p', pr: '14' }, () => NOW, detail);
    expect(root.textContent).toContain('DETAIL');
    expect(detail.mock.calls[0][3].pr.key).toBe('14');
    expect(root.querySelector('[data-action="back"]')).not.toBeNull();
  });

  it('clicking a row opens the detail, back returns to the list', async () => {
    const detail = vi.fn((r: HTMLElement, _d, _p, _pr, onBack: () => void) => {
      r.replaceChildren();
      r.textContent = 'DETAIL';
      const b = document.createElement('button');
      b.setAttribute('data-action', 'back');
      b.onclick = onBack;
      r.append(b);
    });
    await renderProjectPage(root, data(), { kind: 'project', project: 'p' }, () => NOW, detail);
    root.querySelector<HTMLButtonElement>('tr[data-pr="13"] [data-action="open"]')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('DETAIL'));
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2));
  });

  it('pr context for a PR Sonar no longer has: message and the list', async () => {
    await renderProjectPage(root, data(), { kind: 'pr', project: 'p', pr: '999' }, () => NOW);
    expect(root.textContent).toContain('Pull request 999 was not found');
    expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2);
  });

  it('branch context shows a note about main and still lists the PRs', async () => {
    await renderProjectPage(root, data(), { kind: 'branch', project: 'p', name: 'main' }, () => NOW);
    expect(root.querySelector('.md-note')?.textContent).toContain('pull requests');
    expect(root.querySelectorAll('tr[data-pr]')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run test/prList.test.ts test/projectPage.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `frontend/src/ui/prList.ts`**

```ts
import { fmtAge, fmtInt, fmtPct, scoreColor } from '../format';
import { inWindow, isFailing, isOpen, isPassing, median } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, PrResult, ProjectRef } from '../types';
import { clear, h } from './dom';

export function scoreBar(r: PrResult): HTMLElement {
  const pct = Math.max(0, Math.min(100, r.score ?? 0));
  return h('span', { class: 'md-bar' },
    h('i', { style: `width:${pct}%;background:${scoreColor(r.score, r.threshold)}` }),
    h('b', { style: `left:${Math.max(0, Math.min(100, r.threshold))}%` }));
}

export function statusPill(r: PrResult): HTMLElement {
  if (!r.hasData) return h('span', { class: 'md-pill none' }, 'NO DATA');
  if (isFailing(r)) return h('span', { class: 'md-pill fail' }, 'FAIL');
  if (isPassing(r)) return h('span', { class: 'md-pill pass' }, 'PASS');
  return h('span', { class: 'md-pill none' }, 'NO SCORE');
}

type StatusFilter = 'all' | 'failing' | 'passing' | 'nodata';

export async function renderPrList(
  root: HTMLElement, data: DataSource, project: ProjectRef, onOpen: (pr: PrResult) => void, now: () => Date = () => new Date(),
): Promise<void> {
  injectStyles();
  const box = h('div', { class: 'md' });
  root.replaceChildren(box);
  box.append(h('h1', {}, `Mutation - ${project.name}`), h('p', { class: 'md-muted' }, 'Loading pull requests...'));

  const res = await data.loadProject(project);
  clear(box);
  box.append(h('h1', {}, `Mutation - ${project.name}`));
  if (res.error) {
    box.append(h('p', { class: 'md-fail' }, `Could not load pull requests: ${res.error}`));
    return;
  }
  const inWin = res.prs.filter((r) => inWindow(r, now()));
  if (inWin.length === 0) {
    box.append(h('p', { class: 'md-muted' }, 'No pull requests in the last 30 days.'));
    return;
  }

  let status: StatusFilter = 'all';
  let days = 30;
  const holder = h('div', {});

  function paint(): void {
    const visible = inWin
      .filter((r) => {
        const age = (now().getTime() - new Date(r.pr.analysisDate).getTime()) / 86_400_000;
        if (age > days) return false;
        if (status === 'failing') return isFailing(r);
        if (status === 'passing') return isPassing(r);
        if (status === 'nodata') return !r.hasData;
        return true;
      })
      .sort((a, b) => b.pr.analysisDate.localeCompare(a.pr.analysisDate));

    const withData = inWin.filter((r) => r.hasData);
    const passRate = withData.length ? (withData.filter(isPassing).length / withData.length) * 100 : null;
    const med = median(withData.filter((r) => r.score !== null).map((r) => r.score as number));
    const failing = inWin.filter((r) => isFailing(r) && isOpen(r, now())).length;
    const kpi = (n: string, v: string, l: string, cls = '') =>
      h('div', { class: 'md-kpi', 'data-tile': n }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'l' }, l));

    clear(holder);
    holder.append(
      h('div', { class: 'md-kpis' },
        kpi('failingOpen', String(failing), 'open PRs failing now', failing ? 'md-fail' : ''),
        kpi('passRate', fmtPct(passRate, 0), `pass rate (${withData.filter(isPassing).length} / ${withData.length} PRs)`),
        kpi('median', fmtPct(med), 'median new-code score'),
        kpi('withData', `${withData.length} / ${inWin.length}`, 'PRs with mutation data')),
      h('table', { class: 'md-table' },
        h('thead', {}, h('tr', {}, ...['PR', 'Title', 'Status', 'Analyzed', 'New-code score', 'Survived', 'No coverage'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...visible.map((r) => h('tr', { 'data-pr': r.pr.key },
          h('td', {}, h('button', { class: 'md-link', 'data-action': 'open', onclick: () => onOpen(r) }, `#${r.pr.key}`)),
          h('td', {}, r.pr.title),
          h('td', { 'data-col': 'status' }, statusPill(r)),
          h('td', { 'data-col': 'analyzed' }, fmtAge(r.pr.analysisDate, now())),
          h('td', { 'data-col': 'score' }, fmtPct(r.score), r.score !== null ? scoreBar(r) : null,
            r.thresholdAssumed && r.hasData ? h('span', { class: 'md-muted' }, ' (threshold assumed)') : null),
          h('td', { 'data-col': 'survived' }, r.hasData ? fmtInt(r.measures.new_mutation_survived) : '-'),
          h('td', { 'data-col': 'noCoverage' }, r.hasData ? fmtInt(r.measures.new_mutation_no_coverage) : '-'))))),
      h('p', { class: 'md-muted' }, 'Black tick on each bar = threshold.'),
    );
  }

  const select = (name: string, options: Array<[string, string]>, on: (v: string) => void) =>
    h('select', { 'data-filter': name, onchange: (e: Event) => { on((e.target as HTMLSelectElement).value); paint(); } },
      ...options.map(([v, l]) => h('option', { value: v, ...(v === '30' || v === 'all' ? { selected: 'selected' } : {}) }, l)));

  box.append(
    h('div', { class: 'md-filters' }, 'Status ',
      select('status', [['all', 'All'], ['failing', 'Failing'], ['passing', 'Passing'], ['nodata', 'No data']], (v) => { status = v as StatusFilter; }),
      ' Date ',
      select('days', [['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']], (v) => { days = Number(v); })),
    holder,
  );
  paint();
}
```

- [ ] **Step 4: Implement `frontend/src/ui/projectPage.ts`**

```ts
import type { PageContext } from '../context';
import { injectStyles } from '../styles';
import type { DataSource, PrResult } from '../types';
import { h } from './dom';
import { renderPrList } from './prList';

export type DetailRenderer = (
  root: HTMLElement, data: DataSource, projectKey: string, pr: PrResult, onBack: () => void, now?: () => Date,
) => Promise<void> | void;

export async function renderProjectPage(
  root: HTMLElement, data: DataSource, ctx: PageContext, now: () => Date = () => new Date(), detail?: DetailRenderer,
): Promise<void> {
  injectStyles();
  const project = { key: ctx.project, name: ctx.project };

  async function showList(prefix?: HTMLElement): Promise<void> {
    await renderPrList(root, data, project, (pr) => void showDetail(pr), now);
    if (prefix) root.querySelector('.md')?.prepend(prefix);
  }

  async function showDetail(pr: PrResult): Promise<void> {
    if (detail) await detail(root, data, ctx.project, pr, () => void showList(), now);
    else root.textContent = `Pull request ${pr.pr.key}`;
    if (!root.querySelector('[data-action="back"]')) {
      const back = h('button', { class: 'md-link', 'data-action': 'back', onclick: () => void showList() }, 'All pull requests');
      root.querySelector('.md')?.prepend(back) ?? root.prepend(back);
    }
  }

  if (ctx.kind === 'pr') {
    const pr = await data.loadPullRequest(ctx.project, ctx.pr);
    if (pr) {
      await showDetail(pr);
      return;
    }
    await showList(h('div', { class: 'md-note' }, `Pull request ${ctx.pr} was not found. It may have been deleted by Sonar housekeeping. Showing all pull requests.`));
    return;
  }
  if (ctx.kind === 'branch') {
    await showList(h('div', { class: 'md-note' }, `This page shows pull requests only. The "${ctx.name}" branch is not summarized.`));
    return;
  }
  await showList();
}
```

- [ ] **Step 5: Wire the entry**

`frontend/src/entry-project.ts`:
```ts
import { SonarApi } from './api';
import { parseContext } from './context';
import { renderProjectPage } from './ui/projectPage';

type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/project', (options) => {
  void renderProjectPage(options.el, new SonarApi(), parseContext(options));
  return () => {
    options.el.innerHTML = '';
  };
});
```
(Task 8 passes the real detail renderer.) Update the project test in `frontend/test/entry.test.ts` like Task 6 (stub `fetch` returning `{ pullRequests: [] }`) and assert `el.textContent` contains `Mutation` after `await vi.waitFor(...)`.

- [ ] **Step 6: Run, expect PASS**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p .`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui/prList.ts frontend/src/ui/projectPage.ts frontend/src/entry-project.ts frontend/test/prList.test.ts frontend/test/projectPage.test.ts frontend/test/entry.test.ts
git commit -m "feat(dashboard): project page PR list and routing"
```

---

### Task 8: Project page - PR detail

**Files:**
- Create: `frontend/src/ui/prDetail.ts`, `frontend/test/prDetail.test.ts`
- Modify: `frontend/src/ui/projectPage.ts` (default renderer), `frontend/src/entry-project.ts` (no change needed after the default is set)

**Interfaces:**
- Consumes: `DataSource`, `PrResult`, `FileRow`, `SurvivorRow`, `MetricInfo`; `statusPill`, `scoreBar` from `prList.ts`; `codeUrl`, `fmt*`; `sortFilesWeakestFirst`.
- Produces: `renderPrDetail: DetailRenderer`. Markup contract: header `[data-part="score"]`; tiles `[data-tile="total|killed|survived|noCoverage|other|strength"]`; tabs `button[data-tab="files|survivors|languages|metrics"]`, panels `[data-panel="<tab>"]`; file rows `tr[data-file="<fileKey>"]`; survivor rows `tr[data-survivor]`; back button `[data-action="back"]`.

- [ ] **Step 1: Write the failing tests**

`frontend/test/prDetail.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPrDetail } from '../src/ui/prDetail';
import type { FileRow, SurvivorRow } from '../src/types';
import { FakeData, NOW, makePr, project } from './fixtures';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  root = document.getElementById('r')!;
});

const file = (path: string, score: number | null, alive = 1): FileRow =>
  ({ fileKey: `p:${path}`, path, language: 'ts', score, alive, changedLines: 10, wholeFileScore: score });
const surv = (path: string, line: number, status: 'SURVIVED' | 'NO_COVERAGE' = 'SURVIVED'): SurvivorRow =>
  ({ fileKey: `p:${path}`, path, line, status, operator: 'Eq' });

const pr = makePr('14', {
  score: 70.9,
  measures: { new_mutation_score: 70.9, new_mutation_total: 127, new_mutation_killed: 90, new_mutation_survived: 19, new_mutation_no_coverage: 12, new_mutation_timed_out: 3, new_mutation_memory_error: 2, new_mutation_unknown: 1, new_mutation_test_strength: 82.6 },
});
const data = (extra: Partial<FakeData> = {}) => Object.assign(new FakeData([project('p', [pr])],
  { 'p#14': [file('a.ts', 80), file('dates.ts', 46.2, 14), file('x.ts', null, 0)] },
  { 'p#14': [surv('dates.ts', 7), surv('dates.ts', 12, 'NO_COVERAGE'), surv('a.ts', 3)] },
  [{ key: 'mutation_score', name: 'Mutation: Score', description: 'Share killed', type: 'PERCENT' }, { key: 'new_mutation_total', name: 'Mutations: Total', description: '', type: 'INT' }],
  { mutation_score: 76, new_mutation_total: 127, new_mutation_typescript_total: 100, new_mutation_typescript_killed: 70, new_mutation_typescript_survived: 20, new_mutation_typescript_score: 70, new_mutation_python_total: 27, new_mutation_python_killed: 20, new_mutation_python_survived: 5, new_mutation_python_score: 74.1 }), extra);

const text = (sel: string) => root.querySelector(sel)?.textContent ?? '';
const open = async (d = data()) => { await renderPrDetail(root, d, 'p', pr, () => {}, () => NOW); };

describe('PR detail', () => {
  it('header shows verdict, score and threshold', async () => {
    await open();
    expect(text('[data-part="score"]')).toContain('70.9%');
    expect(root.textContent).toContain('threshold 80%');
    expect(root.textContent).toContain('FAIL');
    expect(root.textContent).toContain('feature/14');
  });

  it('tiles show counts; timeout/memory/unknown are summed; absent values are dashes', async () => {
    await open();
    expect(text('[data-tile="total"] .v')).toBe('127');
    expect(text('[data-tile="survived"] .v')).toBe('19');
    expect(text('[data-tile="other"] .v')).toBe('6');
    expect(text('[data-tile="strength"] .v')).toBe('82.6%');
    const sparse = makePr('15', { measures: { new_mutation_score: 90 } });
    await renderPrDetail(root, data(), 'p', sparse, () => {}, () => NOW);
    expect(text('[data-tile="total"] .v')).toBe('-');
    expect(text('[data-tile="other"] .v')).toBe('-');
    expect(text('[data-tile="strength"] .v')).toBe('-');
  });

  it('files tab: weakest first, no-score files last', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelectorAll('tr[data-file]')).toHaveLength(3));
    expect([...root.querySelectorAll('tr[data-file]')].map((r) => r.getAttribute('data-file'))).toEqual(['p:dates.ts', 'p:a.ts', 'p:x.ts']);
    expect(root.querySelector('tr[data-file="p:x.ts"] [data-col="score"]')?.textContent).toBe('-');
  });

  it('survivors panel starts on the weakest file and follows the selected file', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-panel="files"] tr[data-survivor]')).toHaveLength(2));
    root.querySelector<HTMLElement>('tr[data-file="p:a.ts"]')!.click();
    expect(root.querySelectorAll('[data-panel="files"] tr[data-survivor]')).toHaveLength(1);
  });

  it('survivor lines link to Sonar code view', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelector('[data-panel="files"] tr[data-survivor] a')).not.toBeNull());
    const href = root.querySelector('[data-panel="files"] tr[data-survivor] a')!.getAttribute('href')!;
    expect(href).toContain('/code?id=p&pullRequest=14&selected=p%3Adates.ts&line=7');
  });

  it('survivors tab lists all and shows the count in the tab label', async () => {
    await open();
    await vi.waitFor(() => expect(root.querySelector('button[data-tab="survivors"]')!.textContent).toContain('(3)'));
    root.querySelector<HTMLButtonElement>('button[data-tab="survivors"]')!.click();
    expect(root.querySelectorAll('[data-panel="survivors"] tr[data-survivor]')).toHaveLength(3);
  });

  it('languages tab builds rows from per-language measures', async () => {
    await open();
    root.querySelector<HTMLButtonElement>('button[data-tab="languages"]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-panel="languages"] tr[data-lang]')).toHaveLength(2));
    expect(text('tr[data-lang="typescript"] [data-col="score"]')).toBe('70.0%');
  });

  it('all-metrics tab lists every mutation metric with its value', async () => {
    await open();
    root.querySelector<HTMLButtonElement>('button[data-tab="metrics"]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-panel="metrics"] tr[data-metric]')).toHaveLength(2));
    expect(text('tr[data-metric="mutation_score"] [data-col="value"]')).toBe('76');
  });

  it('empty files and survivors show a message instead of an empty table', async () => {
    await open(new FakeData([project('p', [pr])]));
    await vi.waitFor(() => expect(root.textContent).toContain('No files with mutation data'));
  });

  it('back button calls onBack', async () => {
    const onBack = vi.fn();
    await renderPrDetail(root, data(), 'p', pr, onBack, () => NOW);
    root.querySelector<HTMLButtonElement>('[data-action="back"]')!.click();
    expect(onBack).toHaveBeenCalled();
  });

  it('a failing sub-request shows an inline error and the rest of the page still works', async () => {
    const d = data();
    d.loadFiles = async () => { throw new Error('HTTP 500 files'); };
    await open(d);
    await vi.waitFor(() => expect(root.textContent).toContain('HTTP 500 files'));
    expect(text('[data-part="score"]')).toContain('70.9%');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd frontend && npx vitest run test/prDetail.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `frontend/src/ui/prDetail.ts`**

```ts
import { codeUrl, fmtAge, fmtInt, fmtPct } from '../format';
import { sortFilesWeakestFirst } from '../model';
import { injectStyles } from '../styles';
import type { DataSource, FileRow, PrResult, SurvivorRow } from '../types';
import { h } from './dom';
import { scoreBar, statusPill } from './prList';
import type { DetailRenderer } from './projectPage';

const LANGUAGES = ['typescript', 'javascript', 'csharp', 'java', 'python', 'go', 'other'];
const LANG_FIELDS = ['total', 'killed', 'survived', 'score'];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function survivorTable(rows: SurvivorRow[], projectKey: string, prKey: string, withFile: boolean): HTMLElement {
  return h('table', { class: 'md-table' },
    h('thead', {}, h('tr', {}, ...[withFile ? 'File' : null, 'Line', 'Status', 'Operator'].map((t) => (t ? h('th', {}, t) : null)))),
    h('tbody', {}, ...rows.map((s) => h('tr', { 'data-survivor': `${s.fileKey}:${s.line}` },
      withFile ? h('td', {}, s.path) : null,
      h('td', {}, h('a', { href: codeUrl(projectKey, prKey, s.fileKey, s.line), target: '_blank', rel: 'noopener' }, String(s.line))),
      h('td', { class: 'md-fail' }, s.status === 'SURVIVED' ? 'SURVIVED' : 'NO COVERAGE'),
      h('td', {}, s.operator || '-')))));
}

export const renderPrDetail: DetailRenderer = async (root, data, projectKey, r, onBack, now = () => new Date()) => {
  injectStyles();
  const m = r.measures;
  const other = ['new_mutation_timed_out', 'new_mutation_memory_error', 'new_mutation_unknown'].map((k) => m[k]);
  const otherSum = other.every((v) => v === undefined) ? null : other.reduce<number>((a, v) => a + (v ?? 0), 0);
  const kpi = (n: string, v: string, l: string, cls = '') =>
    h('div', { class: 'md-kpi', 'data-tile': n }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'l' }, l));

  const panels: Record<string, HTMLElement> = {
    files: h('div', { 'data-panel': 'files' }, h('p', { class: 'md-muted' }, 'Loading files...')),
    survivors: h('div', { 'data-panel': 'survivors', hidden: 'hidden' }, h('p', { class: 'md-muted' }, 'Loading survivors...')),
    languages: h('div', { 'data-panel': 'languages', hidden: 'hidden' }),
    metrics: h('div', { 'data-panel': 'metrics', hidden: 'hidden' }),
  };
  const tabs: Record<string, HTMLButtonElement> = {};
  const loaded = new Set<string>();

  function select(name: string): void {
    for (const [k, b] of Object.entries(tabs)) b.className = `md-tab${k === name ? ' on' : ''}`;
    for (const [k, p] of Object.entries(panels)) { if (k === name) p.removeAttribute('hidden'); else p.setAttribute('hidden', 'hidden'); }
    if (name === 'languages' && !loaded.has(name)) { loaded.add(name); void loadLanguages(); }
    if (name === 'metrics' && !loaded.has(name)) { loaded.add(name); void loadMetrics(); }
  }
  const tab = (name: string, label: string) => {
    tabs[name] = h('button', { class: 'md-tab', 'data-tab': name, onclick: () => select(name) }, label);
    return tabs[name];
  };

  root.replaceChildren(h('div', { class: 'md' },
    h('button', { class: 'md-link', 'data-action': 'back', onclick: onBack }, 'All pull requests'),
    h('div', { class: 'md-head' },
      h('div', {}, h('div', { class: 't' }, `PR #${r.pr.key} - ${r.pr.title} `, statusPill(r)),
        h('div', { class: 'm' }, `${r.pr.branch} → ${r.pr.base} · analyzed ${fmtAge(r.pr.analysisDate, now())}`)),
      h('div', {}, h('div', { class: `md-big ${r.score !== null && r.score < r.threshold ? 'md-fail' : ''}`, 'data-part': 'score' }, fmtPct(r.score)),
        h('div', { class: 'm' }, `new-code score · threshold ${r.threshold}%${r.thresholdAssumed ? ' (assumed)' : ''}`)),
    ),
    h('div', { class: 'md-kpis' },
      kpi('total', fmtInt(m.new_mutation_total), 'mutants in changed lines'),
      kpi('killed', fmtInt(m.new_mutation_killed), 'killed by tests', 'md-pass'),
      kpi('survived', fmtInt(m.new_mutation_survived), 'survived', 'md-fail'),
      kpi('noCoverage', fmtInt(m.new_mutation_no_coverage), 'no coverage', 'md-fail'),
      kpi('other', fmtInt(otherSum), 'timeout / memory / unknown'),
      kpi('strength', fmtPct(m.new_mutation_test_strength), 'test strength')),
    h('div', { class: 'md-tabs' }, tab('files', 'Files'), tab('survivors', 'Survivors'), tab('languages', 'Languages'), tab('metrics', 'All metrics')),
    panels.files, panels.survivors, panels.languages, panels.metrics));
  select('files');

  async function loadFilesAndSurvivors(): Promise<void> {
    let files: FileRow[] = [];
    let survivors: SurvivorRow[] = [];
    let filesErr = '';
    let survErr = '';
    await Promise.all([
      data.loadFiles(projectKey, r.pr.key).then((x) => { files = sortFilesWeakestFirst(x); }, (e) => { filesErr = msg(e); }),
      data.loadSurvivors(projectKey, r.pr.key).then((x) => { survivors = x; }, (e) => { survErr = msg(e); }),
    ]);

    tabs.survivors.textContent = survErr ? 'Survivors' : `Survivors (${survivors.length})`;
    panels.survivors.replaceChildren(survErr ? h('p', { class: 'md-fail' }, `Could not load survivors: ${survErr}`)
      : survivors.length ? survivorTable(survivors, projectKey, r.pr.key, true) : h('p', { class: 'md-muted' }, 'No surviving mutants in the changed lines.'));

    if (filesErr) { panels.files.replaceChildren(h('p', { class: 'md-fail' }, `Could not load files: ${filesErr}`)); return; }
    if (files.length === 0) { panels.files.replaceChildren(h('p', { class: 'md-muted' }, 'No files with mutation data.')); return; }

    let selected = files[0].fileKey;
    const right = h('div', { style: 'max-width:340px' });
    const table = h('tbody', {});
    const paintRight = () => {
      const f = files.find((x) => x.fileKey === selected)!;
      right.replaceChildren(h('div', { class: 'md-lbl' }, `Survivors in ${f.path}`),
        survErr ? h('p', { class: 'md-fail' }, survErr) : survivorTable(survivors.filter((s) => s.fileKey === selected), projectKey, r.pr.key, false));
    };
    const paintRows = () => table.replaceChildren(...files.map((f) =>
      h('tr', { 'data-file': f.fileKey, class: f.fileKey === selected ? 'selected' : '', style: 'cursor:pointer', onclick: () => { selected = f.fileKey; paintRows(); paintRight(); } },
        h('td', {}, f.path), h('td', {}, f.language),
        h('td', { 'data-col': 'score', class: f.score !== null && f.score < r.threshold ? 'md-fail' : '' }, fmtPct(f.score)),
        h('td', {}, String(f.alive)), h('td', {}, fmtInt(f.changedLines)),
        h('td', { class: 'md-muted' }, fmtPct(f.wholeFileScore)))));
    paintRows();
    paintRight();
    panels.files.replaceChildren(h('div', { class: 'md-row' },
      h('div', {}, h('div', { class: 'md-lbl' }, 'Files - weakest first'),
        h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, ...['File', 'Lang', 'New-code score', 'Alive', 'Changed lines', 'Whole file'].map((t) => h('th', {}, t)))), table)),
      right));
  }

  async function loadLanguages(): Promise<void> {
    try {
      const keys = LANGUAGES.flatMap((l) => LANG_FIELDS.map((f) => `new_mutation_${l}_${f}`));
      const v = await data.loadAllMeasures(projectKey, r.pr.key, keys);
      const langs = LANGUAGES.filter((l) => v[`new_mutation_${l}_total`] !== undefined);
      panels.languages.replaceChildren(langs.length === 0 ? h('p', { class: 'md-muted' }, 'No per-language data.')
        : h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, ...['Language', 'Mutants', 'Killed', 'Survived', 'Score'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...langs.map((l) => h('tr', { 'data-lang': l }, h('td', {}, l), h('td', {}, fmtInt(v[`new_mutation_${l}_total`])),
            h('td', {}, fmtInt(v[`new_mutation_${l}_killed`])), h('td', {}, fmtInt(v[`new_mutation_${l}_survived`])),
            h('td', { 'data-col': 'score' }, fmtPct(v[`new_mutation_${l}_score`])))))));
    } catch (e) {
      panels.languages.replaceChildren(h('p', { class: 'md-fail' }, `Could not load languages: ${msg(e)}`));
    }
  }

  async function loadMetrics(): Promise<void> {
    try {
      const infos = await data.loadMetrics();
      const v = await data.loadAllMeasures(projectKey, r.pr.key, infos.map((i) => i.key));
      const have = infos.filter((i) => v[i.key] !== undefined).sort((a, b) => a.key.localeCompare(b.key));
      panels.metrics.replaceChildren(have.length === 0 ? h('p', { class: 'md-muted' }, 'No mutation measures for this pull request.')
        : h('table', { class: 'md-table' }, h('thead', {}, h('tr', {}, ...['Metric', 'Key', 'Value'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...have.map((i) => h('tr', { 'data-metric': i.key, title: i.description },
            h('td', {}, i.name), h('td', { class: 'md-muted' }, i.key), h('td', { 'data-col': 'value' }, String(v[i.key])))))));
    } catch (e) {
      panels.metrics.replaceChildren(h('p', { class: 'md-fail' }, `Could not load metrics: ${msg(e)}`));
    }
  }

  void loadFilesAndSurvivors();
};

export { scoreBar };
```

- [ ] **Step 4: Make it the default renderer**

In `frontend/src/ui/projectPage.ts` add `import { renderPrDetail } from './prDetail';` and change the signature default: `detail: DetailRenderer = renderPrDetail`. In `showDetail`, the `if (detail)` branch becomes the only branch:
```ts
  async function showDetail(pr: PrResult): Promise<void> {
    await detail(root, data, ctx.project, pr, () => void showList(), now);
  }
```
Remove the fallback "Pull request N" line and the post-hoc back-button insertion (the detail renderer owns its back button; the stubbed renderer in `projectPage.test.ts` supplies its own, as the test already does). Update the test `'pr context shows the detail ...'` to keep passing: its stub already renders a back button via `[data-action="back"]`? It does not: add the button to that stub exactly as the next test does, or assert only on `DETAIL` and the call args (remove the back-link assertion).

- [ ] **Step 5: Run, expect PASS**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p .`
Expected: all PASS, `tsc` clean. Circular import check: `prDetail.ts` imports the `DetailRenderer` type from `projectPage.ts` and `projectPage.ts` imports `renderPrDetail`; type-only import is erased, so there is no runtime cycle. If esbuild warns, move `DetailRenderer` to `types.ts` and import it from there in both files.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ui/prDetail.ts frontend/src/ui/projectPage.ts frontend/test/prDetail.test.ts frontend/test/projectPage.test.ts
git commit -m "feat(dashboard): PR detail with files, survivors, languages, all metrics"
```

---

### Task 9: Local dev harness and visual check against the mockups

**Files:**
- Create: `frontend/dev/index.html`, `frontend/dev/main.ts`

**Interfaces:**
- Consumes: all UI units and `test/fixtures.ts`.
- Produces: `npm run dev` builds `frontend/dev/dist/dev.js`; opening `frontend/dev/index.html` shows the overview and the project page (list and PR #14 detail) with the mockup data and no Sonar.

- [ ] **Step 1: Write the harness**

`frontend/dev/index.html`:
```html
<!doctype html>
<meta charset="utf-8">
<title>Mutation dashboard - dev harness</title>
<body style="margin:0;background:#f3f5f9">
  <h2 style="padding:8px 24px">Overview</h2><div id="overview"></div>
  <h2 style="padding:8px 24px">Project page (list)</h2><div id="project"></div>
  <h2 style="padding:8px 24px">Project page (PR #14 detail)</h2><div id="detail"></div>
  <script src="dist/dev.js"></script>
</body>
```

`frontend/dev/main.ts`:
```ts
import { renderOverview } from '../src/ui/overview';
import { renderProjectPage } from '../src/ui/projectPage';
import type { FileRow, SurvivorRow } from '../src/types';
import { FakeData, makePr, noData, project } from '../test/fixtures';

const f = (path: string, lang: string, score: number | null, alive: number, changed: number, whole: number | null): FileRow =>
  ({ fileKey: `qa:${path}`, path, language: lang, score, alive, changedLines: changed, wholeFileScore: whole });
const s = (path: string, line: number, status: 'SURVIVED' | 'NO_COVERAGE', operator: string): SurvivorRow =>
  ({ fileKey: `qa:${path}`, path, line, status, operator });

const pr14 = makePr('14', { score: 70.9, hours: 3, title: 'pricing rules refactor', measures: {
  new_mutation_score: 70.9, new_mutation_total: 127, new_mutation_killed: 90, new_mutation_survived: 19, new_mutation_no_coverage: 12,
  new_mutation_timed_out: 3, new_mutation_memory_error: 2, new_mutation_unknown: 1, new_mutation_test_strength: 82.6 } });

const data = new FakeData(
  [
    project('timeoff-webapp', [makePr('1', { score: 60, hours: 2 }), makePr('2', { score: 65, hours: 5 }), makePr('3', { score: 66, hours: 8 }), makePr('4', { score: 90, hours: 40 }), makePr('5', { score: 88, hours: 70 }), noData('6', 90)]),
    project('scheduler-api', [makePr('7', { score: 76, hours: 26 }), makePr('8', { score: 70, hours: 30 }), makePr('9', { score: 95, hours: 90 })]),
    project('qa-rm-testing-gates', [pr14, makePr('13', { score: 84, hours: 30, title: 'date helpers' }), makePr('12', { score: 91.2, hours: 50, title: 'validator edge cases' }), makePr('11', { score: 80, hours: 96, title: 'parser cleanup' }), makePr('10', { score: 82.6, hours: 216, title: 'Stryker gate' })]),
    project('policy-engine', [makePr('20', { score: 91, hours: 5 }), makePr('21', { score: 85, hours: 50 })]),
    project('billing-ui', [noData('30'), noData('31')]),
  ],
  { 'qa-rm-testing-gates#14': [f('src/utils/dates.ts', 'ts', 46.2, 14, 36, 46.2), f('src/services/pricing.ts', 'ts', 64.1, 10, 46, 64.6), f('tools/report_builder.py', 'py', 69.2, 4, 19, 68.2), f('src/main/java/com/nice/Policy.java', 'java', 80, 2, 25, 82.5), f('src/validators.ts', 'ts', 88.2, 2, 22, 88.2)] },
  { 'qa-rm-testing-gates#14': [s('src/utils/dates.ts', 7, 'SURVIVED', 'EqualityOperator'), s('src/utils/dates.ts', 12, 'NO_COVERAGE', 'BlockStatement'), s('src/utils/dates.ts', 19, 'SURVIVED', 'ConditionalExpression'), s('src/services/pricing.ts', 8, 'SURVIVED', 'ArithmeticOperator')] },
  [{ key: 'mutation_score', name: 'Mutation: Score', description: '', type: 'PERCENT' }, { key: 'new_mutation_score', name: 'Mutation: Score', description: '', type: 'PERCENT' }],
  { mutation_score: 76, new_mutation_score: 70.9, new_mutation_typescript_total: 90, new_mutation_typescript_killed: 62, new_mutation_typescript_survived: 18, new_mutation_typescript_score: 68.9, new_mutation_python_total: 19, new_mutation_python_killed: 14, new_mutation_python_survived: 4, new_mutation_python_score: 73.7, new_mutation_java_total: 18, new_mutation_java_killed: 14, new_mutation_java_survived: 2, new_mutation_java_score: 77.8 },
);

const now = () => new Date();
// The fixtures use a fixed clock in tests; here, shift dates relative to the real now.
for (const p of data.projects) for (const r of p.prs) r.pr.analysisDate = new Date(Date.now() - (Date.parse('2026-10-05T12:00:00Z') - Date.parse(r.pr.analysisDate))).toISOString();

renderOverview(document.getElementById('overview')!, data, now);
void renderProjectPage(document.getElementById('project')!, data, { kind: 'project', project: 'qa-rm-testing-gates' }, now);
void renderProjectPage(document.getElementById('detail')!, data, { kind: 'pr', project: 'qa-rm-testing-gates', pr: '14' }, now);
```

- [ ] **Step 2: Build and open it**

Run: `cd frontend && npm run dev && open dev/index.html`
Expected: the three sections render. If the build fails on types, fix before continuing.

- [ ] **Step 3: Compare with the approved mockups in a real browser**

Use the Playwright MCP tools: navigate to `file://<repo>/frontend/dev/index.html`, take a full-page screenshot, and compare with the saved mockups (`.superpowers/brainstorm/*/content/presentation-dashboard.html`). Check, being strict about pixels: tile alignment and equal widths, header text and alignment, sorted-column arrow, pill colors, bar and threshold tick position, tab order, file table column order and the survivors panel to its right, no overlapping or clipped text, dashes instead of zeros. Fix every visible difference in `styles.ts` or the UI file and re-screenshot until it matches. Record the final screenshot at `docs/screenshots/dashboard-dev-harness.png`.

- [ ] **Step 4: Commit**

```bash
git add frontend/dev/index.html frontend/dev/main.ts frontend/src docs/screenshots
git commit -m "feat(dashboard): dev harness with mockup data, visual fixes"
```

---

### Task 10: Real Sonar: local check, then sonartest with mock PRs

**Files:**
- Create: `scripts/upload-mock-prs.sh`

**Interfaces:**
- Consumes: the built jar; a Sonar token in `SONAR_TOKEN` (provided by the owner at execution time; never written to a file or committed); the scratch project in `$CLAUDE_JOB_DIR/tmp/qa` or a fresh clone of `Guy-nice/QA-RM_Testing_Gates` with the mock sources and report (see the earlier mock generator).
- Produces: PR analyses `101..105` on the sonartest project `qa-rm-testing-gates` (a mix of passing and failing), and the verified pages.

- [ ] **Step 1: Write the uploader script**

`scripts/upload-mock-prs.sh`:
```bash
#!/usr/bin/env bash
# Upload several mock pull request analyses to a Sonar project, each with its own mutation report.
# Usage: SONAR_TOKEN=... scripts/upload-mock-prs.sh <project-dir> <host-url> <project-key>
# The project dir must hold sources and a sonar-project.properties; this script only varies the report and the PR key.
set -euo pipefail
dir=$1; host=$2; key=$3
: "${SONAR_TOKEN:?export SONAR_TOKEN first (never commit it)}"
report="$dir/.sonar/mutation-report.json"
base_report=$(mktemp); cp "$report" "$base_report"
trap 'cp "$base_report" "$report"; rm -f "$base_report"' EXIT

# pr-key branch killed-fraction
for spec in "101 feature/pricing-fix 0.70" "102 feature/date-helpers 0.88" "103 feature/validators 0.92" "104 feature/parser-cleanup 0.79" "105 feature/gate-config 0.83"; do
  read -r pr branch frac <<<"$spec"
  python3 - "$base_report" "$report" "$frac" "$pr" <<'PY'
import json, sys
src, dst, frac, pr = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
r = json.load(open(src))
n = r["summary"]["new"]
total = n["total"]
killed = round(total * frac)
n["killed"] = killed
rest = total - killed
n["survived"] = round(rest * 0.6); n["noCoverage"] = rest - n["survived"]
n["timedOut"] = n["memoryError"] = n["unknown"] = 0
r["run"]["runId"] = f"mock-pr-{pr}"
json.dump(r, open(dst, "w"), indent=2)
PY
  (cd "$dir" && sonar-scanner -Dsonar.host.url="$host" -Dsonar.projectKey="$key" \
     -Dsonar.pullrequest.key="$pr" -Dsonar.pullrequest.branch="$branch" -Dsonar.pullrequest.base=main >/dev/null)
  echo "uploaded PR $pr ($branch) killed fraction $frac"
done
```
Note: the per-file `new` counts in the base report are not rescaled, so the per-file and survivor panels stay constant across the mock PRs; only the project-level new-code score varies. That is enough to test the list, filters, pass/fail and the overview.

- [ ] **Step 2: Local server check (pages with the real API)**

Rebuild and install the jar on the local Sonar as in Task 2 Step 5. Log in, open `http://localhost:9000/extension/mutationreport/overview` and `http://localhost:9000/project/extension/mutationreport/project?id=agent-e2e`. The local server has no pull request analysis, so expect: the overview lists projects with "no mutation data" and the project page shows the pull-request error or empty message. Confirm there are no JavaScript errors in the browser console (Playwright `browser_console_messages`) and that the error text is readable, not a blank page.

- [ ] **Step 3: Install on sonartest (needs the Sonar admin)**

Ask the owner to have the admin install the new jar on sonartest (remove the old mutation-report jar, copy `target/sonar-mutation-report-plugin-<version>.jar`, restart). Do not continue until `GET /api/plugins/installed` lists the new version.

- [ ] **Step 4: Upload the mock PRs**

Ask the owner to `export SONAR_TOKEN=...` in their shell (never paste it into the chat). Then:
```bash
bash scripts/upload-mock-prs.sh "$CLAUDE_JOB_DIR/tmp/qa" https://sonartest.nice.com qa-rm-testing-gates
```
Expected: five "uploaded PR ..." lines. Verify through the API that PR 101..105 each have `new_mutation_score` and that 101 and 104 are below 80 and the others at or above it.

- [ ] **Step 5: Verify the real pages in a browser**

Open `https://sonartest.nice.com/extension/mutationreport/overview` (the owner logs in; Playwright MCP can reuse that session or the owner screenshots). Check against the Review Focus list and the spec: overview tiles and sorting, project row for `qa-rm-testing-gates`, project page PR list with 5 rows and correct pass/fail, filters, PR detail (files weakest first, survivor links open Sonar's code view on the right line), the languages and all-metrics tabs. Record results and screenshots in `docs/screenshots/`.

**Things to settle here and write down in the plan's status note:**
(a) the real `branchLike` shape for a PR and for `main` (the `parseContext` guess); (b) whether `mutation_threshold` and the `new_*` measures come back for a PR analysis (if the threshold is missing everywhere, the "assumed" flag shows and the fallback of 80 applies); (c) the real `project_pull_requests/list` fields (is there anything that says open or merged? if so, replace `isOpen`); (d) that the code-view link format opens the correct file and line. Fix `context.ts`, `api.ts` or `format.ts` for each mismatch, with a test that pins the real shape.

- [ ] **Step 6: Performance check**

Time the overview with the browser's network panel on sonartest (at least 5 projects). Extrapolate: calls scale as roughly projects x (1 + PRs). If the measured load for the real number of projects is above 5 seconds, report it with the numbers instead of claiming the target is met.

- [ ] **Step 7: Commit**

```bash
git add scripts/upload-mock-prs.sh docs/screenshots frontend/src frontend/test
git commit -m "test(dashboard): mock PR uploader, fixes from real Sonar verification"
```

---

### Task 11: Docs, version, release notes

**Files:**
- Modify: `pom.xml` (version), `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: version `0.3.0`, README section "Dashboard".

- [ ] **Step 1: Bump the version and rebuild clean**

Set `<version>0.3.0</version>` in `pom.xml`, then:
```bash
mvn -q clean package 2>&1 | tail -10
ls -l target/sonar-mutation-report-plugin-0.3.0.jar && unzip -l target/sonar-mutation-report-plugin-0.3.0.jar | grep -E "static/(overview|project)\.js"
shasum -a 256 target/sonar-mutation-report-plugin-0.3.0.jar
```
Expected: BUILD SUCCESS, both bundles listed, a SHA-256.

- [ ] **Step 2: Add the README section**

Add a section `## Dashboard (v0.3.0)` after "What it publishes": the two pages and where to find them (top menu "More > Mutation overview", project menu "More > Mutation"), the definitions (failing, pass rate, adoption, median, 30 days, open = analyzed in the last 7 days unless Task 10 found a better signal), the build requirement (Node 20 or newer and npm for `mvn package`; `-Dfrontend.skip=true` to skip the frontend when only Java changed), the deviations (no round column, no author filter), the scale note (about 30 projects and a few hundred PRs a month), the housekeeping note (Sonar deletes inactive PRs after about 30 days), and that the pages appear in every project's menu with "no data" for projects not using mutation. Update the "Verification" section with the sonartest results from Task 10. No em dashes.

- [ ] **Step 3: Full verification before claiming done**

Run: `mvn -q clean package 2>&1 | tail -5` and `cd frontend && npx vitest run && npx tsc --noEmit -p .`
Expected: all green. Report the exact counts of Java and frontend tests.

- [ ] **Step 4: Commit and report**

```bash
git add pom.xml README.md
git commit -m "docs+release: dashboard README, version 0.3.0"
```
Do not push, tag or publish. Report to the owner: branch, commit, jar path and SHA-256, test counts, Task 10 findings (what the real PR API returned, the performance numbers), the deviations, and the next commands (push, PR to `feat/plugin-v2` or `main`, release `v0.3.0`).

---

## Self-review (done by the plan author)

- **Spec coverage:** overview tiles, filters, table and sort (Task 6); project PR list with tiles, filters, bars (Task 7); PR detail header, tiles, four tabs, survivor links (Task 8); `main` hidden and branch note (Task 7); definitions (Task 3); window, concurrency, cache, refresh (Tasks 3, 5, 6); permissions via the viewer's session (Task 5); errors and edge cases (Tasks 5 to 8 tests); testing local plus sonartest plus performance (Tasks 9, 10); risks (Task 10 Step 5 list); out of scope respected. Spec items the data cannot support are listed under "Deviations".
- **Placeholders:** none; every code step contains the code. The only open items are discoveries inside Task 10 Step 5, each with an action.
- **Type consistency:** `DataSource` method names, `PrResult`, `ProjectResult`, `FileRow`, `SurvivorRow`, `DetailRenderer`, `PageContext`, markup `data-*` contracts and the fixtures (`makePr`, `noData`, `project`, `FakeData`, `NOW`) are used with the same names and signatures in every task.
- **Known soft spot:** `DetailRenderer` is defined in `projectPage.ts` and imported as a type by `prDetail.ts`; Task 8 Step 5 gives the fix if the bundler objects.
