# Definition of Done (v0.2)

## Installation
- Installer completes on a clean Ubuntu Server.
- Services active:
  - postgresql
  - lnd (even if wallet is locked)
  - lightningos-manager
  - lightningos-reports.timer
- UI reachable on https://localhost:8443

## Wizard
- Remote Bitcoin credentials validated and saved.
- Wallet can be created or imported.
- Seed shown once and not persisted.
- Wallet unlock works.

## Core UI
- Dashboard shows system, disks, Postgres, Bitcoin, and LND.
- Wallet functions: invoice, pay, decode, send.
- Lightning Ops functions: channels, peers, fees, open and close.
- LND Config updates and restarts LND.

## Reports
- Daily job writes D-1 data to reports_daily.
- Live reports endpoint returns today data.
- UI renders charts for all ranges.

## App Store
- App list returns status.
- Install and start actions work for Bitcoin Core and LNDg.

## Security
- No secrets shown in UI or logs.
- LAN only access by default.
