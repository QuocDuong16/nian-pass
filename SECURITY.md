# Security policy

## Supported versions

Nian Pass is pre-1.0 security software. Only the most recent release and the
current `main` branch receive security fixes. Older builds should be considered
unsupported once a replacement release is published.

The supported product scope is Windows desktop, Linux desktop, Android, the
Chromium/Firefox browser extension and Native Messaging host, and the Linux
Sync Gateway. Apple runtime support is deferred and is not a supported security
surface.

## Reporting a vulnerability

Use the private vulnerability-reporting facility on the canonical Forgejo
repository at `https://git.niand.io.vn/coyote/nian-pass` when available. If a
private report cannot be created, contact the repository owner through a
private channel before sending exploit details. Do not open a public issue
containing credentials, vaults, tokens, private URLs, or an unpatched exploit.
If no private facility or known private contact is available, open only a
minimal public issue titled `Security contact request`, with no vulnerability
details, and ask the maintainer to establish a private channel.

Include the affected version/commit and platform, impact, reproducible steps,
whether a synthetic vault can reproduce the issue, and any proposed mitigation.
Never send a real KDBX vault, master password, provider credential, gateway
token, signing key, or production log containing private data.

Please allow maintainers to investigate and coordinate a fix before public
disclosure. The project does not promise a response or remediation SLA; scope,
severity, and safe release timing vary. Good-faith reports using synthetic data
are welcome.

## Security scope and limits

Nian Pass protects KDBX confidentiality and integrity within the boundaries in
[`docs/threat-model.md`](docs/threat-model.md). It cannot recover a forgotten
KDBX master password. A compromised user account, privileged administrator,
kernel, browser, clipboard manager/history service, injected WebView code, or
malicious gateway can exceed parts of the model. The gateway is opaque storage,
not a trusted history or backup service.
