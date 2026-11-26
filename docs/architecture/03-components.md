# 3. Components (C4 level 3)

Two diagrams: Java side, then TypeScript side.

## 3.1 Java side

```mermaid
C4Component
  title Components - Java plugin (scanner and server)

  Container_Ext(agent, "Mutation testing agent", "mutation-report.json")
  ContainerDb_Ext(sonar, "SonarQube Server", "Receives measures and issues")

  Container_Boundary(java, "Java plugin") {
    Component(plugin, "MutationReportPlugin", "Plugin", "Registers all extensions.")
    Component(sensor, "MutationReportSensor", "ProjectSensor", "Runs once per analysis. Only when sonar.mutation.reportPath is set.")
    Component(parser, "ReportParser", "Gson", "Validates schema major 1. Builds Report.")
    Component(report, "Report / Counts", "Value objects", "Immutable. score, alive, killedTotal, testStrength.")
    Component(metrics, "MutationMetrics", "Metrics", "Catalog: Base x Scope (overall, new_). Languages. Keys mutation_*.")
    Component(counts, "MutationCountsComputer", "MeasureComputer", "Sums additive counts of children. Folders get totals.")
    Component(percent, "MutationPercentComputer", "MeasureComputer", "Derives score, strength, density, shares, kill ratio.")
    Component(pages, "MutationPages", "PageDefinition", "Registers overview (global) and project (component) pages.")
  }

  Rel(plugin, sensor, "registers")
  Rel(plugin, metrics, "registers")
  Rel(plugin, counts, "registers")
  Rel(plugin, percent, "registers")
  Rel(plugin, pages, "registers")
  Rel(agent, parser, "JSON file")
  Rel(parser, report, "creates")
  Rel(sensor, parser, "calls")
  Rel(sensor, metrics, "uses keys from")
  Rel(sensor, sonar, "saves measures, issues, ad hoc rules")
  Rel(counts, metrics, "uses keys from")
  Rel(percent, metrics, "uses keys from")
  Rel(counts, percent, "runs before")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

### Rules in this side
- Sensor is passive. It runs no mutation test.
- Sensor is a project sensor, not a module sensor. Reason: project measures save once. See [ADR 0001](adr/0001-project-level-passive-sensor.md).
- Sensor saves additive counts only. Percentages come from the computers. See [ADR 0002](adr/0002-counts-in-scanner-percentages-on-server.md).
- Sensor saves per-file counts, project counts, per-language measures, one external issue per surviving or uncovered mutant.
- Files not in the analysis are skipped. Mutants on an invalid line are skipped.
- Languages: csharp, typescript, javascript, java, python, go. All others go to `other`.

## 3.2 TypeScript side

```mermaid
C4Component
  title Components - Dashboard pages (browser)

  Container_Ext(webapi, "Sonar web API", "REST")
  Container_Ext(sonarui, "Sonar web app", "Calls registerExtension")

  Container_Boundary(ts, "Dashboard pages") {
    Component(eo, "entry-overview.ts", "Entry", "Registers mutationreport/overview. One SonarApi per bundle.")
    Component(ep, "entry-project.ts", "Entry", "Registers mutationreport/project. Reads page context.")
    Component(ctx, "context.ts", "Pure", "Maps Sonar options to project, PR or branch.")
    Component(ui, "ui/*", "DOM builders", "overview, projectPage, prList, prDetail, widgets. No framework.")
    Component(model, "model.ts", "Pure", "Window, live, adoption, groupByPortfolio, bands, averages.")
    Component(api, "api.ts: SonarApi", "DataSource", "Cache 5 min. Max 6 parallel. Pages of 500. Portfolio fallbacks.")
    Component(store, "store.ts", "localStorage", "Known adopters. Dormant projects for 24 h.")
    Component(types, "types.ts", "Types", "DataSource interface and result shapes.")
  }

  Rel(sonarui, eo, "mount")
  Rel(sonarui, ep, "mount")
  Rel(ep, ctx, "parse")
  Rel(eo, ui, "renderOverview")
  Rel(ep, ui, "renderProjectPage")
  Rel(ui, model, "calls")
  Rel(ui, store, "reads, writes")
  Rel(ui, types, "depends on DataSource")
  Rel(api, types, "implements")
  Rel(eo, api, "creates")
  Rel(ep, api, "creates")
  Rel(api, webapi, "GET")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

### Rules in this side
- UI depends on the `DataSource` interface, not on `SonarApi`. Tests and the dev harness use fakes.
- `model.ts` has no I/O. All score and adoption math is here.
- `store.ts` is a speed-up only. Every call swallows storage errors.
- No framework. Plain DOM helpers in `ui/dom.ts`.
- Build: `frontend/build.mjs` writes `overview.js` and `project.js` into `src/main/resources/static/`.
