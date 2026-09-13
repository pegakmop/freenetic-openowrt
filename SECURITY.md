# Security policy

## Supported versions

Security fixes are developed on the `testing` branch first and are released
to the shared `0.2.x` service line after verification. The stable and legacy
OpenWrt release lines use the same Freenetic source, but their package formats
are different:

- `v0.2.x-Stable.25.12.x` — OpenWrt 25.12.x / APK;
- `v0.2.x-Legacy.24.10.x` — OpenWrt 24.10.x / IPK and `opkg`.

The current stable patch release is the version shown in the repository
release list. Older releases may be useful for reproducing a problem, but
should be upgraded before deployment.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not put credentials, private keys, configuration backups or an exploitable
proof of concept in a public issue.

Include, when safe to share:

- the Freenetic release and OpenWrt version;
- target/subtarget and device model;
- the affected page, helper or command;
- a minimal reproduction with secrets removed;
- whether the issue survives a fresh install or only an upgrade.

The most important reports are arbitrary command execution, ACL escalation,
secret disclosure, unsafe firmware/package update behavior, and destructive
changes to UCI sections that Freenetic did not create.

We will acknowledge a private report as soon as practical, reproduce it on a
supported profile, and coordinate a fix and release before public disclosure.

## Security boundaries

Freenetic is a LuCI layer over OpenWrt. The browser is untrusted input; the
rpcd ACL and small fixed-argv helpers are the privileged boundary. Freenetic
does not sit in the packet datapath, and removing its UI packages must not be
treated as a way to remove or reset the router's native network
configuration.

When in doubt, the safe behavior is to preserve an unknown UCI section or
option and report that the compact Freenetic form does not understand it.
