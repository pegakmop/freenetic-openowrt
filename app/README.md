# Freenetic OpenWrt packages

This component owns three independently installable OpenWrt packages:

- `luci-theme-freenetic/` builds the visual shell: templates, CSS, fonts and
  theme settings;
- `luci-app-freenetic/` builds the router UI: views, LuCI menus, rpcd ACLs and
  backend helpers;
- `freenetic-zapret2/` repackages the pinned official Zapret2 runtime as an
  architecture-specific, initially disabled OpenWrt package;
- `deploy.sh` installs the application and the web component on a test router;
- `tests/` checks contracts between privileged ACLs and browser-side calls.

Zapret2's native OpenWrt control plane is packaged here for targets where the
runtime is not already available.  The Freenetic entry point prefers the real
`luci-app-zapret2` page when that package is present (the same arrangement used
by current OpenWrt builds); the versioned client under
`web/application/htdocs/luci-static/resources/zapret2/v4r30/` remains only as a
compatibility fallback for older Freenetic runtime packages.

Each package's `htdocs` and `ucode` entries are intentional links into `web/`.
They are the boundary through which the stock LuCI build system assembles the
browser sources into separate APKs. Browser implementation files belong in
`web/`, not here.

The application menu is named `zz-luci-freenetic.json` deliberately: its
entries override same-path stock LuCI pages (notably System) after LuCI's
lexical menu merge.

Point OpenWrt package entries at the corresponding package directories:

```sh
ln -s /path/to/freenetic/app/luci-theme-freenetic /path/to/openwrt/package/luci-theme-freenetic
ln -s /path/to/freenetic/app/luci-app-freenetic /path/to/openwrt/package/luci-app-freenetic
ln -s /path/to/freenetic/app/freenetic-zapret2 /path/to/openwrt/package/freenetic-zapret2
```
