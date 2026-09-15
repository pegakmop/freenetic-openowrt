# Contributing to Freenetic

Freenetic is a clean-room LuCI/CLI layer over vanilla OpenWrt. Contributions
should keep OpenWrt's native configuration and services as the source of
truth.

## Before opening a pull request

Run the checks that apply to the change:

```sh
make check-static
make check OPENWRT_DIR=/path/to/openwrt
make check-package OPENWRT_DIR=/path/to/openwrt DL_DIR=/path/to/openwrt/dl
```

`make check-static` is the required baseline and does not need an OpenWrt
buildroot. Package and CLI checks need a matching buildroot with the package
directories linked as described in the README.

For router work, use `testing`, take a configuration backup first, and prefer
the read-only preflight before a development deployment:

```sh
app/check-router.sh root@192.168.1.1
app/deploy.sh
```

Never use a production router as the only verification environment for a
change that can reload networking, modify firewall policy, install packages
or flash firmware.

## Design rules

1. OpenWrt remains the source of truth. Read UCI/ubus/iwinfo instead of
   maintaining a second database of clients, routes or policies.
2. Do not destroy what you do not understand. Unknown UCI options must remain
   intact when a compact Freenetic editor saves known fields.
3. Freenetic-created objects must be identifiable as
   `freenetic_managed=1` (or an equally explicit existing ownership marker).
   Automatic cleanup may remove only objects that Freenetic owns.
4. Prefer native OpenWrt primitives over Freenetic-specific state. Helpers
   should stay thin wrappers around UCI, ubus and fixed system operations.
5. Browser input must cross the rpcd ACL through strict validation and a fixed
   argv. Do not add `sh -c`, `eval` or a generic command runner.
6. Firmware operations remain a wrapper around штатный `sysupgrade`; do not
   implement a second flashing mechanism in the UI.

If a form is intentionally incomplete, show a warning rather than pretending
to be a full representation of the native configuration.

## Change organization

Keep commits focused and describe user-visible behavior in the commit
message. Add or update a contract/runtime test with ownership, ACL, helper,
package or release changes. Do not commit generated release artifacts from an
unclean tree; releases are built from a clean tag.

The `0.2.x` line is for compatibility, polish and bug fixes. A new long-lived
orchestration protocol such as MWS belongs in a future `0.3` design and must
not become hidden state inside the 0.2.x UI.
