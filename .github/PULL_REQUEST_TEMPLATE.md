## Summary

Describe the user-visible change and its scope.

## Verification

- [ ] `bun install --frozen-lockfile`
- [ ] `bun run check`
- [ ] `bun run package:check`
- [ ] `git diff --check`

## Safety and compatibility

- [ ] No credentials, signed URLs, private repository URLs, real Agent/Run identifiers, or local absolute paths are included.
- [ ] No real paid Cloud Agent was created by tests or CI.
- [ ] Documentation and the skill are synchronized with the implementation.
- [ ] User-visible changes are listed under Unreleased in both CHANGELOG.md and CHANGELOG.zh-CN.md.
- [ ] Unknown outcomes, retries, output channels, and exit codes were considered.

## Remaining limitations

List unverified behavior, provider assumptions, migration notes, or follow-up work.
