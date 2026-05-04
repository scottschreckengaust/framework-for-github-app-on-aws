# ADR-0003: WAF Body-Rule Exclusions for Webhook Payloads

- **Status:** Accepted
- **Date:** 2026-04-27
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

AWS Managed Rules (GenericLFI_BODY, CrossSiteScripting_BODY, etc.) false-positive on GitHub webhook JSON payloads containing URLs, code blocks, and HTML. Legitimate webhooks were being blocked.

## Decision

Exclude all body-inspection rules from AWSManagedRulesCommonRuleSet. HMAC-SHA256 signature verification is the trust boundary for webhook content. Keep IP-based rate limiting active.

## Consequences

### Positive
- No false positives on legitimate webhooks
- Signature verification provides strong authentication of payload origin

### Negative
- Reduced WAF protection surface on POST body content
- Mitigated by HMAC-SHA256 signature verification before any processing

## References
- PR #1
- ADR-0001 Lessons Learned section
