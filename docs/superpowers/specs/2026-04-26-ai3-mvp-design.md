# ai3-mvp Design Spec

## Overview

ai3-mvp is a GitHub App bot for the `sbalswa` organization built on top of the existing Credential Manager framework. It reacts to all GitHub webhook events, authorizes users via OAuth, and orchestrates long-running CI/CD workflows through AWS Step Functions.

## 1. Webhook Ingestion

GitHub sends webhook POSTs to an API Gateway endpoint (with WAF and throttling enabled). A Webhook Lambda verifies the `X-Hub-Signature-256` using the app's webhook secret (retrieved from AWS Secrets Manager, cached for the Lambda execution lifetime). Invalid signatures return 401. Valid events are put onto an EventBridge custom bus with `source=github` and `detail-type` set to the GitHub event type (e.g., `issue_comment`, `pull_request`, `push`, `repository`, `star`). The Lambda returns 200 immediately after the EventBridge put to avoid GitHub retries causing duplicates.

EventBridge rules match on `detail-type` and route to handler Lambdas. New handlers can be added by creating a new rule + Lambda without modifying existing code.

## 2. User Authorization

Every handler Lambda runs a shared authorization module before executing any action:

1. Extract `sender.login` from the webhook payload.
2. Call GitHub API to verify user is a member of the `sbalswa` org.
3. Check user has write permission on the event's repository.
4. Look up user's OAuth token in the UserTokens DynamoDB table by GitHub user ID.
5. If no token found, the bot comments on the issue/PR with a one-time auth link pointing to the OAuth login endpoint.
6. If token found but expired, use the refresh token to obtain a new access token, store it, and proceed.
7. If all checks pass, execute the action using the user's `ghu_` token.

All actions are performed using the user's token — the bot never acts under its own installation token for user-initiated operations. This provides full audit trail attribution in GitHub.

## 3. OAuth Flow

API Gateway exposes two routes for the OAuth flow:

**`GET /auth/login`** — Generates a random state nonce, stores it in the AuthState DynamoDB table (TTL 10 minutes) along with context about where the user came from (repo, issue number), and redirects to GitHub's OAuth authorization URL with the state parameter.

**`GET /auth/callback`** — Receives the authorization code from GitHub, validates the state nonce against AuthState (preventing CSRF), exchanges the code for a `ghu_` access token and refresh token, encrypts both using the UserTokens table's customer-managed KMS key, stores them in the UserTokens table keyed by GitHub user ID, and returns a simple "you're authorized" HTML page.

The GitHub App registration must have its Callback URL set to the API Gateway callback endpoint. Refresh tokens are rotated on each use per GitHub's token rotation policy.

## 4. Orchestration and Reporting

When a handler needs to run a long-running job (CI check, deployment, multi-step workflow):

1. Handler starts a Step Functions execution, passing the user's OAuth token, repo info, and job definition.
2. **Express workflows** for jobs under 5 minutes (build, lint, simple checks).
3. **Standard workflows** for longer DAG-style executions (multi-stage deployments, complex CI pipelines).
4. Step Functions steps create and update GitHub Check Runs with progress (for CI/CD workflows).
5. For user-initiated commands (slash commands in comments), the handler posts an initial "working on it" comment, then edits it on completion or failure.

A **Jobs DynamoDB table** tracks all executions: Step Functions execution ARN, status, GitHub check run ID, requesting user, repo, timestamps, and error details. This enables the bot to answer "what's running?" queries.

Failed steps trigger a DLQ. An alert Lambda processes DLQ messages and posts failure comments or Check Run failure statuses.

## 5. Data Model

Three new DynamoDB tables alongside the existing App and Installation tables:

### UserTokens Table
- **PK**: `GitHubUserId` (number)
- **Fields**: login, encrypted access token, encrypted refresh token, token expiry, scopes granted, last used timestamp
- **Encryption**: Customer-managed KMS key on the table
- **TTL**: On rows where user revokes access

### AuthState Table
- **PK**: `StateNonce` (string)
- **Fields**: GitHub login (from the triggering comment), redirect context (repo/issue to return to)
- **TTL**: 10 minutes
- **Purpose**: CSRF prevention on OAuth callback

### Jobs Table
- **PK**: `JobId` (ULID)
- **GSI 1**: `RepoFullName + Status` — for "what's running in this repo?" queries
- **GSI 2**: `UserId + CreatedAt` — for "my jobs" queries
- **Fields**: Step Functions execution ARN, status, GitHub check run ID, requesting user, repo, created/updated timestamps, error detail

## 6. Error Handling and Observability

### Idempotency
Each handler uses the webhook `delivery` GUID as a deduplication key via a DynamoDB condition expression. Duplicate deliveries are silently dropped.

### Failure Handling
- Failed EventBridge deliveries go to a DLQ (SQS).
- Failed Step Functions steps retry 2x with exponential backoff, then transition to a failure state that posts a Check Run failure or error comment.
- OAuth token refresh failures trigger a re-auth prompt to the user.

### Observability
- All Lambdas use X-Ray tracing (matching the existing framework pattern).
- Structured JSON logging from all Lambdas.
- CloudWatch alarms on: DLQ depth > 0, OAuth token refresh failures, webhook signature validation failures.
- A single CloudWatch dashboard covers the full pipeline: webhook ingestion rate, auth success/failure, handler invocations, Step Functions executions, and DLQ depth.

## 7. Infrastructure Summary

| Component | AWS Service |
|-----------|-------------|
| Webhook endpoint | API Gateway + WAF |
| Webhook validation | Lambda |
| Event routing | EventBridge custom bus |
| Event handlers | Lambda (one per event category) |
| User auth (OAuth) | API Gateway + Lambda (login + callback) |
| Token storage | DynamoDB + customer-managed KMS |
| Auth state (CSRF) | DynamoDB with TTL |
| Orchestration | Step Functions (Express + Standard) |
| Job tracking | DynamoDB |
| Failure handling | SQS DLQ + alert Lambda |
| Monitoring | CloudWatch dashboard + alarms + X-Ray |
| GitHub App auth | Existing Credential Manager (unchanged) |

## 8. Security Properties

- Webhook signatures verified on every request using HMAC-SHA256.
- All user actions performed with the user's own OAuth token — full GitHub audit trail.
- OAuth state nonce prevents CSRF attacks on the callback.
- Tokens encrypted at rest via customer-managed KMS key.
- Refresh tokens rotated on each use.
- Authorization checks: org membership AND repo write access required.
- API Gateway provides WAF protection and request throttling on the public endpoint.
- No secrets in environment variables — webhook secret stored in Secrets Manager, referenced at runtime.

## 9. GitHub App Configuration Changes

The existing `ai3-mvp` app registration needs:
- **Webhook URL**: Set to the API Gateway webhook endpoint
- **Webhook secret**: Generate a strong secret, store in AWS Secrets Manager
- **Callback URL**: Set to the API Gateway `/auth/callback` endpoint
- **Permissions**: Add `checks: write`, `pull_requests: write`, `issues: write`, `members: read`, `statuses: write` (in addition to existing `contents: read`)
- **Events**: Subscribe to all needed event types (issue_comment, pull_request, push, repository, star, check_run, deployment, etc.)
