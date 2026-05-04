# ADR-0002: S3 Payload Storage for EventBridge Size Limit

- **Status:** Accepted
- **Date:** 2026-04-27
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

EventBridge has a 256KB maximum entry size. GitHub webhooks can be up to 25MB (10MB via API Gateway). Large payloads like security_advisory events exceed the EventBridge limit, causing delivery failures.

## Decision

Store every webhook payload in S3 (date-partitioned, 90-day lifecycle). EventBridge detail includes an `s3_reference` and `payload_complete` flag. Inline payload is included only when under 200KB.

## Consequences

### Positive
- Solves EventBridge size limit for all current and future event types
- Provides a delivery audit log for free
- S3 storage is cheap (~$0.023/GB/month)

### Negative
- Extra S3 write per event (~$0.005/1000 puts)
- Handlers may need to fetch from S3 for large payloads, adding latency

## References
- PR #1
- ADR-0001
