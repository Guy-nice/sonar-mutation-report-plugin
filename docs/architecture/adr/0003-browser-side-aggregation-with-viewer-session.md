# ADR 0003: Browser-side aggregation with viewer session

Status: Accepted

## Context
The pages need data over many projects and pull requests. The plugin has no server component that serves aggregated data.

## Decision
- Pages run in the browser. They call the Sonar web API with the viewer's own session.
- `SonarApi` caps parallel calls at 6, caches for 5 minutes, pages at 500.
- The UI depends on the `DataSource` interface.

## Consequences
- Sonar permissions decide what each person sees. No service token to store.
- No new server code to secure or maintain.
- Load time grows with project count (about 60 s for 2,084 projects, v0.4.1). Sized for about 30 projects and a few hundred PRs a month. For more, aggregate outside Sonar (BI over the web API).
- Tests and the dev harness use fake `DataSource` implementations.
