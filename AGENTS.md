# cursor-use Agent Guide

## Knowledge map

- [Documentation map](docs/README.md): entry points for product, protocol, architecture, verification and release policy.
- [Product scope](docs/product/scope.md): goals, boundaries, security requirements and acceptance.
- [Domain model](docs/ssot/domain-model.md): Agent, Run, environment, Project and state semantics.
- [Architecture](docs/architecture/current-architecture.md): the implementation that exists today.
- [CLI contract](docs/protocols/cli.md), [request recovery](docs/runbook/request-recovery.md) and [skill](skills/cursor-use/SKILL.md): current caller-facing behavior.
- [Release policy](docs/release.md): package contents, versioning and external release gates.
- [Contributing guide](CONTRIBUTING.md): contributor workflow and safety requirements.

## Working commands

Run commands from the repository root and use `package.json` as the source of truth.

| Situation | Command |
| --- | --- |
| Inspect worktree | `git status --short` |
| Frozen install | `bun install --frozen-lockfile` |
| Source, dependency or test change | `bun run check` |
| Package and clean CLI check | `bun run package:check` |
| Source CLI help | `bun run dev --help` |
| Format and whitespace check | `git diff --check` |

## Repository constraints

- Use Bun and TypeScript with the exact versions in the catalog. Consumers use `catalog:` references.
- Keep the official Cloud API boundary. Do not add desktop CDP, `cursor-agent`, login-state extraction, arbitrary proxy URLs, private APIs or unsupported native Projects behavior.
- Do not commit credentials, signed URLs, private repository URLs, real Agent/Run identifiers, local absolute paths or local SQLite state.
- Paid POST operations require a persisted intent. Unknown outcomes must not be retried automatically.
- Business success goes to stdout; failures go to stderr with a non-zero exit code.
- Update the owning documentation, tests and skill entry when a public behavior changes.
- Do not create merge commits. Remote creation, pushing and package publication are owner-authorized release actions, not local test steps.
