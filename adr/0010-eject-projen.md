# ADR 0010: Eject Projen and Migrate to Direct Toolchain Ownership

## Status

Accepted

## Context

This project is a TypeScript-only serverless framework for GitHub Apps on AWS.
We adopted projen early to generate project configuration (package.json,
tsconfig, eslint, CI workflows). Over time, the costs have outweighed the
benefits:

1. **jsii overhead without value.** jsii exists to produce polyglot bindings
   (Python, Java, .NET). This project ships TypeScript-only NPM packages. jsii
   adds compilation time, restricts TypeScript features, and complicates
   dependency management.

2. **Mutation checks slow iteration.** Projen's CI "Find mutations" step adds
   18+ minutes per failed run. Every config change requires remembering to
   regenerate files. Agents and humans repeatedly trip over this.

3. **Indirect config ownership.** All config lives in `.projenrc.ts`. Editing
   ESLint rules, jest config, or scripts requires learning projen's abstraction
   layer rather than editing the config directly.

4. **Agent-first workflow friction.** Autonomous agents need predictable
   toolchains. Projen's indirection (edit A to change B, remember to regenerate)
   creates failure modes that waste agent cycles.

5. **ESLint 9 migration blocked.** Projen's eslint integration generates legacy
   `.eslintrc.json`. Migrating to ESLint 9 flat config requires ejecting from
   projen's eslint management anyway.

## Decision

Eject projen. Own all configuration files directly. Replace jsii with tsc.
Migrate to ESLint 9 flat config. Use standard npm scripts for the build
pipeline.

Toolchain after ejection:
- **Compilation:** `tsc` (with `--declaration` for library consumers)
- **Linting:** ESLint 9 flat config (`eslint.config.mjs`)
- **Testing:** Jest (unchanged)
- **IaC:** AWS CDK CLI (unchanged)
- **Monorepo:** Lerna + Yarn workspaces (unchanged)
- **CI:** GitHub Actions with direct `yarn build` (no mutation check)

## Consequences

### Positive
- Direct ownership of all config — edit the file, commit the change, done
- Faster CI — no mutation check, no jsii compilation overhead
- ESLint 9 flat config unlocks modern linting ecosystem
- Simpler onboarding — standard TypeScript project, no projen knowledge required
- Agents can modify config directly without regeneration step
- Full TypeScript feature set available (no jsii restrictions)

### Negative
- Config drift is now the developer's responsibility (but this is trivial for a
  small team with agents)
- Lose projen's dependency upgrade automation (can use Dependabot or Renovate)
- One-time migration effort to verify all tests still pass

### Neutral
- Release workflow unchanged (it already uses standard npm pack/publish)
- CDK constructs still work — CDK doesn't require jsii for TypeScript consumers
- Bundled dependencies pattern unchanged
