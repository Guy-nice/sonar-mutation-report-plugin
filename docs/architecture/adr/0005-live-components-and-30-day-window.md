# ADR 0005: Live components and 30-day window

Status: Accepted

## Context
A server has many projects. Most do not use mutation testing. Sonar deletes old PR analyses (30 days default).

## Decision
- Window: 30 days (`WINDOW_DAYS`).
- Active component: a PR analyzed in the window. This is the 100% of adoption.
- Adopted component: active, with mutation data on at least one of those PRs.
- Live component: has such data. Only live components are listed. The rest are counted ("N hidden").
- A component with an error is not counted. Its state is unknown.
- A component with no PR in the window is not checked again for 24 hours. Refresh checks all.

## Consequences
- Adoption % is a share of components, not of PRs or lines.
- A component with 1 mutated PR of 10 counts as adopted.
- Dormant and adopter hints live in `localStorage`. They change load order and skips only.
