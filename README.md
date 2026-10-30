# Squeek Wake & Raid

A single-page static site for Squeekchain on Ethereum Sepolia. It has three parts:

- **WHEELY9000 wake siren.** A live hamster-wheel gauge that spins at the reported RPM. It shows block progress, cumulative work, lifetime km, minted SQK and round numbers. A Web Audio siren rings on "Any wheel motion" or "Zoomies (>40 RPM)", and the portal collapse watch runs an 8-second grace countdown when a running wheel stops.
- **6-pocket raid drill.** A canvas extraction game. Move with WASD, the arrow keys or the on-screen pad. Puff (Space) stuns traps and Drop (X) throws away your lowest-value relic. Every 20 to 30 seconds, or when the live wheel has been stopped for 8 seconds, a 10-second "GET OUT" collapse starts. Reach the Mint Portal before it ends to bank your score. Your personal best and raid history are saved in this browser's `localStorage`.
- **Sepolia keeper console.** Connect MetaMask, Rabby or another browser wallet. The site finds wallets through EIP-6963, falls back to `window.ethereum`, and makes every call with `provider.request`. It then sends either "Run mining checkpoint" or the "Send tester ping (0-approve SQK)" transaction. The site switches the wallet to Sepolia (`0xaa36a7`), or adds the network if the wallet doesn't have it. A transaction log links each hash to `https://eth-sepolia.blockscout.com/tx/<hash>`.

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

Commit `dist/` after every rebuild, because the host serves the committed export without building it. `node_modules/` is excluded by `.gitignore`. That file ignores only `node_modules/` and has no other paths.

## Validation (results from this build)

Commands I ran on the final source:

- `npm run typecheck`: passed with no errors.
- `npm run build`: passed. It wrote `dist/index.html`, one CSS file and one JS file under `dist/assets/` (about 13.8 kB, 15 kB and 34 kB before gzip), plus `favicon.svg` and `og.png`.
- A Playwright interaction script (kept in `test/scratch/`, which is not committed). It serves `dist/` under a `/sub/` path, to prove the relative URLs work, and runs Chromium at 390, 1440 and 320 px wide. It checked:
  - no horizontal overflow, zero console errors and no failed requests at all three widths
  - live status, economy and `checkpointStatus()` values rendered
  - Arm alarm visible on the first 390×844 screen
  - Arm, Simulate wake event and Test siren work
  - Preview a wheel stop counts down from 8.0 s and ends in "PORTAL COLLAPSING"
  - Practice override enables Start raid. Arrow keys, Space, X and the touch pad drive the raid, and the scheduled collapse banks the raid at the portal into history and `localStorage`
  - With a mocked EIP-6963 wallet, connecting adds and switches to Sepolia. Both buttons send `eth_sendTransaction` with the exact `to`, `value` and `data` from the brief, and the log links to Blockscout
  - With the API and RPC blocked, the offline banner shows
- `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` (the design probe): 16 of 16 checks passed.

Limitations:

- I didn't use a real wallet. Real signing and sending to Sepolia were not exercised; the transaction path was tested against a mocked provider.
- The siren was triggered in headless Chromium, but nobody listened to it.
- I did no physical-device, WebKit/Safari or screen-reader testing.
- The wheel was idle for the whole session, so the live idle-to-running and running-to-idle transitions were only exercised through the preview buttons and the parsing logic.
- Coinbase Smart Wallet (passkey) needs the Coinbase SDK, which the brief's "native `window.ethereum.request` only" rule rules out. Coinbase Wallet's extension is still found through EIP-6963. On phones, "Open in MetaMask / Coinbase Wallet / Phantom" links open the page in the wallet's own browser.

Full review notes are in `artifacts/validation.md`.

Built by @tatthang · Powered by Squeekchain Sepolia Telemetry
