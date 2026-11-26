# 2. Containers (C4 level 2)

Scope: deployable parts and their links.

```mermaid
C4Container
  title Containers - Sonar Mutation Report Plugin

  Person(dev, "Developer")
  Person(mgr, "Manager")

  System_Ext(agent, "Mutation testing agent", "Writes mutation-report.json")

  System_Boundary(sq, "SonarQube Server") {
    Container(sensor, "Scanner extension", "Java 17, Sonar Plugin API 10.11", "Reads report. Publishes measures, issues, rules. Runs on the scanner.")
    Container(computers, "Server computers", "Java, MeasureComputer", "Sums counts up the tree. Derives percentages. Runs in Compute Engine.")
    Container(pages, "Dashboard pages", "TypeScript, esbuild bundle", "overview.js and project.js. Run in the browser. Loaded from the plugin jar.")
    Container(webapi, "Sonar web API", "REST", "Components, measures, issues, PRs, views.")
    ContainerDb(db, "Sonar database", "SQL", "Measures, issues, PR analyses.")
  }

  Rel(agent, sensor, "mutation-report.json", "file, path in sonar.mutation.reportPath")
  Rel(sensor, webapi, "Analysis report upload", "HTTPS")
  Rel(webapi, computers, "Compute Engine task")
  Rel(computers, db, "Writes derived measures")
  Rel(webapi, db, "Reads")
  Rel(dev, pages, "Project page", "browser")
  Rel(mgr, pages, "Overview page", "browser")
  Rel(pages, webapi, "GET with viewer session", "HTTPS, max 6 parallel")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Legend
- The jar is one artifact. It holds all four plugin containers.
- Scanner extension runs on the CI machine. Computers run on the server. Pages run in the browser.

## Container table
| Container | Technology | Runs on | Entry point |
|---|---|---|---|
| Scanner extension | Java 17 | CI scanner | `MutationReportSensor` |
| Server computers | Java 17 | Sonar Compute Engine | `MutationCountsComputer`, `MutationPercentComputer` |
| Metric catalog | Java 17 | Sonar server and scanner | `MutationMetrics` |
| Dashboard pages | TypeScript to IIFE bundle | Browser | `entry-overview.ts`, `entry-project.ts` |
| Page registration | Java 17 | Sonar server | `MutationPages` |

Plugin wiring: `MutationReportPlugin.define()` registers all five classes.
