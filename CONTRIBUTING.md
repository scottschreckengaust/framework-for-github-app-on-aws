# Contributing to ai3-mvp

## Quick Links

- [QUICK_START.md](QUICK_START.md) — Deploy guide
- [AGENTS.md](AGENTS.md) — Agent workflow conventions
- [ADRs](adr/) — Architecture decisions

## Development Workflow

1. Create a branch from `main` (use prefix: `issues/<number>`, `fix/<description>`, `feat/<description>`)
2. Make changes following conventions in [AGENTS.md](AGENTS.md)
3. Ensure `npx projen build` passes
4. Open a PR using the appropriate [template](.github/PULL_REQUEST_TEMPLATE/)
5. Deploy and E2E test before requesting review
6. All bot commands must still respond after deploy

## PR Templates

Use the URL query param to select a template:
- Feature: `?template=feature.md`
- Bug fix: `?template=bugfix.md`
- Documentation: `?template=docs.md`
- Disaster Recovery: `?template=disaster-recovery-testing.md`

---

## Reporting Bugs / Feature Requests

Use the [issue templates](https://github.com/scottschreckengaust/framework-for-github-app-on-aws/issues/new/choose). Check existing issues first to avoid duplicates. Include reproduction steps, environment details, and expected vs actual behavior.

## Finding Work

Look for issues labeled `help wanted`. Issues are prioritized P0/P1/P2 with effort estimates in the body.

## Large Changes

Open an issue for discussion before submitting PRs that add new constructs, change APIs, or modify architecture. This avoids wasted effort.

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security Issues

If you discover a potential security issue, do **not** create a public GitHub issue. See [SECURITY.md](SECURITY.md) for reporting instructions.

## License

This project is [Apache-2.0](LICENSE) licensed.
