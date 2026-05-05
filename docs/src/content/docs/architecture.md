---
title: Architecture Diagram
description: High-level system architecture for the Framework for GitHub Apps on AWS.
---

## System Architecture

The framework deploys a fully serverless architecture on AWS:

```
GitHub (Webhooks)
    |
    v
API Gateway + WAF (signature verification)
    |
    v
Receiver Lambda (idempotency check, S3 archive)
    |
    v
EventBridge Custom Bus
    |
    +---> Comment Handler Lambda (command router)
    +---> PR Handler Lambda
    +---> Push Handler Lambda
    +---> Check Run Handler Lambda
    +---> Deployment Handler Lambda
    +---> Discussion Handler Lambda
    +---> Security Event Handler Lambda
    +---> Alert Handler Lambda (DLQ processor)
    |
    v
Step Functions (Express workflow for CI checks)
    |
    v
GitHub API (Check Runs, Comments, Status)
```

## Key Components

| Component | AWS Service | Purpose |
|-----------|------------|---------|
| Webhook Endpoint | API Gateway + WAF | Receive and validate GitHub webhooks |
| Event Router | EventBridge | Fan-out events to appropriate handlers |
| Command Processor | Lambda | Parse and execute bot commands |
| CI Orchestration | Step Functions (Express) | Run CI check workflows |
| Token Storage | DynamoDB + KMS | Store encrypted OAuth/installation tokens |
| Payload Archive | S3 (90-day lifecycle) | Retain webhook payloads for debugging |
| Monitoring | CloudWatch | Dashboard, custom metrics, alarms |
| Dead Letter | SQS DLQ | Capture failed events for redrive |

## Architecture Diagram File

The full draw.io architecture diagram is available in the repository at [`docs/ai3-mvp-architecture.drawio`](https://github.com/scottschreckengaust/framework-for-github-app-on-aws/blob/main/docs/ai3-mvp-architecture.drawio).

You can open it with [draw.io](https://app.diagrams.net/) or the VS Code draw.io extension.

## Related ADRs

- [ADR-0001: Webhook, OAuth, and Orchestration Architecture](/framework-for-github-app-on-aws/adr/0001-ai3-mvp-webhook-oauth-orchestration/)
- [ADR-0003: WAF Body Rule Exclusions](/framework-for-github-app-on-aws/adr/0003-waf-body-rule-exclusions/)
- [ADR-0006: Per-Handler Idempotency](/framework-for-github-app-on-aws/adr/0006-per-handler-idempotency/)
- [ADR-0007: Express Step Functions for CI Checks](/framework-for-github-app-on-aws/adr/0007-express-step-functions-ci-checks/)
