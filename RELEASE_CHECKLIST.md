# Freenetic 0.2.x release checklist

The `0.2.x` line is a service line: compatibility fixes, preservation of
native OpenWrt configuration, installer/package fixes and UI polish. Mesh/MWS
work does not belong in this checklist; it starts in `0.3`.

## Before release

- [ ] The change is small, backwards-compatible and belongs in `0.2.x`.
- [ ] `testing` contains the complete change and the worktree is clean.
- [ ] `make check-static` passes.
- [ ] `git diff --check` passes.
- [ ] Any ownership or helper change has a regression/contract test.
- [ ] The changelog describes the user-visible behavior and compatibility
      impact.

## Package and CLI verification

Run the checks against both supported package-manager generations:

```sh
make check OPENWRT_DIR=/path/to/openwrt-24.10 DL_DIR=/path/to/openwrt-24.10/dl
make release OPENWRT_DIR=/path/to/openwrt-24.10 DL_DIR=/path/to/openwrt-24.10/dl

make check OPENWRT_DIR=/path/to/openwrt-25.12 DL_DIR=/path/to/openwrt-25.12/dl
make release OPENWRT_DIR=/path/to/openwrt-25.12 DL_DIR=/path/to/openwrt-25.12/dl
```

The expected formats are:

- OpenWrt 24.10.x: four IPK packages for `opkg`;
- OpenWrt 25.12.x: four APK packages for `apk`;
- `fnc`: a target-specific build for every ABI advertised by the release.

For every build, verify that:

- [ ] the package contents contain the ACL, menu, translations and helpers;
- [ ] helpers and CGI entry points have executable permissions;
- [ ] the package index advertises exactly the archives beside it;
- [ ] all four packages use one source revision and release version;
- [ ] the CLI links against the intended OpenWrt ABI;
- [ ] the MT7621 mirror is present when the release uses APK.

The ABI compatibility shim for `fnc` and `apk add --allow-untrusted` are
intentional OpenWrt integration details in 0.2.x. Do not change either as part
of an ordinary patch release.

## Router smoke test

Use a configuration backup and a disposable/test router where possible. The
following is the minimum stable-release path for each relevant OpenWrt line:

- [ ] read-only hardware/ABI preflight passes;
- [ ] fresh install completes and the selected Freenetic release is shown;
- [ ] update from the previous stable release completes;
- [ ] the LuCI shell loads in light, dark and mobile layouts;
- [ ] WAN save and reload work;
- [ ] Wi-Fi enable/disable and save work;
- [ ] firewall rule and port-forward save work;
- [ ] reboot preserves the native configuration and Freenetic metadata;
- [ ] the dashboard updater detects a newer pinned release and can install it;
- [ ] config/package backup and the intended sysupgrade `--test` path behave
      predictably.

For upgrades, cover at least `0.1 → latest 0.2.x`, the previous `0.2.0` line
and the previous stable patch. A downgrade need not be supported, but it must
fail clearly before leaving a partial installation.

## Preservation and security regression pass

- [ ] foreign UCI sections and unknown options survive a Freenetic save;
- [ ] automatic reconciliation removes only `freenetic_managed=1` objects;
- [ ] explicit Delete actions clearly state what native objects they remove;
- [ ] WireGuard/AmneziaWG peer round-trip preserves foreign options;
- [ ] hidden/advanced options produce a warning in compact editors;
- [ ] helper negative tests cover empty arguments, option-like values,
      traversal, newlines, long values and unexpected Unicode;
- [ ] no new generic `fs.exec()`/shell command boundary was introduced;
- [ ] secrets are absent from diagnostics, logs and release notes.

## Publishing

- [ ] merge the verified `testing` state to the intended release branch;
- [ ] update `install.sh` with the intended tag, source asset version and
      checksums from the verified build;
- [ ] create and push the release tag from that clean commit;
- [ ] build artifacts from the tag, not from a local dirty tree;
- [ ] let the tagged GitHub Actions run complete its installer metadata and
      14-asset validation;
- [ ] verify the tagged installer and its `SHA256SUMS.txt` manifest;
- [ ] attach both package-manager variants and matching `fnc` binaries;
- [ ] record the tested device/target/version in `COMPATIBILITY.md`;
- [ ] verify the generated GitHub release before updating the pinned release.
