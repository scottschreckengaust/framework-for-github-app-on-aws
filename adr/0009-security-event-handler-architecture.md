# ADR-0009: Security Event Handler Architecture

- **Status:** Accepted
- **Date:** 2026-05-05
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

GitHub emits security and code quality events (`code_scanning_alert`, `secret_scanning_alert`, `dependabot_alert`, `security_advisory`) that currently fall through to the stub handler (logged only). We need dedicated handlers that take action — comment on PRs, create issues, block merges, and notify — based on severity. The system must be tool-agnostic, extensible, and configurable per-repository.

## Decision

### Three-Layer Architecture

1. **Per-type handler Lambdas** — each event type gets its own handler that parses its unique payload and normalizes into a shared `SecurityFinding` interface
2. **Shared action executor** — takes a `SecurityFinding` + resolved config, executes the appropriate actions
3. **Cascading config resolution** — per-repo `.github/ai3-mvp.json` overrides org-level config (DynamoDB) overrides app defaults (hardcoded)

### SecurityFinding Interface

All handlers normalize events into:

```typescript
interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  htmlUrl: string;
  repo: { owner: string; name: string };
  ref?: { pr?: number; commit?: string };
  tool?: string;
  alertNumber?: number;
  source: string; // handler name
}
```

### Action Types

Actions are composable via `+` delimiter in config:

| Action | What it does |
|--------|-------------|
| `block` | Fail a Check Run → prevents merge if check is required |
| `issue` | Create a GitHub Issue with finding details |
| `comment` | Post a comment on the relevant PR or commit |
| `notify` | Publish to SNS topic (Slack/email integration) |
| `annotate` | Create a Check Run annotation (inline code marker) |
| `ignore` | Log metric only, take no action |

Example config value: `"critical": "block+issue+notify"` executes all three.

### Default Severity-to-Action Mapping

| Severity | Default Actions |
|----------|----------------|
| `critical` | `block+issue+notify` |
| `high` | `comment+issue` |
| `medium` | `annotate` |
| `low` | `ignore` |

### Per-Repo Config (`.github/ai3-mvp.json`)

Repos can override defaults via a JSON file validated against a published JSON Schema:

```json
{
  "$schema": "https://raw.githubusercontent.com/scottschreckengaust/framework-for-github-app-on-aws/main/schemas/ai3-mvp-config.schema.json",
  "security": {
    "code_scanning": {
      "critical": "block+issue+notify",
      "high": "comment",
      "medium": "ignore"
    }
  }
}
```

### Config Resolution Order

```
repo (.github/ai3-mvp.json)  →  org (DynamoDB)  →  app defaults
```

Most specific wins. Resolution is cached (5-minute TTL) per repo to avoid excessive GitHub API calls. This resolution layer is designed for reuse beyond security handlers (Expo app, future features).

### Token Strategy

All security event handlers use **installation tokens only** (not user OAuth tokens). These are system-generated events with no human actor to attribute. The installation token is fetched via the existing `getInstallationToken()` pattern.

### Merge Blocking Strategy

The `block` action creates/updates a Check Run named `ai3-mvp/security` with status `failure`. Repos that want hard blocking must add this as a required status check in branch protection rules. This is opt-in — the handler creates the signal, repo admins decide enforcement.

## Alternatives Considered

### Single monolithic security handler
Rejected. Different event types have different payload structures and different severity sources. Separate handlers allow independent scaling, deployment, and error isolation.

### User OAuth tokens for actions
Rejected. Security events are system-generated (no user in the loop). Installation tokens have the correct permissions and avoid token-unavailable failures.

### YAML config instead of JSON
Rejected. JSON has native schema validation (JSON Schema + `$schema` for IDE support), no parser ambiguity (YAML's Norway problem), and aligns with TypeScript's JSON.parse at runtime.

### Hardcoded actions per handler (no config)
Rejected as the final state. We ship with sensible hardcoded defaults but design the interface to accept external config from day one. The config resolution layer slots in without handler changes.

## Consequences

### Positive
- Adding a new scanning tool (SARIF upload) requires zero handler code changes
- Adding a new event type requires only a new normalizer to `SecurityFinding`
- Per-repo customization is self-service (PR to add `.github/ai3-mvp.json`)
- Config resolution is reusable for non-security features
- JSON Schema provides IDE autocompletion for config authors

### Negative
- Four new Lambdas increase cold-start surface (mitigated: security events are low-frequency)
- Config resolution adds one GitHub API call per invocation (mitigated: 5-min cache)
- `block` action requires repo admins to configure required checks separately

### Risks
- Noisy repos (many medium findings) could generate excessive comments — mitigated by `ignore` and `annotate` being low-noise actions
- Config file could be deleted mid-processing — fall back to org/defaults gracefully
