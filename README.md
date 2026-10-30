# Squeek Wake & Raid

A single-page static site for Squeekchain on Ethereum Sepolia. It has three parts:

- **WHEELY9000 wake siren.** A live hamster-wheel gauge that spins at the reported RPM. It shows block progress, cumulative work, lifetime km, minted SQK and round numbers. A Web Audio siren rings on "Any wheel motion" or "Zoomies (>40 RPM)", and the portal collapse watch runs an 8-second grace countdown when a running wheel stops.
- **6-pocket raid drill.** A canvas extraction game. Move with WASD, the arrow keys or the on-screen pad. Puff (Space) stuns traps and Drop (X) throws away your lowest-value relic. Every 20 to 30 seconds, or when the live wheel has been stopped for 8 seconds, a 10-second "GET OUT" collapse starts. Reach the Mint Portal before it ends to bank your score. Your personal best and raid history are saved in this browser's `localStorage`.
- **Sepolia keeper console.** Connect MetaMask, Rabby or another browser wallet. The site finds wallets through EIP-6963, falls back to `window.ethereum`, and makes every call with `provider.request`. It then sends either "Run mining checkpoint" or the "Send tester ping (0-approve SQK)" transaction. The site switches the wallet to Sepolia (`0xaa36a7`), or adds the network if the wallet doesn't have it. After adding Sepolia it explicitly switches again, then checks `eth_chainId` before reporting success or requesting a transaction. A rejected or ineffective switch keeps the wrong-network state and stops the action. A transaction log links each hash to `https://eth-sepolia.blockscout.com/tx/<hash>`.

## Live sources

| Source | Interval | Used for |
| --- | --- | --- |
| `GET https://api.squeekchain.com/v1/status` | 5 s | freshness, coreStatus, RPM, speed, distance, cumulative work, block anchor, settled round |
| `GET https://api.squeekchain.com/v1/economy/state` | 15 s | current round, total minted SQK, processed round, funded blocks |
| `eth_call` to `0xcd46990f8349057335289ef282c276204b6cdc62`, data `0x001c856f`, on `https://ethereum-sepolia-rpc.publicnode.com` | 15 s | `checkpointStatus()` decoded as `(bool corePaused, uint64 nextRound, bool roundSettled)` |

The wheel counts as **running** when `freshness === "online"` and at least one of these holds: `coreStatus === "ACTIVE"`, `rpmMilli > 0`, `speedMmPerSecond > 0`, or `cumulativeWorkUnits` went up since the previous poll.

"Run mining checkpoint" is enabled only when `roundSettled && !corePaused`. It sends `{ to: 0xcd46…dc62, value: "0x0", data: "0xc2c4c5c1" }`. The tester ping sends a zero-allowance `approve(0xcd46…dc62, 0)` to the SQK token `0x5501e1fa81be1c3f49225fa7668da0245d07db60`.

If an API or the RPC fails, a banner names the source that failed. The page keeps the last good reading on screen and keeps retrying, so it never goes blank.

## Project layout

```
index.html          page markup, meta tags (title, description, og:*, favicon)
src/main.ts         wiring: polling, siren, portal watch, raid HUD, keeper console
src/telemetry.ts    API/RPC fetch, parsing, checkpointStatus() decoding
src/siren.ts        Web Audio siren (no audio files)
src/game.ts         raid drill canvas game
src/wallet.ts       EIP-6963 discovery, Sepolia switch/add, phone "Open in" links
src/style.css       design tokens and components (see DESIGN.md)
public/             favicon.svg and og.png, copied into dist/
dist/               committed production export (relative asset URLs)
```

The source is vanilla TypeScript. There is no framework and no runtime CDN. Vite only bundles it. The committed `dist/` is plain static HTML, CSS and JS with `base: "./"`, so it works from an IPFS gateway subpath or an ENS name.

## Install, preview, rebuild

Requires Node 18+ (checked with Node 24.21.0 and npm 11.19.0).

```bash
npm ci              # install from package-lock.json
npm run dev         # local dev server with reload
npm run typecheck   # tsc --noEmit
npm run build       # typecheck, then write the static export to dist/
npm run preview     # serve dist/ locally to check the production build
```

Commit `dist/` after every rebuild, because the host serves the committed export without building it. `.gitignore` excludes `node_modules/` at every nesting level and includes narrow exceptions for the required response JSON and validation record. Their explicit path budgets are documented in the validation record.

## Validation (revision, 2026-10-30)

All three review reports reproduced against the accepted export before editing. The revision fixes network verification after adding Sepolia, movement-key release after focus moves to a control, and real wheel-stop transitions during a preview.

Checks run on the revised production export:

- `npm ci`: installed the existing lockfile without changing dependencies.
- `npm run typecheck` and `npm run build`: passed. The complete `dist/` is 120,041 bytes, including the share image and favicon.
- `node test/scratch/revision-checks.mjs baseline`: reproduced all three reported defects before the fixes.
- `node test/scratch/revision-checks.mjs regression`: **15/15 scenarios passed** in Chromium at 390 and 1440 px, serving `dist/` under `/sub/`. Controlled API responses, a native wallet stub and a virtual browser clock exercised successful, rejected and ineffective network switches; initial connection; both exact transaction payloads and receipt/explorer states; key releases over Puff, Drop and a checkbox; preview replacement before/after its alert; and restart cancellation. Zero page or console errors were captured.
- `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`: **16/16 checks passed**, including reflow at 320, 390 and 1440 px, rendered text contrast, reduced motion and share metadata.
- Browser inspection of the export at 390×844 and 1440×900: the first phone screen shows the wheel and Arm alarm (bottom at 586.6 px). Keyboard focus is visible and Enter arms the alarm. The live status/economy/RPC requests returned HTTP 200, with zero console errors.

The temporary interaction scripts and screenshots live in `test/scratch/`, which is removed before submission. Regression fixtures are confined there; the production site keeps the supplied public data sources and contract parameters.

Limitations:

- No real wallet signing or broadcast was performed; wallet responses and receipts were mocked.
- Audible siren output, physical devices, screen readers, native 200% zoom and RTL were not tested in this revision.
- WebKit could not launch because its system libraries are missing, so the revised behavior was checked in Chromium only.
- The observed live feed was idle; real motion/stop edges were exercised with controlled feed responses.
- Coinbase Smart Wallet (passkey) needs an SDK, which conflicts with the brief's native-provider-only requirement. Existing EIP-6963 discovery and phone wallet-browser links are retained.

The six-domain review, reproduction evidence and fixes are recorded in [artifacts/validation.md](artifacts/validation.md). Per-finding responses are in `.imd-responses.json`.

Built by @tatthang · Powered by Squeekchain Sepolia Telemetry
