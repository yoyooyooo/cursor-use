# Security Policy

## Supported versions

Security fixes are provided for the latest published version and the current
`main` branch. Older versions may remain vulnerable because the Cursor Cloud
Agents API and Bun runtime can change independently of this project.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting form:

<https://github.com/yoyooyooo/cursor-use/security/advisories/new>

Include the affected version or commit, reproduction steps, impact, and any
safe mitigation. Do not include `CURSOR_API_KEY`, private repository URLs,
request payloads containing sensitive data, signed artifact URLs, or local
state databases. Redact those values before sending a report.

If private vulnerability reporting is unavailable, open a minimal issue asking
for a private channel without disclosing the vulnerability details.

## Response expectations

The maintainer will acknowledge a report within seven days when the channel is
available, investigate the report, and coordinate a fix or mitigation before
public disclosure where practical. There is no guarantee of a particular
release timeline.
