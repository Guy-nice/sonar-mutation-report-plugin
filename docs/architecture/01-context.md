# 1. System context (C4 level 1)

Scope: the plugin as one box. Shows people and neighbour systems.

```mermaid
C4Context
  title System context - Sonar Mutation Report Plugin

  Person(dev, "Developer", "Opens a pull request. Reads survivors and fixes tests.")
  Person(mgr, "Manager / Director", "Reads adoption and score by Sonar Portfolio.")

  System(plugin, "Sonar Mutation Report Plugin", "Publishes mutation results into Sonar. Shows two dashboard pages.")

  System_Ext(agent, "Mutation testing agent", "Runs mutation tests on changed code. Writes mutation-report.json (schema v1).")
  System_Ext(ci, "CI pipeline + SonarScanner", "Runs the agent, then the scan with the plugin loaded.")
  System_Ext(sonar, "SonarQube Server", "Stores measures and issues. Gives the web API and Portfolios.")

  Rel(dev, ci, "Opens pull request")
  Rel(ci, agent, "Runs")
  Rel(agent, ci, "Report file")
  Rel(ci, plugin, "Scan reads report through sensor")
  Rel(plugin, sonar, "Measures, issues, pages")
  Rel(dev, plugin, "Project page", "browser")
  Rel(mgr, plugin, "Overview page", "browser")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Legend
- Person = human user. System = software. `_Ext` = outside our code.
- The agent is a separate product. The plugin only reads its JSON file.

## Key points
- The report file is the only contract with the agent: `schemaVersion` major 1.
- Sonar permissions decide what each person sees.
- Pull request analysis needs Developer Edition or higher. Portfolios need Enterprise Edition or higher.
