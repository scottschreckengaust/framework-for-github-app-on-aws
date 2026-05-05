# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately:

1. **Do NOT** open a public GitHub issue
2. Email the maintainer directly or open a private issue (contact info in CODEOWNERS)
3. Include: description, reproduction steps, impact assessment, and suggested fix if possible

## Response

This is a maintainer-supported project. Responses are best-effort — there are no guaranteed SLAs. Critical issues (credential leaks, RCE) will be prioritized.

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
