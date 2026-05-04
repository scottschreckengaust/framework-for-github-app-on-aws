# ADR-0006: Per-Handler Idempotency Keys

- **Status:** Accepted
- **Date:** 2026-05-01
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

Handler-level idempotency was added to prevent duplicate side effects. Initial implementation used `delivery:<deliveryId>` as the key. But EventBridge delivers events to ALL matching rules -- the stub handler (catch-all) and comment handler (issue_comment rule) both receive `issue_comment` events. Whichever ran first blocked the other.

## Decision

Use `delivery:<handlerName>:<deliveryId>` as the idempotency key. Each handler has its own namespace in the Jobs table.

## Consequences

### Positive
- Multiple handlers can independently process the same event without blocking each other
- Idempotency still prevents duplicate processing within a single handler

### Negative
- More DynamoDB writes (one per handler per event)
- Negligible cost impact

## References
- PR #24
- Issue #12
