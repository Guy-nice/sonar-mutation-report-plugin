# Architecture - sonar-mutation-report-plugin

Architecture of the plugin. Models: C4 (levels 1-3), UML (Mermaid), ADRs.
All diagrams are Mermaid. GitHub renders them. No extra tool needed.

## What the plugin does
1. An agent runs mutation tests and writes a JSON report.
2. A Sonar scanner sensor reads the report and publishes measures and issues.
3. Two web pages show the data: a manager overview and a project page.

The plugin runs no mutation test. It only reads and shows results.

## Reading order
| # | File | Model | Answers |
|---|---|---|---|
| 1 | [01-context.md](01-context.md) | C4 L1 | Who uses it? What is around it? |
| 2 | [02-containers.md](02-containers.md) | C4 L2 | What runs where? |
| 3 | [03-components.md](03-components.md) | C4 L3 | What is inside each part? |
| 4 | [04-dynamic-views.md](04-dynamic-views.md) | UML sequence, state | How does data flow? |
| 5 | [05-data-model.md](05-data-model.md) | UML class | What are the data shapes? |
| 6 | [06-deployment.md](06-deployment.md) | C4 deployment | How is it built and installed? |
| 7 | [07-quality-and-risks.md](07-quality-and-risks.md) | Text | Rules, limits, risks |
| - | [adr/](adr/) | ADR | Why we decided it |

## Source of truth
Each fact comes from the code. Verified against `main` at version 1.1.0.

| Area | Path |
|---|---|
| Scanner and server side (Java) | `src/main/java/com/nice/sonar/mutation/` |
| Pages (TypeScript) | `frontend/src/` |
| Build | `pom.xml`, `frontend/build.mjs` |
| Product spec | `docs/specs/2026-10-05-mutation-dashboard-design.md` |

## How to update
- Change code that affects a diagram: change the diagram in the same PR.
- Keep one idea per diagram. Add a title and a legend.
- New decision with long-term effect: add `adr/NNNN-title.md`. Never edit an accepted ADR. Supersede it.
- Check each Mermaid block renders on GitHub before merge.
