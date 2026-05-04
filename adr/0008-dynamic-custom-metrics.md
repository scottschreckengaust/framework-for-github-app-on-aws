# ADR-0008: Dynamic Custom Metrics with Event-Driven Dimensions

- **Status:** Accepted
- **Date:** 2026-04-30
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

Dashboard initially used Lambda-level metrics (invocations, errors) which don't distinguish between apps or orgs. Need per-app, per-org visibility for multi-tenant scaling.

## Decision

All handlers publish custom metrics to `GitHubAppPlatform` CloudWatch namespace using `@aws-lambda-powertools/metrics`. Dimensions extracted from event payload at runtime: AppId (from installation.id or APP_ID env var), OrgName (from organization.login), EventType, HandlerName, Command. Dashboard uses SEARCH expressions that auto-discover new apps/orgs.

## Consequences

### Positive
- Adding a second app requires zero metric or dashboard changes
- SEARCH expressions auto-discover new dimension combinations

### Negative
- CloudWatch custom metrics cost $0.30/metric/month per unique dimension combination
- Estimated ~$3-9/month depending on app/org count

## References
- PR #18
- Issue #17
