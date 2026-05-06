## Summary
<!-- Brief description of what this PR does -->

## Issue
<!-- Closes #XX -->

## Changes
<!-- List key changes -->

## Agentic Workflow
- [ ] GitHub issue created/referenced before work began
- [ ] Work done in dedicated worktree (not main)
- [ ] No `.claude/worktrees/*` entries in staged files
- [ ] `npx projen` run and all generated files committed

## Testing
- [ ] Unit tests pass (`npx projen build`)
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Deployed to test stack
- [ ] E2E verified:
  - [ ] `@ai3-mvp help` responds
  - [ ] New feature works as described
  - [ ] No regressions in existing features

## Bot Commands Verified
- [ ] `@ai3-mvp help` — lists commands
- [ ] `@ai3-mvp echo <text>` — echoes back
- [ ] `@ai3-mvp check <sha>` — creates Check Run
- [ ] Health check passing (CloudWatch dashboard)
- [ ] No DLQ messages

## Documentation
- [ ] ADR created (if architectural decision)
- [ ] Runbook updated (if ops procedure changed)
- [ ] QUICK_START.md updated (if user-facing change)
- [ ] Help text updated (if new command)
