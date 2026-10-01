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
