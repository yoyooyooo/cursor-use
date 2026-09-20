# Release and package policy

## Source repository

The canonical repository is:

<https://github.com/yoyooyooo/cursor-use>

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
file allowlist and exact versions, and checks the built CLI version.

## First publish and trusted publishing

npm Trusted Publishing can only be configured after the package exists on the
registry. Do not publish a dummy `0.0.0`. The first version is the real `0.2.1`.

1. `0.2.1` was the bootstrap publish from a local npm web-auth session. That
   directory `npm publish` packed `catalog:` into the registry manifest.
2. Trusted Publisher is configured on
   <https://www.npmjs.com/package/cursor-use/access>:
   - Organization or user: `yoyooyooo`
   - Repository: `cursor-use`
   - Workflow filename: `release.yml`
   - Environment: empty
   - Allowed actions: `npm publish`
3. Later versions are published by pushing a matching tag, for example `v0.2.2`.
   The tag workflow packs with Bun into `release/`, then publishes that tarball
   with `npm publish`. Leave `NODE_AUTH_TOKEN` unset so npm uses OIDC. Do not
   store an npm token in GitHub Actions. Do not run directory `npm publish` for
   later versions.

`bun publish` is not the trusted-publishing path.

Never put an npm token in this repository, GitHub Actions logs, an issue, or a
prompt. After publication, verify the exact version from a clean temporary
consumer and record the package URL.

## Release claims

A passing local check proves only the local source and test scope. A public
release also needs a remote CI run, a reviewable tag, a package manifest review,
registry readback when published, and a clean-consumer smoke test.
