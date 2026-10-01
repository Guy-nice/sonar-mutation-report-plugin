# sonar-mutation-report-plugin

A language-agnostic SonarQube plugin that publishes **mutation testing results** as Sonar measures, so a
quality gate can block a pull request when the mutation score is below a threshold.

The plugin **runs no mutation testing** and knows nothing about languages. An external agent runs the
mutation tools (Stryker, PIT, mutmut, ...), improves the tests, and writes one JSON report. During the
normal Sonar scan the plugin reads that file and publishes its numbers.

> **Status: v0.2.0 (full metric set).** Per-file measures with folder/project aggregation, new-code
> variants, per-language measures, external issues for survivors. Verified on a local SonarQube 26.1
> (see "Verification"). Not yet verified on sonartest or in production.

## Why a plugin

SARIF import can only create issues, so it cannot populate Overall Code or New Code with a score. The
Sonar web API cannot create custom metrics on 2026.1, and the existing DevCon5 mutation plugin only
works for Java and Kotlin. A small plugin that registers its own metrics is the supported way to get a
real, gateable measure for any language.

## What it publishes

All keys use the domain **Mutation Analysis**. Every metric below also exists as `new_mutation_<name>`
(New Code), except where noted. File-level values are saved per file and aggregated to folders and the
project, so the Measures page has a file tree, drill-down and treemap.

| Metric key (`mutation_<name>`) | Meaning | Aggregation |
|---|---|---|
| `total` | mutants generated | sum |
| `killed` | killed by tests (**the score numerator**) | sum |
| `timed_out`, `memory_error` | detected by timeout / memory error | sum |
| `killed_total` | killed + timed out + memory error (DevCon5's "Killed: Total") | sum |
| `survived`, `no_coverage` | alive: tests run the line but miss / no test reaches it | sum |
| `alive` | survived + no coverage | sum |
| `unknown`, `suppressed` | unknown status / excluded as equivalent | sum |
| `tests_executed`, `test_kills` | per-test data, only when the engine supplies it (absent otherwise) | sum |
| `score` | killed / total (**the gate metric**) | recomputed from counts |
| `test_strength` | killed / (killed + survived) | recomputed |
| `density` | mutants per analyzable line, in percent | recomputed |
| `alive_percent`, `total_percent` | component's share of project survivors / mutants (hotspots) | recomputed |
| `test_kill_ratio` | test kills per test execution | recomputed |
| `lines`, `global_total`, `global_alive` | hidden helpers | sum / project-wide constant |

Also published: `mutation_threshold` (project), and per language `mutation_<lang>_{total,killed,survived,score}`
and the `new_` variants, for `typescript`, `javascript`, `csharp`, `java`, `python`, `go` and `other`.

Survivors and no-coverage mutants become **external issues** (rules `external_mutation-report:survived`
and `external_mutation-report:no-coverage`) on the file and line. No language or quality profile is
needed. Mutants in files Sonar did not analyze are skipped.

### Mapping from the DevCon5 plugin (`dc5_*`)

Keys are intentionally not compatible with DevCon5. Equivalents:

| DevCon5 | This plugin |
|---|---|
| Mutation Coverage | `mutation_score` (killed by tests only; DevCon5 also counts timeouts/memory errors as killed, see `mutation_killed_total`) |
| Killed by Tests / Timeout / Memory Error / Killed Total | `killed` / `timed_out` / `memory_error` / `killed_total` |
| Alive Survivors / Not Covered / Total | `survived` / `no_coverage` / `alive` |
| Test Strength | `test_strength` |
| Density (per statement) | `density` (per **analyzable line**, not statement) |
| Alive Total % / Total % | `alive_percent` / `total_percent` |
| Test Kills / Executions / Kill Ratio | `test_kills` / `tests_executed` / `test_kill_ratio` |

## Compatibility

- Built against Sonar plugin API **10.11.0.2468**, Java 17 bytecode. Target server: self-hosted SonarQube
  Server **2026.1.x and later**.
- Tested: local SonarQube **26.1.0.118079** (unit tests plus a real scan, see "Verification"). Not yet
  tested on sonartest.
- Scanner side: any scanner that loads server plugins (SonarScanner CLI, Maven, Gradle, Jenkins).

## For the Sonar admin: install on sonartest

1. Download `sonar-mutation-report-plugin-<version>.jar` from the project's GitHub releases.
2. Verify the checksum:

       shasum -a 256 sonar-mutation-report-plugin-<version>.jar   # compare with the published .sha256

3. Copy the jar into `<SONARQUBE_HOME>/extensions/plugins/` on the server (all nodes, if clustered).
4. Restart SonarQube (remove any older mutation-report jar first).
5. Confirm it loaded: Administration > Marketplace > Installed should list **Mutation Report**,
   or `GET /api/plugins/installed` should contain key `mutationreport`.
   If it is missing, check `<SONARQUBE_HOME>/logs/web.log` for lines mentioning `mutationreport`
   (the most likely failure is an incompatible plugin API version).

This is a **test server only** step. Do not install on sonar.nice.com until the checks below pass.

To remove it: delete the jar from `extensions/plugins/` and restart.

## How a project uses it

Add one property to `sonar-project.properties` (or pass `-Dsonar.mutation.reportPath=...`):

    sonar.mutation.reportPath=.sonar/mutation-report.json

The path is relative to the project base directory. If the property is absent the sensor is skipped. If
the file is missing the scan logs a warning and continues. A malformed file fails the scan with a clear
error.

### Report format (schemaVersion 1)

Unknown fields are ignored. Unknown major versions are rejected with a clear error.

```json
{
  "schemaVersion": 1,
  "run": { "runId": "r1", "threshold": 80 },
  "summary": {
    "overall": { "total": 30, "killed": 22, "timedOut": 1, "memoryError": 1, "survived": 5,
                 "noCoverage": 1, "suppressed": 2, "testsExecuted": 90, "testKills": 24 },
    "new":     { "total": 11, "killed": 9, "survived": 2 }
  },
  "languages": { "TypeScript": { "overall": { "total": 20, "killed": 15, "survived": 5 },
                                 "new": { "total": 11, "killed": 9, "survived": 2 } } },
  "files": { "src/a.ts": { "language": "typescript", "lines": 40, "changedLines": 8,
                           "overall": { "total": 20, "killed": 15, "survived": 5 },
                           "new": { "total": 11, "killed": 9, "survived": 2 } } },
  "mutants": [ { "file": "src/a.ts", "line": 10, "operator": "EqualityOperator", "status": "SURVIVED" } ]
}
```

Only `schemaVersion` and `summary.overall` are required. A count group whose `total` is smaller than the
sum of its parts is rejected. `mutants[]` lists only SURVIVED and NO_COVERAGE mutants. Scores and
percentages are computed by the plugin from the counts; they are not sent.

## Connection to the mutation agent

The data comes from the **unified-mutation-testing** agent (`agentic-platform`, plugin
`plugin/unified-mutation-testing`). The agent does all the work; this plugin only reads the result.

### End-to-end flow

```
developer runs the agent (own Sonar token in SONAR_TOKEN, asked for if missing)
  1. agent finds the files changed vs --base and the exact changed lines (git diff)
  2. runs each language's engine: Stryker (TS/JS), Stryker.NET (C#), PIT (Java), mutmut (Python),
     gremlins (Go)
  3. merges all engines into ONE score and checks it against the threshold (default 80)
        pass   -> report is final (round 1 is the final state)
        fail   -> with --remediate: agent writes tests to kill survivors, re-runs once ("round 2",
                  --verify); without it the run reports and stops (exit 2)
  4. final state is exported to .sonar/mutation-report.json (committed to the PR)
the normal CI scan runs sonar-scanner -> this plugin reads the file -> measures appear
the Sonar quality gate compares mutation_score with the threshold -> PR passes or is blocked
```

The plugin never talks to the agent and never runs a tool. The report file is the whole contract.

### How the score is defined (agent side, authoritative)

| Number | Formula | Used for |
|---|---|---|
| `mutation_score` | killed / total x 100 | **The gate.** A mutant no test reaches (NO_COVERAGE) counts as a failure. |
| `test_strength` | killed / (killed + survived) x 100 | Information only. Ignores unreachable mutants. |

- The agent today computes **only a diff-scoped score**: mutants outside the PR's changed lines are
  dropped from numerator and denominator. There is no whole-file or repo-wide score yet. The target
  (agent step C) is `new_mutation_score` = diff score and `mutation_score` = whole-file score of the
  **changed files only**, never repo-wide.
- Mutants on lines the agent classifies as equivalent or "arid" are suppressed: excluded from the
  score and counted separately.
- Threshold: the agent's `--threshold` (default 80). In Sonar the gate threshold is set in the quality
  gate, and should match.

### Rounds

| Round | What happens | Outcome |
|---|---|---|
| 1 | Mutate the changed code, score it. | Score at or above threshold: **done, round 1 is final.** |
| 2 | Only with `--remediate`: agent adds tests for surviving mutants, re-runs only the mutation step (`--verify`). | Score now passes: done. Still below: **manual review required**, agent stops. |

Only the **final state** is uploaded (round 1 if it passed, otherwise round 2). Round history is not
sent to Sonar in v1; it stays in the agent's own `gate.json` and report.

### What the agent has, and where it goes

| Agent data | Report field (planned) | Sonar |
|---|---|---|
| overall summary: total, killed, survived, no-coverage, errors, suppressed | `summary.*` | measures (`mutation_total`, `mutation_killed`, ...) |
| `mutation_score` | `summary.overall` counts | measure `mutation_score` (**gate**), computed by the plugin |
| diff-scoped score | `summary.new` counts | measure `new_mutation_score`, computed by the plugin |
| `test_strength` | `summary.test_strength` | measure `mutation_test_strength` |
| per-language summaries (TypeScript, Python, Java, ...) | `languages.<name>.*` | per-language measures (fixed list + "other") |
| survivors and no-coverage mutants: file, line, operator, status | `mutants[]` | external issues, final survivors only |
| threshold, round, run ID, commit SHA, agent version | `run.*` | informational measures / checks |
| lines of test code the agent added | `run.test_lines_added` | measure `mutation_test_lines_added` |
| signature, runner ID | `run.signature` (phase 2) | `mutation_verified` (phase 2) |

Not sent in v1: the HTML report, killing-test names, mutant descriptions, round-1 history.

### Today vs target

- **Today** the agent's Step 7 (`sonar_export.py`) writes a **SARIF** file (issues only). The plugin now
  raises the same survivor issues itself, so SARIF is removed from the agent (decision: no SARIF at all).
- **Target** the agent writes `.sonar/mutation-report.json`, wires `sonar.mutation.reportPath` and runs the
  Sonar scan itself (runner's token from `SONAR_TOKEN`, upload failure exits 4). The report must be
  committed to the PR, because CI's scan reads it from the checkout (do not gitignore `.sonar/`).
- Exit codes of the agent (for CI or scripts): 0 gate passed, 1 error, 2 gate failed (below threshold,
  more work possible), 3 manual review required (still below threshold after round 2).

### Identity and trust

- **Phase 1:** whoever runs the agent supplies their own Sonar user token (the agent asks for it if it
  is missing, reads it from `SONAR_TOKEN`, and never writes it to a file, log or commit). Sonar records
  who submitted the analysis. This proves who uploaded, **not** that the numbers are authentic.
- **Phase 2:** a signing service attests that the agent produced the report; the plugin verifies the
  signature with a public key from a Sonar global setting and publishes `mutation_verified`. A gate
  condition on it makes an unsigned or edited report fail the gate.

## Verification

Done locally on SonarQube 26.1.0.118079 (zip distribution, plugin jar in `extensions/plugins/`), scanning
a synthetic project with the sample report from `TestReports`:

- Plugin loads, analysis succeeds, all metrics are registered and populated (36 on a file).
- File, folder and project values aggregate correctly, including `new_` values per file.
- Quality gate conditions on `mutation_score` and `new_mutation_score` are evaluated (a 73.3 score failed
  a "less than 80" condition, a 81.8 new-code score failed "less than 90").
- External issues land on the right file and line.

Still open: a pull request analysis (needs a branch-enabled edition or a PR-capable setup), a second Sonar
version, and a run on sonartest.

To repeat on any server: scan a project that sets `sonar.mutation.reportPath`, then check
`GET /api/measures/component?component=<key>&metricKeys=mutation_score,new_mutation_score` and
`GET /api/issues/search?componentKeys=<key>`.

## Build

Requires JDK 17+ and Maven 3.9+.

    mvn package        # jar in target/

If Maven fails with a PKIX / certificate error behind a corporate proxy, let Java use the macOS
keychain:

    export MAVEN_OPTS="-Djavax.net.ssl.trustStoreType=KeychainStore -Djavax.net.ssl.trustStore=NONE"

## Roadmap

- Phase 2: report signing by an agent-attestation service, a `mutation_verified` measure, and Ed25519
  public keys held in a Sonar global setting. Phase 1 identity is the Sonar user token of whoever runs
  the scan, which proves who uploaded, not that the numbers are authentic.
- Pull request changed-line filter for issues.
- Automated integration tests on 2026.1.x and the next Sonar version.

## License

TBD.
