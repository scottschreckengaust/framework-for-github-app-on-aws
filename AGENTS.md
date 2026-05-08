# AGENTS.md

## Agentic Workflow: Issue-First, Worktree-Isolated, Agent-Dispatched

**Every change follows this sequence. No exceptions.**

```
main (clean) → Issue → Worktree → Subagent → Build+Test → Push → Draft PR → CI Green → Ready → Notify
```

The main context is the **orchestrator**. It coordinates, dispatches, and monitors. It does NOT write implementation code directly.

1. **Main stays clean.** Never checkout a branch in the main worktree. Pull latest before starting.
2. **Issue first.** Every non-trivial change starts with a GitHub issue. This is the async coordination signal — other agents and humans see intent before action.
3. **Worktree created.** Create `git worktree add .claude/worktrees/<name> issues/<number>-<slug>` from the main worktree.
4. **Subagent dispatched.** The main context dispatches a subagent to the worktree with clear instructions: what to implement, which files to touch, and what "done" looks like. The subagent implements, runs `yarn build`, commits specific files, and pushes.
5. **Draft PR.** The subagent (or main context) creates a draft PR referencing the issue. PR title must use allowed types: `feat:`, `fix:`, or `chore:`.
6. **CI green.** Wait for all workflow checks to pass. If failures occur, dispatch the subagent again to fix in the same worktree.
7. **Mark ready.** Once CI is green, mark the PR ready for review (`gh pr ready`).
8. **Notify.** Inform the operator that the PR is ready for review with a link.
9. **Cleanup.** After merge: `git worktree remove` + `git branch -d` + `git pull origin main`. Do this immediately.

**If you're about to write code and haven't done steps 1-4, stop. You are the orchestrator, not the implementer.**

## Project

Framework for GitHub Apps on AWS — a serverless bot platform that receives GitHub webhook events, authenticates users via OAuth, and orchestrates workflows via Step Functions.

## Stack

- **Language:** TypeScript
- **Build:** tsc + ESLint 9 flat config + Jest (direct toolchain, no projen)
- **IaC:** AWS CDK (TypeScript)
- **Runtime:** Node.js 22 (Lambda)
- **Packages:** Monorepo with Lerna (`src/packages/`)
- **Testing:** Jest (unit), CDK deploy + manual E2E
- **Linting:** ESLint 9 flat config (`eslint.config.mjs` per package)

## Structure

```
src/packages/
├── app-framework/          # Core library: CredentialManager + WebhookIngestion CDK constructs
├── app-framework-test-app/ # CDK app that deploys everything for testing
├── app-framework-ops-tools/ # CLI tools (import-private-key, redrive, device-flow-auth)
└── smithy/                 # API model definitions (generates client + server SDKs)

adr/                        # Architecture Decision Records (0001-0010)
docs/runbooks/              # Operational runbooks (monitoring, recovery, auth, redrive)
```

## Commands

```bash
yarn install              # Install deps
yarn build                # Full build (compile + test + lint for all packages)

# Per-package commands (from package dir):
yarn compile              # TypeScript compilation only
yarn test                 # Run tests
yarn lint                 # Run ESLint

# Deploy (from src/packages/app-framework-test-app/)
npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=<ARN> \
  --context gitHubClientId=<ID> \
  --context oauthClientSecretArn=<ARN>
# See docs/runbooks/deploy.md for current context values.

# Run specific tests
cd src/packages/app-framework && npx jest --testPathPattern=<pattern>
```

## Workflow Preferences

- **TDD for new features** — write failing test first, implement, verify
- **Subagent-driven development** — dispatch parallel agents for independent tasks
- **Verification before completion** — always deploy + E2E test before claiming done
- **ADRs for decisions** — if it's a significant choice, document it in `adr/`
- **Issues for backlog** — P0/P1/P2 with effort, details sufficient for agent pickup
- **PR titles** — must use `feat:`, `fix:`, or `chore:` prefix (enforced by PR lint)

## Conventions

- **Config is owned directly.** Edit `package.json`, `tsconfig.json`, `eslint.config.mjs` directly. No code generation step.
- **SDK deps need both `dependencies` AND `bundledDependencies`** in `src/packages/app-framework/package.json`.
- **Lambda handlers use auto-discovery.** `NodejsFunction(this, 'handler', {...})` in `foo.ts` finds `foo.handler.ts` in the same directory.
- **External AWS SDK for Lambda runtime.** Packages like `@aws-sdk/client-s3` and `@aws-sdk/client-lambda` are excluded from esbuild bundling (Lambda runtime provides them). Add as `devDependencies`.
- **ADRs document decisions.** Create a new `adr/NNNN-*.md` for significant architectural choices.
- **Runbooks for ops.** Add to `docs/runbooks/` for operational procedures.
- **GitHub Issues for backlog.** P0/P1/P2 priority labels, effort estimates in body.

## Testing Requirements

- Unit tests MUST pass before committing: `yarn build` (from root)
- TypeScript MUST compile: `yarn compile` (from package dir)
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

### Creating a worktree

```bash
# From the main worktree:
git pull origin main
git branch issues/<number>-<slug>
git worktree add .claude/worktrees/<name> issues/<number>-<slug>
cd .claude/worktrees/<name>
```

### Rules
1. **Main worktree = `main` only.** Never `git checkout <feature-branch>` in the main worktree.
2. **Always `cd` to the worktree** before running git commands for that branch.
3. **Never `git add -A`** — always add specific files. `-A` picks up nested worktrees as submodules.
4. **Subagents with `isolation: "worktree"`** get automatic worktrees — don't create duplicates.
5. **After subagent completes:** unlock + remove its worktree before doing manual branch work.

### Cleanup after merge

```bash
# From the main worktree:
git worktree remove .claude/worktrees/<name>
git branch -d issues/<number>-<slug>
git pull origin main
```

Do this immediately after merge. Do NOT leave stale worktrees around.

### Bulk cleanup (stale worktrees)

```bash
git worktree list                                    # identify non-main worktrees
git -C .claude/worktrees/<name> status --short       # must be empty
gh pr list --state merged --head <branch-name>       # PR must be merged
git worktree remove .claude/worktrees/<name>         # remove
git branch -d <branch-name>                          # delete local branch
```

### Common failures this prevents
- Dirty state leaking between branches
- `.claude/worktrees/*` committed as git submodules (mode 160000)
- `fatal: branch already used by worktree`
- CWD confusion (running commands in wrong directory)
- Stale changes persisting across checkout

## Known Gotchas

- `mwinit` required before AWS operations (credentials expire)
- ESLint `quote-props: consistent-as-needed` conflicts with Prettier on hyphenated keys — use `// prettier-ignore`
- `@aws-sdk/client-*` versions must be pinned to 3.777.0 to avoid `@smithy/types` conflicts with `aws-sdk-client-mock`
- WAF body-inspection rules MUST be excluded for webhook endpoints (see ADR-0003)
- Express Step Functions logs are in CloudWatch, not the console
- EventBridge delivers to ALL matching rules — per-handler idempotency keys prevent conflicts (ADR-0006)
