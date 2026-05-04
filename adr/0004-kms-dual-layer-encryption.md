# ADR-0004: KMS Dual-Layer Encryption for OAuth Tokens

- **Status:** Accepted
- **Date:** 2026-04-28
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

UserTokens DynamoDB table stores GitHub OAuth access and refresh tokens. These are high-value credentials that need defense-in-depth encryption beyond DynamoDB's default server-side encryption.

## Decision

Two encryption layers:
- **Layer 1:** Customer-managed KMS key on DynamoDB table (transparent encryption at rest)
- **Layer 2:** Application-level KMS Encrypt/Decrypt on token values before write and after read

Both layers share one KMS key ($1/month). Latency impact is +3ms per operation (negligible vs 2-5s GitHub API calls).

## Consequences

### Positive
- Even with DynamoDB GetItem IAM access, tokens appear as opaque base64
- Defense-in-depth against credential exposure

### Negative
- Code complexity in tokenStore.ts
- Users must re-authorize if KMS key is rotated or deleted

## References
- PR #13
- Issue #3
