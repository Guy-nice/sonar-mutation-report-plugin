# ADR 0001: Passive project-level sensor

Status: Accepted

## Context
The agent runs mutation tests outside Sonar. Reports are repo-wide. Paths are relative to the project root. A module sensor in a multi-module build saved the same project measure twice. Sonar failed with "Can not add the same measure twice" (fixed in 1.0.1).

## Decision
- The sensor only reads a report and publishes it. It runs no mutation test.
- The sensor is a `ProjectSensor`. It runs once per analysis.
- It runs only when `sonar.mutation.reportPath` is set.

## Consequences
- Plugin has no engine dependency. Any agent that writes schema v1 works.
- Multi-module builds work.
- A missing report only logs a warning. An invalid report fails the scan.
