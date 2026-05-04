# ADR-0005: Command Router Pattern

- **Status:** Accepted
- **Date:** 2026-04-28
- **Decision makers:** Scott Schreckengaust

## Context and Problem Statement

Comment handler was growing into a monolith as commands were added. Each new feature would add more logic to a single function, making it harder to test and maintain.

## Decision

Commands registered in a map (`Record<string, CommandHandler>`). Comment handler becomes a router: parse trigger, extract command name + args, look up handler, dispatch. New commands require only creating a file and adding to the registry. Unknown commands show help.

## Consequences

### Positive
- Each command is isolated, testable, and composable
- Adding commands requires no changes to existing code
- Unknown commands surface available options via help

### Negative
- None significant. Extra file per command is a feature, not a cost.

## References
- PR #13
- Issue #4
