# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately:

1. **Do NOT** open a public GitHub issue
2. Use [GitHub Security Advisories](https://github.com/scottschreckengaust/framework-for-github-app-on-aws/security/advisories/new) to report privately
3. Include: description, reproduction steps, impact assessment, and suggested fix if possible

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix timeline:** Based on severity (P0: immediate, P1: 1 week, P2: next sprint)

## Supported Versions

| Version | Supported |
|---------|-----------|
| main branch | Yes |
| Feature branches | Best effort |

## Security Architecture

See [RISK_PROFILE.md](RISK_PROFILE.md) and [ADR-0001](adr/0001-ai3-mvp-webhook-oauth-orchestration.md) for security design decisions.

Key protections:
- Webhook HMAC-SHA256 signature verification
- KMS dual-layer token encryption
- OAuth with CSRF protection
- WAF rate limiting
- Per-handler idempotency
- Least-privilege IAM roles
