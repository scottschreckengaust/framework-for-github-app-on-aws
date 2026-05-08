# ADR-0001: ai3-mvp Webhook Ingestion, OAuth Authorization, and Orchestration Architecture

- **Status:** Accepted
- **Date:** 2026-04-28
- **Decision makers:** Scott Schreckengaust
- **Technical story:** Build a GitHub App bot (`ai3-mvp`) for the `sbalswa` organization that reacts to webhook events, authorizes users via OAuth, and orchestrates long-running CI/CD workflows.

## Context and Problem Statement

The existing Credential Manager framework handles GitHub App authentication (App tokens, Installation Access tokens) but has no infrastructure for receiving webhook events, authorizing users, or orchestrating workflows. We need to extend it with:

1. A webhook ingestion pipeline to receive and route GitHub events
2. User authorization so actions are attributed to the requesting user
3. Orchestration for long-running workflows with progress reporting

## Decision Drivers

- Security: all actions must use the requesting user's OAuth token for GitHub audit trail attribution
- Scalability: support 50+ concurrent DAG-style workflows
- Extensibility: adding new event handlers should not require modifying existing code
- Cost: serverless, pay-per-use, minimal idle cost
- Reliability: idempotent processing, no silent event loss

## Considered Options

### Webhook Ingestion
1. **Monolith Router** — single Lambda handles all events
2. **EventBridge Fan-Out** — webhook receiver dispatches to EventBridge, rules route to handler Lambdas
3. **SNS Fan-Out** — SNS topics per event category

### User Authorization
- **A.** GitHub team allowlist only (bot identity for all actions)
- **B.** GitHub OAuth user-to-server tokens for all actions
- **C.** Hybrid: allowlist for low-risk, OAuth for high-risk

### Orchestration
- **A.** AWS Step Functions (Express + Standard)
- **B.** SQS + Lambda fan-out (DIY orchestration)
- **D.** Hybrid Step Functions + SQS

## Decision Outcome

### Webhook Ingestion: Option 2 — EventBridge Fan-Out

**Rationale:** Loose coupling allows independent scaling of handlers. New handlers are added by creating an EventBridge rule + Lambda — no changes to existing code. Built-in dead letter queues and event replay for debugging. Content-based filtering handles the full webhook event catalog.

### User Authorization: Option B — OAuth for All Actions

**Rationale:** Every action performed through the user's own `ghu_` token provides full GitHub audit trail attribution. No ambiguity about who triggered what. The installation token is used only for org membership and permission checks, not for performing actions.

### Orchestration: Option A — Step Functions Only

**Rationale:** At the target scale (50+ concurrent, complex DAGs), SQS savings are pennies (~$0.13/month at 1K runs for Step Functions vs DIY tracking cost). Step Functions provides native DAG support, visual debugging, retries, and parallel branches out of the box. Express workflows for <5min jobs, Standard for long-running deployments.

## Architecture

### Components

| Component | AWS Service | Purpose |
|-----------|-------------|---------|
| Webhook endpoint | API Gateway REST API + WAF | Receive GitHub webhooks, rate limiting |
| Webhook receiver | Lambda | Verify HMAC-SHA256 signatures, dedup, dispatch |
| Payload archive | S3 | Store every webhook payload (90-day lifecycle) |
| Event routing | EventBridge custom bus | Route events by type to handler Lambdas |
| Event handlers | Lambda (per event type) | Process events with authorization |
| OAuth login | Lambda (API Gateway GET) | Generate state nonce, redirect to GitHub |
| OAuth callback | Lambda (API Gateway GET) | Exchange code for token, store in DynamoDB |
| Token storage | DynamoDB (UserTokens table) | User OAuth tokens with PITR |
| Auth state | DynamoDB (AuthState table) | CSRF nonces with 10-min TTL |
| Idempotency | DynamoDB (Idempotency table) | Delivery ID dedup with 24-hour TTL |
| Job tracking | DynamoDB (Jobs table) | Step Functions execution tracking |
| Orchestration | Step Functions (Express + Standard) | Workflow execution |
| Failure handling | SQS DLQ + alert Lambda | Failed event processing |
| Monitoring | CloudWatch alarm + dashboard | 4XX errors, DLQ depth |

### Data Flow

```
GitHub webhook POST
  → API Gateway (WAF: rate limit + managed rules, body-inspection excluded)
    → Receiver Lambda
      1. Verify X-Hub-Signature-256 (HMAC-SHA256)
      2. Idempotency check (DynamoDB conditional put)
      3. Store full payload in S3 (date-partitioned)
      4. Put event on EventBridge (inline payload if <200KB, S3 ref if larger)
      5. Return 200 immediately

EventBridge rules route by detail-type:
  → issue_comment → Comment Handler Lambda
      1. Check @ai3-mvp mention
      2. Get installation token (Lambda invoke to Credential Manager)
      3. Authorize user (org membership + repo write + OAuth token)
      4. Auto-refresh expired tokens
      5. Respond using user's OAuth token
  → all events → Stub Handler Lambda (logs for development)
  → (future) push → CI Handler, pull_request → PR Handler, etc.

Failed deliveries → SQS DLQ → Alert Handler Lambda (logs)
```

### Security Properties

- Webhook signatures verified on every request (HMAC-SHA256 with Secrets Manager)
- All user-initiated actions use the user's own OAuth token
- OAuth state nonce prevents CSRF on callback (10-min TTL, one-time use)
- Tokens stored in DynamoDB with Point-in-Time Recovery
- Automatic token refresh with rotation (GitHub rotates refresh tokens on each use)
- Authorization checks: org membership AND repo write access required
- WAF rate limiting (1000 req/5min per IP) + AWS managed rules
- No secrets in environment variables — all from Secrets Manager at runtime
- S3 payload bucket: encryption at rest, block all public access

## Lessons Learned During Implementation

### WAF False Positives on Webhook Payloads
AWS Managed Rules body-inspection rules (`GenericLFI_BODY`, `CrossSiteScripting_BODY`, `GenericRFI_BODY`, `SizeRestrictions_BODY`, `EC2MetaDataSSRF_BODY`) false-positive on GitHub webhook JSON payloads. Excluded all body-inspection rules — HMAC signature verification is the trust boundary for webhook content.

### API Gateway Header Casing
REST API Gateway preserves original mixed-case headers from GitHub (`X-GitHub-Event`). Handlers must normalize all header keys to lowercase before lookup.

### EventBridge 256KB Detail Limit
GitHub webhooks can be up to 25MB; API Gateway accepts up to 10MB; EventBridge entries max 256KB. Solution: store every payload in S3 and include `s3_reference` + `payload_complete` flag in EventBridge detail. Inline payload only when under 200KB.

### CDK Circular Dependencies with API Gateway
Using `api.urlForPath()` creates a dependency on the deployment stage. Lambdas that are also API Gateway integrations create a circular dependency. Solution: construct URLs manually from `api.restApiId` and `Aws.REGION`.

### Config Ownership
All configuration files (eslint, package.json, tsconfig) are owned directly. Edit them in place. (Previously managed by projen; ejected in ADR-0010.)

### SDK Version Compatibility
Adding new `@aws-sdk/client-*` packages can pull in newer `@smithy/types` that break `aws-sdk-client-mock`. Pin new SDK clients to the same version range as existing ones, or use `devDeps` with Lambda runtime SDK for non-critical clients.

### Lambda-to-Lambda Invocation for Credential Manager
The Smithy client over Function URLs requires SigV4 signing which is fragile with bundled dependencies. Direct `Lambda.InvokeCommand` with a properly shaped `APIGatewayProxyEventV2` payload is more reliable for internal Lambda-to-Lambda calls.

## Consequences

### Positive
- Fully serverless, ~$3-8/month idle cost
- Every GitHub event captured in S3 for audit
- New handlers added without modifying existing code
- User actions fully attributed via OAuth tokens
- Automatic token refresh eliminates re-auth friction

### Negative
- EventBridge 256KB limit requires S3 indirection for large payloads
- API Gateway 10MB limit theoretically below GitHub's 25MB max (mitigated by CloudWatch alarm)
- ~~Comment handler currently monolithic~~ (Resolved: Command router pattern implemented in PR #13)
- ~~OAuth tokens stored as plaintext in DynamoDB~~ (Resolved: KMS dual-layer encryption implemented in PR #13)

### Risks
- GitHub webhook retry storm if receiver Lambda is slow (mitigated by idempotency + immediate 200 return)
- OAuth token expiry during long-running Step Functions (mitigated by refresh-on-use pattern)
- WAF rule exclusions reduce protection surface (mitigated by signature verification as primary trust boundary)

## Future Work
- ~~Refactor comment handler into router + per-command downstream handlers~~ — Done (PR #13)
- ~~Add `commit_comment` and `pull_request_review_comment` event routing~~ — Done (PR #13)
- ~~Implement KMS envelope encryption for OAuth tokens at rest~~ — Done (PR #13)
- ~~Add health check metric on periodic ping events~~ — Done as scheduled Lambda (PR #19)
- ~~Webhook receiver JSON response format~~ — Done (PR #13)
- Delivery audit log with CloudWatch Logs Insights or dedicated archive
- ~~Device flow CLI tool in ops-tools package~~ — Done (PR #20)
- ~~Handler-level idempotency~~ — Done (PR #21)

## References
- [Design Spec](../docs/superpowers/specs/2026-04-26-ai3-mvp-design.md)
- [Plan A: Webhook Ingestion](../docs/superpowers/plans/2026-04-26-ai3-mvp-plan-a-webhook-ingestion.md)
- [Plan B: OAuth + Authorization](../docs/superpowers/plans/2026-04-26-ai3-mvp-plan-b-oauth-authorization.md)
- [Plan C: Orchestration](../docs/superpowers/plans/2026-04-26-ai3-mvp-plan-c-orchestration.md)
- [RISK_PROFILE.md](../RISK_PROFILE.md)
