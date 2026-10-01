# sonar-mutation-report-plugin

A language-agnostic SonarQube plugin that publishes **mutation testing results** as Sonar measures, so a
quality gate can block a pull request when the mutation score is below a threshold.

The plugin **runs no mutation testing** and knows nothing about languages. An external agent runs the
mutation tools (Stryker, PIT, mutmut, ...), improves the tests, and writes one JSON report. During the
normal Sonar scan the plugin reads that file and publishes its numbers.

> **Status: spike (v0.1.0).** Proves that a plugin can publish a gateable mutation score. The report
> schema and measure list are intentionally minimal and will change. Not for production.

## Why a plugin

SARIF import can only create issues, so it cannot populate Overall Code or New Code with a score. The
Sonar web API cannot create custom metrics on 2026.1, and the existing DevCon5 mutation plugin only
works for Java and Kotlin. A small plugin that registers its own metrics is the supported way to get a
real, gateable measure for any language.

## What the spike publishes

| Metric key | Name | Type | Source field in report |
|---|---|---|---|
| `mutation_score` | Mutation Score | percent (higher is better) | `summary.mutation_score` |
| `new_mutation_score` | Mutation Score on New Code | percent (higher is better) | `summary.new_mutation_score` (optional) |

Both are project-level measures in the "Mutation" domain. The point of the spike is to learn whether a
quality gate condition on each of them is evaluated, in both the Overall Code and New Code views.

## Compatibility

- Built against Sonar plugin API **10.14.0.2599** (jar manifest `Sonar-Version: 10.14.0.2599`), Java 17
  bytecode. Target server: self-hosted SonarQube Server **2026.1.x and later**.
- Tested so far: **nothing on a live server yet.** That is what the install below is for.
- Scanner side: any scanner that loads server plugins (SonarScanner CLI, Maven, Gradle, Jenkins).

## For the Sonar admin: install on sonartest

1. Download `sonar-mutation-report-plugin-0.1.0-spike.jar` from the
   [v0.1.0-spike release](https://github.com/Guy-nice/sonar-mutation-report-plugin/releases/tag/v0.1.0-spike).
2. Verify the checksum:

       shasum -a 256 sonar-mutation-report-plugin-0.1.0-spike.jar
       # a86bb706bfe0ef2dbe4b07b6f6beb87f217e5ac086f6fd8efdccc1b737975ab0

3. Copy the jar into `<SONARQUBE_HOME>/extensions/plugins/` on the server (all nodes, if clustered).
4. Restart SonarQube.
5. Confirm it loaded: Administration > Marketplace > Installed should list **Mutation Report 0.1.0**,
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

### Report format (spike)

```json
{
  "schemaVersion": "0.1-spike",
  "run": { "threshold": 80 },
  "summary": {
    "mutation_score": 73.3,
    "new_mutation_score": 81.8,
    "total": 30,
    "killed": 22,
    "survived": 8
  }
}
```

Only `summary.mutation_score` is required today. The other fields are carried for the next iteration.

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

- Scoring is **diff-scoped**: only mutants on lines the PR added or changed are counted, so a PR is
  judged on its own changes. The overall (whole-file) score is reported separately.
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
| `mutation_score` | `summary.mutation_score` | measure `mutation_score` (**gate**), this spike |
| diff-scoped score | `summary.new_mutation_score` | measure `new_mutation_score`, this spike |
| `test_strength` | `summary.test_strength` | measure `mutation_test_strength` |
| per-language summaries (TypeScript, Python, Java, ...) | `languages.<name>.*` | per-language measures (fixed list + "other") |
| survivors and no-coverage mutants: file, line, operator, status | `mutants[]` | external issues, final survivors only |
| threshold, round, run ID, commit SHA, agent version | `run.*` | informational measures / checks |
| lines of test code the agent added | `run.test_lines_added` | measure `mutation_test_lines_added` |
| signature, runner ID | `run.signature` (phase 2) | `mutation_verified` (phase 2) |

Not sent in v1: the HTML report, killing-test names, mutant descriptions, round-1 history.

### Today vs target

- **Today** the agent's Step 7 (`sonar_export.py`) writes a **SARIF** file (issues only) and wires
  `sonar.sarifReportPaths`. It already filters to changed lines, drops files Sonar does not analyze,
  and adds a score issue that fails a "new Critical issues > 0" gate. That works without any plugin and
  stays as the fallback.
- **Target** the same step also writes `.sonar/mutation-report.json` and wires
  `sonar.mutation.reportPath`. The report must be committed to the PR, because CI's scan reads it from
  the checkout (do not gitignore `.sonar/`).
- Exit codes of the agent (for CI or scripts): 0 gate passed, 1 error, 2 gate failed (below threshold,
  more work possible), 3 manual review required (still below threshold after round 2).

### Identity and trust

- **Phase 1:** whoever runs the agent supplies their own Sonar user token (the agent asks for it if it
  is missing, reads it from `SONAR_TOKEN`, and never writes it to a file, log or commit). Sonar records
  who submitted the analysis. This proves who uploaded, **not** that the numbers are authentic.
- **Phase 2:** a signing service attests that the agent produced the report; the plugin verifies the
  signature with a public key from a Sonar global setting and publishes `mutation_verified`. A gate
  condition on it makes an unsigned or edited report fail the gate.

## Verification checklist (spike acceptance)

Run a scan of a project that has the property and a report, then check:

1. Scanner log contains `Mutation Report: published mutation_score=...`.
2. The project's Overview > Overall Code shows the score (Measures > domain "Mutation").
3. `GET /api/measures/component?component=<key>&metricKeys=mutation_score,new_mutation_score` returns
   both values.
4. Create a quality gate with the condition **Mutation Score is less than 80** and assign it to the
   project. The gate fails for a 73.3 score and passes for 81.8.
5. Repeat on a **pull request** analysis. Check whether a condition on `new_mutation_score` is evaluated
   on the PR, and whether the PR quality gate status reflects it.

Items 4 and 5 are the open questions. The result decides how new-code gating is built in the full plugin.

## Build

Requires JDK 17+ and Maven 3.9+.

    mvn package        # jar in target/

If Maven fails with a PKIX / certificate error behind a corporate proxy, let Java use the macOS
keychain:

    export MAVEN_OPTS="-Djavax.net.ssl.trustStoreType=KeychainStore -Djavax.net.ssl.trustStore=NONE"

## Design direction (full plugin, not in this spike)

- One versioned JSON report written by the mutation agent. The plugin owns the JSON Schema.
- More measures: counts (total, killed, survived, no-coverage, errors, suppressed), test strength,
  threshold, test lines added, and per-language score and counts for a fixed language list plus "other".
- Survivors raised as external issues (no language or quality profile needed), final state only, with a
  pull request changed-line filter.
- Gate threshold lives in the Sonar quality gate, not in the report.
- Phase 2: report signing by an agent-attestation service, a `mutation_verified` measure, and Ed25519
  public keys held in a Sonar global setting. Phase 1 identity is the Sonar user token of whoever runs
  the scan, which proves who uploaded, not that the numbers are authentic.
- Docker-based integration tests on 2026.1.x and the next Sonar version, per pull request and nightly.

## License

TBD.
