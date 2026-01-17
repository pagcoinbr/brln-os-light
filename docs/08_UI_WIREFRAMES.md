# UI Wireframes (text)

## Global layout
- Sidebar menu order:
  - Wizard (hidden when wallet is unlocked)
  - Dashboard
  - Reports
  - Wallet
  - Lightning Ops
  - LND Config
  - Apps
  - Bitcoin Remote
  - Bitcoin Local
  - Notifications
  - Disks
  - Terminal
  - Logs
- Top bar:
  - health badge
  - system status label

## Wizard
Step 1: Bitcoin remote
- Host and ZMQ shown
- Inputs: RPC user, RPC pass
- Test and save

Step 2: LND wallet
- Create or import
- Create shows seed words once

Step 3: Unlock wallet
- Password input

## Dashboard
- Status overview
- Cards: System, Disks, Postgres, Bitcoin, LND
- Quick actions: restart LND and manager

## Reports
- Live results card (00:00 to now)
- Filters: D-1, Month, 3 months, 6 months, 12 months, All time
- Charts: net routing profit, revenue vs cost, balances

## Wallet
- Balances
- Create invoice, pay invoice
- Recent activity list

## Lightning Ops
- Channel list and peer list
- Channel open and close
- Fee policy update
- Boost peers button

## LND Config
- Basic fields: alias, color, min and max channel size
- Toggle Bitcoin source (local or remote)
- Advanced raw editor

## Apps
- App cards with install, start, stop, uninstall
- External app launch if port is defined
- Admin password tools for LNDg

## Bitcoin Remote
- RPC and ZMQ health

## Bitcoin Local
- Sync progress and status
- Node info
- Storage and prune config
- Block cadence card

## Notifications
- Timeline list
- Filters and backup settings

## Disks
- SMART and wear status
- Estimated lifespan

## Terminal
- Terminal status and access hint

## Logs
- Service selector and tail output
