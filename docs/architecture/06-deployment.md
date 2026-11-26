# 6. Build and deployment

## 6.1 Deployment view

```mermaid
C4Deployment
  title Deployment - Sonar Mutation Report Plugin

  Deployment_Node(ci, "CI runner", "Linux or Windows") {
    Container(agent, "Mutation testing agent", "Python", "Writes mutation-report.json")
    Container(scanner, "SonarScanner", "CLI, Maven, Gradle, Jenkins", "Loads server plugins. Runs the sensor.")
  }
  Deployment_Node(srv, "SonarQube Server", "Self-hosted 2026.1.x or later") {
    Deployment_Node(plugins, "extensions/plugins") {
      Container(jar, "sonar-mutation-report-plugin-1.1.0.jar", "Java 17 + static JS", "Sensor, computers, metrics, pages")
    }
    ContainerDb(db, "Database", "SQL")
  }
  Deployment_Node(bro, "User browser") {
    Container(pg, "Dashboard pages", "JS bundles", "Served from the jar")
  }

  Rel(agent, scanner, "report file")
  Rel(scanner, jar, "downloads plugin")
  Rel(scanner, db, "uploads analysis, stored by server", "HTTPS")
  Rel(pg, db, "web API reads, via server", "HTTPS")
```

## 6.2 Build
| Step | Tool | Output |
|---|---|---|
| Frontend type check | `tsc` | none |
| Frontend bundle | esbuild (`frontend/build.mjs`) | `src/main/resources/static/overview.js`, `project.js` |
| Frontend tests | vitest (`npm test`) | none |
| Java build and tests | Maven, JUnit 5, AssertJ | `target/sonar-mutation-report-plugin-<version>.jar` |
| Package | sonar-packaging-maven-plugin | plugin jar |

- `mvn package` also builds the frontend. Needs Node 20 or newer.
- `-Dfrontend.skip=true` skips it. A clean checkout then has no JS and a Java test fails.
- Compile target: Java 17. Plugin API 10.11.0.2468.
- Dev harness: `cd frontend && npm run dev`. Renders both pages with fake data.

## 6.3 Install
1. Download the jar and the `.sha256` from the GitHub release.
2. Check: `shasum -a 256 <jar>`.
3. Remove the old jar from `extensions/plugins/` (all nodes).
4. Copy the new jar. Restart Sonar.
5. First load of a new third-party plugin version: an admin accepts the plugin risk once.

## 6.4 Scan setup
Set `sonar.mutation.reportPath` (path relative to the project root). Without it the sensor does not run.
Optional: `sonar.mutation.portfolio` (free text). It is published as `mutation_portfolio`. The dashboard does not read it. It groups by Sonar Portfolio.

## 6.5 Compatibility
| Item | Value |
|---|---|
| Plugin API | 10.11.0.2468 |
| Java bytecode | 17 |
| Target server | SonarQube Server 2026.1.x and later |
| PR pages need | Developer Edition or higher |
| Portfolio grouping needs | Enterprise Edition or higher |
