# CLAUDE.md

@AGENTS.md

## Claude Code Configuration

### Recommended Plugins
- `superpowers` — brainstorming, writing-plans, subagent-driven-development, verification-before-completion
- `deploy-on-aws` — architecture diagrams, CDK best practices, pricing analysis
- `semgrep` — security scanning
- `remember` — session state handoff

### Recommended MCP Servers
- `github` — issue/PR management, code search
- `slack` — team notifications (when configured)
- `deploy-on-aws:awsiac` — CDK documentation, CloudFormation validation
- `deploy-on-aws:awsknowledge` — AWS service documentation
- `deploy-on-aws:awspricing` — cost estimation

### Workflow Preferences

- **TDD for new features** — write failing test first, implement, verify
- **Subagent-driven development** — dispatch parallel agents for independent tasks
- **Verification before completion** — always deploy + E2E test before claiming done
- **ADRs for decisions** — if it's a significant choice, document it in `adr/`
- **Issues for backlog** — P0/P1/P2 with effort, details sufficient for agent pickup
- **Memory for learnings** — store in project memory for cross-session persistence
- **Step-by-step for operator** — Scott sees ~30 terminal lines, prefer concise output

### Project-Specific Context

- **GitHub App:** `ai3-mvp` in `sbalswa` org
- **AWS Profile:** check `.remember/` or ask — may be `burner1` or `burner2`
- **Deploy pattern:** compile from `src/packages/app-framework`, deploy from `src/packages/app-framework-test-app`
- **OAuth tokens:** KMS-encrypted in DynamoDB, 8h TTL, auto-refresh via Secrets Manager
- **Idempotency:** Two layers (receiver 24h TTL + handler-level Jobs table)
- **Bot trigger:** `@ai3-mvp` or `/ai3-mvp` followed by command
