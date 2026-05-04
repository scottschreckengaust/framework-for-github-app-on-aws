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

## Known Gotchas

- `mwinit` required before AWS operations (credentials expire)
- ESLint `quote-props: consistent-as-needed` conflicts with Prettier on hyphenated keys — use `// prettier-ignore`
- `@aws-sdk/client-*` versions must be pinned to 3.777.0 to avoid `@smithy/types` conflicts with `aws-sdk-client-mock`
- WAF body-inspection rules MUST be excluded for webhook endpoints (see ADR-0003)
- Express Step Functions logs are in CloudWatch, not the console
- EventBridge delivers to ALL matching rules — per-handler idempotency keys prevent conflicts (ADR-0006)
