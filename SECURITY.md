# Security Policy

## Reporting a vulnerability

Report suspected security vulnerabilities privately to [melih_dogann@outlook.com](mailto:melih_dogann@outlook.com), using the subject `WPA security report`.

Do not open a public issue or pull request containing exploit details, credentials, private presentations or another person's information. If GitHub offers **Report a vulnerability** on this repository's Security tab, that private channel may also be used. Email remains available independently of that repository setting.

Please include:

- The application version, operating system and installation source, or the commit for a development build.
- The affected feature and the conditions needed to trigger the issue.
- Clear reproduction steps or a minimal proof of concept using synthetic data.
- The security impact you observed and any suggested mitigation.
- Whether the issue has been disclosed elsewhere.

Use the initial message to describe the problem and coordinate the transfer of any sensitive evidence. Do not send actual API keys, access tokens, private recordings or confidential `.gpres` files. A `.gpres` file may contain presentation text and embedded media.

## Areas of particular interest

- Electron renderer, preload and main-process boundaries, including IPC authorization and local file access.
- Presentation, PowerPoint, archive and media import or export, including path traversal and malformed files.
- Local-resource URLs and access to media, saved presentations or credentials.
- Phone remote control, viewer sharing, WebSocket sessions and optional public tunnels.
- Google Drive sign-in, live-caption API credentials, music downloads and update delivery.
- Isolation between guided practice and the normal workspace.

Test only systems, accounts and content you control or are authorized to assess. Stop if testing would expose another person's information or interrupt a live service.

## Supported versions

Security fixes are normally made for the latest stable release. Older releases do not have a separately maintained backport schedule. Please report an issue even if you found it on an older version, and note whether you can reproduce it on the latest release.

## Handling and disclosure

The maintainer will assess the report, request missing details when needed and coordinate any fix and public disclosure. Response and resolution times depend on maintainer availability and the nature of the issue; no fixed service-level commitment is made.

Please coordinate publication of exploit details until users have had a reasonable opportunity to receive a fix. General troubleshooting and non-security defects belong in the [issue tracker](https://github.com/semiromest/Worship-Presentation-Assistant/issues); see [Support](SUPPORT.md).
