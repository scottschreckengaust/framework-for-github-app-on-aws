# AGENTS.md

## Project

Framework for GitHub Apps on AWS — a serverless bot platform that receives GitHub webhook events, authenticates users via OAuth, and orchestrates workflows via Step Functions.

## Stack

- **Language:** TypeScript
- **Build:** Projen (manages project config, linting, packaging)
- **IaC:** AWS CDK (TypeScript)
- **Runtime:** Node.js 22 (Lambda)
- **Packages:** Monorepo with Lerna (`src/packages/`)
- **Testing:** Jest (unit), CDK deploy + manual E2E
- **Linting:** ESLint (legacy config via `.eslintrc.json`, managed by Projen)

## Structure

```
src/packages/
├── app-framework/          # Core library: CredentialManager + WebhookIngestion CDK constructs
├── app-framework-test-app/ # CDK app that deploys everything for testing
├── app-framework-ops-tools/ # CLI tools (import-private-key, redrive, device-flow-auth)
└── smithy/                 # API model definitions (generates client + server SDKs)

adr/                        # Architecture Decision Records (0001-0008)
docs/runbooks/              # Operational runbooks (monitoring, recovery, auth, redrive)
```

## Commands

```bash
yarn install              # Install deps
npx projen build          # Full build (compile + test + lint + package)
npx projen                # Regenerate config from .projenrc.ts (REQUIRED after editing .projenrc.ts)

# Deploy (from src/packages/app-framework-test-app/)
npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=<ARN> \
  --context gitHubClientId=<ID> \
  --context oauthClientSecretArn=<ARN>

# Run specific tests
cd src/packages/app-framework && npx jest --testPathPattern=<pattern>
```

## Workflow Preferences

- **TDD for new features** — write failing test first, implement, verify
- **Subagent-driven development** — dispatch parallel agents for independent tasks
- **Verification before completion** — always deploy + E2E test before claiming done
- **ADRs for decisions** — if it's a significant choice, document it in `adr/`
- **Issues for backlog** — P0/P1/P2 with effort, details sufficient for agent pickup

## Conventions

- **Config is managed by Projen.** Never edit `.eslintrc.json`, `package.json`, `tsconfig.json` directly. Edit `.projenrc.ts` then run `npx projen`.
- **SDK deps need both `deps` AND `bundledDeps`** in `.projenrc.ts` for the app-framework package.
- **Lambda handlers use auto-discovery.** `NodejsFunction(this, 'handler', {...})` in `foo.ts` finds `foo.handler.ts` in the same directory.
- **External AWS SDK for Lambda runtime.** Packages like `@aws-sdk/client-s3` and `@aws-sdk/client-lambda` are excluded from esbuild bundling (Lambda runtime provides them). Add as `devDeps` in `.projenrc.ts`.
- **ADRs document decisions.** Create a new `adr/NNNN-*.md` for significant architectural choices.
- **Runbooks for ops.** Add to `docs/runbooks/` for operational procedures.
- **GitHub Issues for backlog.** P0/P1/P2 priority labels, effort estimates in body.

## Testing Requirements

- Unit tests MUST pass before committing: `npx projen build`
- TypeScript MUST compile: `npx tsc --noEmit` (from app-framework dir)
- Deploy and E2E test before declaring features complete
- Bot must respond to commands after deploy (`@ai3-mvp help`)

## Adding New Features

### New bot command:
1. Create `src/packages/app-framework/src/webhook/handlers/commands/<name>.ts`
2. Register in `commands/index.ts`
3. Update `commands/help.ts`

### New event handler:
1. Create `handlers/<name>Handler.handler.ts` + `handlers/<name>Handler.ts` (CDK construct)
2. Add EventBridge rule in `webhook/index.ts`
3. Pass `jobsTableName` for idempotency

### New CDK construct prop:
1. Add to `WebhookIngestionProps` in `webhook/index.ts`
2. Pass in test-app `main.ts`
3. Deploy with new `--context` param

## Git Worktree Discipline

The main worktree MUST stay on `main`. All branch work happens in dedicated worktrees.

### Rules
1. **Main worktree = `main` only.** Never `git checkout <feature-branch>` in the main worktree.
2. **Create worktrees for branch work:** `git worktree add .claude/worktrees/<name> <branch>`
3. **Always `cd` to the worktree** before running git commands for that branch.
4. **Never `git add -A`** — always add specific files. `-A` picks up nested worktrees as submodules.
5. **Clean up after merge:** `git worktree remove .claude/worktrees/<name>` immediately.
6. **Subagents with `isolation: "worktree"`** get automatic worktrees — don't create duplicates.
7. **After subagent completes:** unlock + remove its worktree before doing manual branch work.

### Common failures this prevents
- Dirty state leaking between branches
- `.claude/worktrees/*` committed as git submodules
- `fatal: branch already used by worktree`
- CWD confusion (running commands in wrong directory)
- Stale changes persisting across checkout

## Pre-Push Checklist (Projen Mutation Prevention)

CI has a "Find mutations" step that fails if committed files differ from what `npx projen` generates. This costs 18+ minutes per failed run.

### Before EVERY push:
1. `npx projen` — regenerate all config files
2. `git diff` — review what projen changed
3. `git add` the changed files (tasks.json, package.json, etc.)
4. `npx projen build` — full local build to catch test/lint/synth failures
5. Only push when build exits 0

### Why this matters
- Projen reformats `.projenrc.ts` (e.g., multi-line → single-line)
- Projen regenerates `tasks.json`, `package.json`, `tsconfig` on every run
- If you commit `.projenrc.ts` without regenerating, CI detects the drift and fails
- Manual formatting that differs from Projen's output causes mutation failures

### Rule
**Never push without running `npx projen` first.** If you edited `.projenrc.ts`, the regenerated files ARE part of your commit.

## Known Gotchas

- `mwinit` required before AWS operations (credentials expire)
- ESLint `quote-props: consistent-as-needed` conflicts with Prettier on hyphenated keys — use `// prettier-ignore`
- `@aws-sdk/client-*` versions must be pinned to 3.777.0 to avoid `@smithy/types` conflicts with `aws-sdk-client-mock`
- WAF body-inspection rules MUST be excluded for webhook endpoints (see ADR-0003)
- Express Step Functions logs are in CloudWatch, not the console
- EventBridge delivers to ALL matching rules — per-handler idempotency keys prevent conflicts (ADR-0006)
