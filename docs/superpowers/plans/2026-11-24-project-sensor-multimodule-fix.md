# Project Sensor Multi-Module Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the mutation report once per analysis, so multi-module Maven/Gradle builds no longer fail with "Can not add the same measure twice".

**Architecture:** `MutationReportSensor` switches from `org.sonar.api.batch.sensor.Sensor` (runs per module) to `org.sonar.api.scanner.sensor.ProjectSensor` (runs once per analysis, on the project filesystem). The sensor reads one repo-wide report and finds files by root-relative path, so this matches its design. No report schema or metric change.

**Tech Stack:** Java 17, Sonar plugin API 10.11.0.2468, JUnit 5 + AssertJ, local SonarQube 26.1.0.118079 (`~/.sonarlocal`), Maven + sonar-maven-plugin, sonar-scanner CLI.

**Spec:** Bug report from the `ms-ah-corpus-manager` PR #355 (AN-217180): analysis aborts with `Can not add the same measure twice on [key=...] ... metric=mutation_total`. Original design: `docs/specs/2026-10-05-mutation-dashboard-design.md`.

## Global Constraints

- Plugin API compile target stays `10.11.0.2468`, Java 17 bytecode, one jar.
- No change to metrics, computers, report schema, dashboard pages.
- Property names unchanged: `sonar.mutation.reportPath`, `sonar.mutation.portfolio`.
- Sensor stays inactive when `sonar.mutation.reportPath` is not set (`onlyWhenConfiguration`).
- Report paths stay relative to the project root (`baseDir`), as the `mutation/scan` action writes them.
- Version bump to `1.0.1` (patch). Never edit CHANGELOG.md by hand.

## Review Focus

- Multi-module Maven, report with files in BOTH modules: files in each module get measures and issues (not "0 files").
- Same report path in every module (inherited property): sensor runs once, no duplicate-measure error.
- Single-module project (CLI scanner, no `sonar.modules`): output identical to 1.0.0.
- Relative `reportPath` in a multi-module build: resolved against the root dir, not a module dir.
- Report with 0 mutants (the failing case in the PR): publishes `n/a`, no exception, gate evaluated.

---

### Task 1: Reproduce the bug end to end (no code change)

**Files:**
- Create (outside repo): `/tmp/smrp/e2e/multimodule/` - 2-module Maven project (`impl`, `integration-tests`), Java sources in `impl`, test in `impl`, `.sonar/mutation-report.json` at root listing `impl/src/main/java/...` files.
- Create (outside repo): `/tmp/smrp/e2e/zero-mutants.json` - valid report, `total: 0`.

**Interfaces:**
- Produces: fixture projects reused by Tasks 3 and 4; a recorded failing log (`/tmp/smrp/e2e/repro-before.log`).

- [ ] **Step 1: Build the current plugin jar:** `mvn -q -DskipTests package` in repo root. Copy `target/sonar-mutation-report-plugin-1.0.0.jar` to `~/.sonarlocal/sonarqube-26.1.0.118079/extensions/plugins/` (remove older mutation-report jar first).
- [ ] **Step 2: Start local SonarQube:** `~/.sonarlocal/sonarqube-26.1.0.118079/bin/macosx-universal-64/sonar.sh start`; wait for `http://localhost:9000/api/system/status` = `UP`. Create a token.
- [ ] **Step 3: Create the fixture** using the zero-mutant report (PR case) and a second report with real mutants in files of both modules.
- [ ] **Step 4: Run** `mvn sonar:sonar -Dsonar.host.url=http://localhost:9000 -Dsonar.token=$T -Dsonar.mutation.reportPath=.sonar/mutation-report.json` in the fixture.
- [ ] **Step 5: Verify the bug:** build fails with `Can not add the same measure twice ... metric=mutation_total`. Save log. If it does not fail, STOP and re-analyze (the reporter's root cause is then wrong).
- [ ] **Step 6: Record the second symptom:** in the log note the `Mutation Report:` lines per module and whether the module run found the report file and files (reporter log said "0 files, 0 issues").

### Task 2: Switch to ProjectSensor (TDD)

**Files:**
- Modify: `src/main/java/com/nice/sonar/mutation/MutationReportSensor.java:14,33` (imports, class declaration)
- Test: `src/test/java/com/nice/sonar/mutation/MutationReportSensorTest.java`

**Interfaces:**
- Consumes: none from Task 1.
- Produces: `public class MutationReportSensor implements ProjectSensor` with unchanged `describe(SensorDescriptor)` and `execute(SensorContext)`.

- [ ] **Step 1: Write failing test** `runsOncePerAnalysisAsProjectSensor`: `assertThat(ProjectSensor.class.isAssignableFrom(MutationReportSensor.class)).isTrue()`. Add comment: module-level `Sensor` runs per module and double-saves project measures.
- [ ] **Step 2: Write failing test** `publishesFilesFromAnyModuleByRootRelativePath`: context with two `TestInputFileBuilder` files under different module sub-dirs (`impl/src/A.java`, `it/src/B.java`), report listing both root-relative paths, assert file measures exist on both and `files == 2` in published counts.
- [ ] **Step 3: Run** `mvn -q test -Dtest=MutationReportSensorTest` - Expected: first test FAILS.
- [ ] **Step 4: Implement:** replace `implements Sensor` with `implements ProjectSensor`, replace `import org.sonar.api.batch.sensor.Sensor` with `import org.sonar.api.scanner.sensor.ProjectSensor`. Keep `@Override` on both methods. Update class Javadoc: "Runs once per analysis (project sensor), not per module."
- [ ] **Step 5: Run** `mvn -q test` - Expected: all PASS.
- [ ] **Step 6: Commit:** `git add -A && git commit -m "fix(sensor): run once per analysis as ProjectSensor"` (no co-author line).

### Task 3: E2E verification of the fix

**Files:**
- Uses fixtures from Task 1.

**Interfaces:**
- Consumes: fixtures, token, running SonarQube from Task 1.
- Produces: logs `/tmp/smrp/e2e/after-*.log`, API read-backs.

- [ ] **Step 1: Build** the fixed jar, replace the jar in `extensions/plugins/`, restart SonarQube, wait for `UP`.
- [ ] **Step 2: Multi-module, zero-mutant report:** `mvn sonar:sonar ...` - Expected: `BUILD SUCCESS`; log has ONE `Mutation Report: published mutation_score=n/a (0 files, 0 issues)` line; Quality Gate evaluated.
- [ ] **Step 3: Multi-module, real report:** Expected: ONE `Mutation Report:` line, files > 0 for files in both modules; `api/measures/component_tree` shows `mutation_total` on files of both modules; `api/issues/search?...externalRuleEngine=mutation-report` shows issues on correct files and lines.
- [ ] **Step 4: Relative path check:** run Maven from the root with a relative `reportPath`; no "report not found" warning.
- [ ] **Step 5: Gate check:** gate condition on `mutation_score` with the real report evaluates (pass and fail case).
- [ ] **Step 6: UI check (pixel picky):** open project Measures page in browser (Playwright), confirm Mutation Analysis domain, file tree, drill-down, no blank values, no console errors.

### Task 4: Full regression

**Files:**
- Use: all existing tests and prior verification procedure from README "Verification".

- [ ] **Step 1: Java:** `mvn clean verify` - Expected: BUILD SUCCESS, 0 failures, 0 skipped unexpectedly. Run it twice to detect flaky tests. Fix any lint/test failure found, even unrelated.
- [ ] **Step 2: Frontend:** `cd frontend && npm ci && npm test && npm run build` - Expected: all vitest PASS, `tsc --noEmit` clean.
- [ ] **Step 3: Jar contents:** `unzip -l target/*.jar` has `static/overview.js` and `static/project.js`; plugin manifest `Plugin-Class` unchanged; plugin loads (log `mutationreport` in `web.log`, `api/plugins/installed` lists it).
- [ ] **Step 4: Single-module regression (CLI scanner):** scan the synthetic project with `TestReports.VALID` via `sonar-scanner`. Compare against README numbers: 36 metrics on a file, file/folder/project aggregation, `new_` values, gate fail at 73.3 vs 80 and 81.8 vs 90, issues on right line, file `not/analyzed.ts` skipped.
- [ ] **Step 5: Negative paths (E2E):** (a) no `reportPath` -> sensor not run, scan OK; (b) missing report file -> warning, scan OK; (c) invalid JSON -> clear `Invalid mutation report` failure; (d) `sonar.mutation.portfolio` set and blank.
- [ ] **Step 6: Multi-module regression:** Task 3 scenarios repeated once more after Step 1-5 with the final jar.
- [ ] **Step 7: Dashboard:** open Mutation overview and project pages in browser against local server; no console errors, same render as before (screenshot compare with `docs/screenshots`).
- [ ] **Step 8: Version coverage note:** record that Gradle multi-module is covered by the same scanner path; test with Gradle only if Gradle is available. Server 2026.1.2 (sonartest) is not testable locally - flag as open item.

### Task 5: Release prep

**Files:**
- Modify: `pom.xml:7` (`1.0.0` -> `1.0.1`)
- Modify: `README.md` (Verification section: multi-module result; "How a project uses it": note multi-module support, report path is root-relative)

- [ ] **Step 1: Bump version, update README** with the verification facts from Task 3 and 4 only (real numbers).
- [ ] **Step 2: Run** `mvn clean verify` again - Expected: PASS.
- [ ] **Step 3: Commit, push branch, open PR** (body via the `pr` skill; no auto co-author in commit). Tag/release only after the user approves.
- [ ] **Step 4: Draft reply** to the reporter: cause confirmed, fix version, how to roll out (replace jar, restart Sonar), note that the 2nd symptom (file paths) was also fixed if Task 1 Step 6 confirmed it.
