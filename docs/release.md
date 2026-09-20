# Release and package policy

## Source repository

The canonical repository is intended to be:

<https://github.com/yoyooyooo/cursor-use>

The repository owner must create the remote, push the first fast-forward history,
and enable branch protection and private vulnerability reporting before making
public release claims. This workspace does not create the remote or push code.

## Versioning

Versions follow Semantic Versioning. User-visible behavior, CLI output changes,
security fixes and dependency changes belong in `CHANGELOG.md`. A release tag
must match the package version, for example `v0.2.1`.

## Package contents

`package.json` uses a `files` allowlist. A package contains only the built CLI,
the skill, public README files, the license, the changelog and
`THIRD_PARTY_NOTICES.md`. Source files, tests, local evidence, internal guides,
state databases and research notes are not package contents.

`prepack` expands workspace `catalog:` references to exact versions, then rebuilds
`dist/main.js`. `postpack` restores the source `package.json`. `bun run package:check`
runs the full local quality gate, packs to a temporary directory, asserts the
file allowlist and exact versions, and checks the built CLI version. The GitHub
tag workflow creates a package artifact but does not publish to npm automatically.

## Manual publication

After the repository is public and the package has passed the release checks:

```sh
bun pm whoami
bun run check
bun pm pack --dry-run
bun publish --access public
```

Publication requires an owner-authorized npm session. Never put an npm token in
this repository, GitHub Actions logs, an issue, or a prompt. After publication,
verify the exact version from a clean temporary consumer and record the package
URL and checksum in the release notes.

## Release claims

A passing local check proves only the local source and test scope. A public
release also needs a remote CI run, a reviewable tag, a package manifest review,
registry readback when published, and a clean-consumer smoke test.
