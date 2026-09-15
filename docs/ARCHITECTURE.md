# Architecture

Freenetic is deliberately not a replacement network stack. It is a user
interface and a thin set of integration helpers around the services already
provided by OpenWrt.

```text
Browser UI (LuCI views)
        │ authenticated LuCI RPC / UCI calls
        ▼
rpcd ACL ───────────────► UCI / ubus
   │                         │
   │ fixed argv              ├─ netifd / firewall4 / dnsmasq / hostapd
   ▼                         ├─ iwinfo / network status
Freenetic helper             └─ package manager / sysupgrade
   │
   └─ fixed native primitive (no shell command assembled from browser input)
```

## Source of truth

Network interfaces, wireless associations, DHCP leases, routes, firewall
rules, package state and service state are discovered from UCI, ubus, iwinfo
or the relevant native OpenWrt helper. Freenetic does not keep a parallel
database for those objects. The small `freenetic` UCI configuration stores
only Freenetic-specific metadata such as the selected release tag.

When a compact editor cannot represent a native option, it changes only the
fields it owns and warns about the rest. Unknown options are not silently
normalized away.

## Ownership and cleanup

Objects created for later automatic reconciliation carry
`freenetic_managed=1`. Guest network sections, WAN VLAN devices and
WireGuard/AmneziaWG peers use this marker. Legacy Freenetic sections are
adopted only through an explicit, narrowly matched migration path.

Automatic reconciliation removes only marked objects. A foreign section may
be edited by an explicit user action where the UI clearly identifies the
operation, but a background refresh or a model diff must never delete it.

Uninstall removes Freenetic's packages, not a working native network
configuration. Any future destructive purge must be a separate, explicitly
dangerous operation.

## Privileged boundary

The browser can request only ACL-covered UCI/ubus operations and named helper
actions. Helpers validate their arguments, use fixed paths or fixed service
names, and do not evaluate browser data as shell code. Firmware flashing is
delegated to OpenWrt's `sysupgrade`; package installation is delegated to the
router's `apk` or `opkg` stack.

Freenetic is not in the datapath. Once native OpenWrt services apply a
configuration, the network continues to work without the Freenetic UI.

## Package and release boundaries

The browser source is split into `web/theme` and `web/application`; the
OpenWrt package wrappers live under `app/`. The theme owns the visual shell
and the application owns views, menus, ACLs and helpers. Release packages are
noarch UI packages, while `fnc` is built for the target ABI selected by the
installer. The ABI compatibility shim remains private to `fnc` installation
and must not replace system libraries.

The shared `0.2.x` source is tested against both OpenWrt 24.10 (`opkg`) and
25.12 (`apk`). A future MWS implementation should live in a separate daemon
and protocol/state boundary rather than growing inside a large LuCI view.
