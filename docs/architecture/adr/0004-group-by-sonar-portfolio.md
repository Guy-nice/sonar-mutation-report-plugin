# ADR 0004: Group overview by Sonar Portfolio

Status: Accepted

## Context
Managers want adoption by team. Before 1.1.0 the overview grouped by the free-text property `sonar.mutation.portfolio`. Teams had to set it in every scan. It could drift from the real team structure.

## Decision
- Group by Sonar Portfolios (Enterprise Edition and higher). Membership is set in Sonar, not in the scan.
- Read portfolios with the viewer's session. Try known web API calls in turn, because the call differs by Sonar version.
- A project in several portfolios counts in each. It counts once in the total.
- No portfolio, no permission or API failure: component goes under "No portfolio".
- The property is still published as `mutation_portfolio`. The dashboard does not read it.

## Consequences
- No scan change needed for grouping.
- Users see only portfolios they may browse.
- Open risk: the API call is not yet verified on a real server with Portfolios (R1 in 07-quality-and-risks.md).
