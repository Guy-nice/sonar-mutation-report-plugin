# ADR 0006: Score counts only test kills

Status: Accepted

## Context
Mutation tools differ. Some count a timeout as detected. The agent's gate does not.

## Decision
- `score = killed / total x 100`. Timeouts and memory errors are not kills.
- `killed_total = killed + timed_out + memory_error` is published as a separate measure.
- The plugin follows the agent's gate formula, so Sonar and the agent give the same verdict.

## Consequences
- A score can sit below a tool that counts timeouts as detected.
- Timeouts vary by machine load, so a score near the threshold can flip between runs.
- If the agent changes its rule, supersede this ADR and change `MutationPercentComputer` together.
