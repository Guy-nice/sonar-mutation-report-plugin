# 7. Quality attributes, constraints, risks

## 7.1 Quality attributes
| Attribute | How the design gives it |
|---|---|
| Security | Pages call the web API with the viewer's session. Sonar permissions decide the data. No service token. |
| Correctness | Counts add up the tree. Percentages derive from counts in one place. Missing value shows `-`, never 0. |
| Robustness | Invalid report fails the scan with a clear message. Missing report logs a warning. Portfolio failure gives `[]`. One failed project does not stop the page. |
| Performance | Max 6 parallel calls. 5 min cache. Page size 500. Known adopters load first. Dormant projects skipped 24 h. |
| Testability | UI depends on `DataSource`. Pure `model.ts`. Fake data harness. JUnit and vitest. |
| Compatibility | Report schema major 1 only. |
| Maintainability | No UI framework. One metric catalog. Small classes. |

## 7.2 Constraints
- Sonar plugin API 10.11. Java 17.
- Pages run in the Sonar web app. They register with `registerExtension`.
- Sonar keeps PR analyses for the housekeeping period (30 days default). Older data is gone.
- Sonar does not say if a PR is open. "Open" means analyzed in the last 7 days.
- Sized for about 30 projects and a few hundred PRs a month. More: aggregate outside Sonar.

## 7.3 Risks
| # | Risk | Effect | Mitigation | Status |
|---|---|---|---|---|
| R1 | Portfolio API call differs by Sonar version | All components under "No portfolio" | Fallback calls. `scripts/probe-portfolios.sh`. | Not verified on a real server with Portfolios (v1.1.0-rc1) |
| R2 | Browser-side aggregation on a large server | Slow load, many calls | Cap 6, cache, adopter order, dormant skip. Measured 60 s for 2,084 projects (v0.4.1). | Accepted |
| R3 | Score formula differs from other tools | Timeouts are not kills here. Other tools may count them as detected. | Documented. `killed_total` is published too. | Accepted |
| R4 | Report schema change by the agent | Scan fails on unknown major | Major check. Version in error text. | Accepted |
| R5 | `localStorage` stale after data change | Old adopter or dormant hint | Refresh clears dormant. 24 h TTL. Hints change load order only. | Accepted |
| R6 | Component with one mutated PR counts as adopted | Adoption higher than share of PRs | Documented in README definitions | Accepted |
| R7 | Pages show in every project menu | Projects without mutation show "no data" | Documented | Accepted |
| R8 | Frontend skipped in build | Jar without JS | Java test checks bundles exist | Mitigated |
| R9 | New plugin version needs admin accept | Delay at install | Install steps list it | Accepted |

## 7.4 Open points
- Verify R1 on SonarTest. Record the working API call.
- No CI job runs the Java and frontend tests (none is in the repo). Add one.
- Link to the agent repo architecture when it exists.

## 7.5 Decision records
See [adr/](adr/).
