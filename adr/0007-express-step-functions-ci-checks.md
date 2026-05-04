# ADR-0007: Express Step Functions for CI Checks

- **Status:** Accepted
- **Date:** 2026-05-01
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

Need orchestration for multi-step workflows (CI checks, deployments). Had to choose between Standard and Express Step Functions for the CI check use case.

## Decision

Express workflows for CI checks (under 5 minutes). Triggered by `@ai3-mvp check <sha>` command. Flow: Create Check Run -> Wait (simulated CI) -> Complete Check Run. Standard workflows deferred for long-running deployments in a future iteration.

## Consequences

### Positive
- $1/million state transitions (vs $25 for Standard)
- Synchronous execution model
- CloudWatch logging shows full state trace

### Negative
- Express execution history not in Step Functions console (only in CloudWatch Logs)
- Max 5-minute timeout
- OAuth token passed as workflow input appears in execution logs (noted for future fix)

## References
- PR #24
- Issue #10
