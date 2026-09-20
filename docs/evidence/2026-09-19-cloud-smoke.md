# 2026-09-19 Cloud acceptance snapshot

This is a redacted public summary of the first Cloud Agent validation. Raw stdout,
receipts and account-specific identifiers remain outside the repository. The
summary is historical evidence, not a guarantee for every account or provider
version.

## Scope

- Bun 1.4.2 and the Effect 4 beta line used by the project at the time.
- Official Cursor Cloud Agents v1 API through this CLI.
- No desktop login state, browser cookies or private session database.
- No code changes, repository push, pull request or automatic merge in the task.

## Observed behavior

| Check | Result |
| --- | --- |
| identity and model discovery | Verified for the test account |
| cloud environment launch | One configured environment succeeded; one unavailable name was rejected |
| follow-up | A new Run was created on the same Agent |
| repeated request ID | Existing receipt was replayed without another create POST |
| bounded environment observation | Response exposed incomplete and more-results state |
| artifact list | Read successfully; this snapshot had no downloadable artifact |
| usage | Provider returned usage and cost information |
| cancellation | The initial attempt did not prove cancellation; later versions have separate cancellation evidence |

All identifiers, URLs and account inventory counts are intentionally omitted from
this public summary. The private evidence is not required to build or test the
project.

## Local verification

The then-current source and built CLI passed type checking, build, subprocess
output checks, receipt recovery tests and documentation checks. The test suite
used fake providers and did not treat a local pass as proof of a remote CI run.

## Limits

The snapshot does not prove native Projects management, complete environment
inventory, cross-host skill discovery, automatic PR behavior or future provider
compatibility. Current behavior is defined by the [CLI contract](../protocols/cli.md)
and [product scope](../product/scope.md).
