# ADR 0002: Additive counts in scanner, percentages on server

Status: Accepted

## Context
A percentage cannot be summed up a folder tree. A percentage of a folder must come from the counts of its files.

## Decision
- The sensor saves additive counts on files and on the project.
- `MutationCountsComputer` sums counts for folders.
- `MutationPercentComputer` derives every percentage on every component from its counts.
- Exception: per-language score is saved by the sensor, on the project only.

## Consequences
- One formula per metric, in one class.
- A ratio with a missing input or zero denominator gives no measure.
- Every metric has an overall and a `new_` scope, so quality gates can judge new code.
