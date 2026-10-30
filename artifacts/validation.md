# Revision validation: Squeek Wake & Raid

Complete for the stated revision scope. All three reports reproduced before editing and pass after their fixes. This is a local validation record, not independent certification.

## Scope and method

The accepted interface, design tokens, game rules, public sources and transaction parameters are retained. Changes cover only network selection/verification and its displayed state, held-key release, and live wheel-stop precedence over previews. The existing vanilla TypeScript/Vite project exports plain static assets with relative URLs; no runtime dependency was added.

The Chromium regression harness serves the production `dist/` at `/sub/`, injects a native EIP-1193 provider, controls the two API responses and RPC results, and advances the browser clock. Its wallet is a test double; it does not access an account, sign or broadcast. Hamster positions are observed by wrapping the existing canvas body `fillRect`, without changing game logic. Scripts, raw results and probe screenshots are in disposable `test/scratch/`.

## Findings, fixes and rechecks

| Report | Reproduced before fixing | Cause and correction | Recheck |
| --- | --- | --- | --- |
| `765ac721…699e0`, high | At 390×844, connect on Sepolia, change to chain 1, make the first switch reject with 4902 and add resolve without selecting the chain. Sequence was `eth_chainId → switch → add → eth_sendTransaction`; send saw `0x1` while the page claimed Sepolia. The stub rejected the transaction, so nothing was broadcast. | `src/wallet.ts:85`: explicitly switch again after add, then read `eth_chainId` and reject unless it is Sepolia. `src/main.ts:447`: shared `selectSepolia` refreshes the actual chain after failure, including wallets that omit `chainChanged`, and renders it consistently for connect, the switch row and both actions. | Sequence is now `eth_chainId → switch → add → switch → eth_chainId → eth_sendTransaction`, with send on `0xaa36a7`. Rejected or ineffective switches make zero send calls, retain chain 1 in the UI and show "Not sent". Both action payloads remain byte-for-byte as supplied. |
| `e9f787e0…d6b`, medium | At 1440×900, practice raid, hold ArrowRight 200 ms, click Puff, release with Puff focused. Recorded hamster x positions at release/+500/+1000 ms were `264, 326, 390`. | `src/game.ts:95`: process releases before the running/form-control guards. Keep new presses on buttons, links and inputs ignored. | First recheck positions were `264, 264, 264`. The final suite also passes release over Drop at 390, D over Puff at 1440, and W over the practice checkbox at 390; new presses on controls remain ignored and canvas focus restores movement. |
| `e6fcf6a7…e6e`, medium | Online ACTIVE/45 RPM, start raid, leave portal, preview stop, then serve online IDLE/0 RPM with constant work. After the real eight-second grace, watch still said "Preview only" and raid HUD still said "Collapse in". | `src/main.ts:243`: every real running-to-idle edge calls `startGrace(false)`, replacing the preview's timer. Existing live restart cancellation is retained. | A real stop during an active preview produces a live "PORTAL COLLAPSING" alert and "Get out in" raid HUD. A stop after the preview alert replaces its delayed reset. Renewed motion cancels the live countdown, preserving an active safe-zone raid at 100 HP. |

Explicit switching after add follows [EIP-3085's return-value requirements](https://eips.ethereum.org/EIPS/eip-3085#wallet_addethereumchain-returns). Contract addresses, selectors, calldata, zero value, RPC and explorer configuration were not changed.

## Better Interface coverage

Read the pinned workflow and core principles of all six domains; reviewed only the changed interactions and their affected existing components. The visual idea remains one dark hardware bench combining live telemetry, a canvas raid and a keeper console.

| Domain | Coverage and evidence | Limitations |
| --- | --- | --- |
| Accessibility | Checked source names/labels, native controls, live status text, focus rules and reduced-motion guards. Fixed the lost keyboard-release behavior. Browser Tab traversal reaches Arm alarm; its gold focus ring was visually inspected and Enter arms it. Probe targets and motion checks pass. | No screen-reader or physical-device session; no full automated accessibility audit. |
| Layout | Checked the retained DOM order and responsive CSS. Probe finds no overflow, overlaps or clipped text at 320/390/1440. Inspected actual screenshots at 390×844 and 1440×900; the phone shows product and main action, with Arm alarm ending at 586.6 px. | No native 200% zoom, RTL mirror, or intermediate-width visual review in this revision. |
| Writing | Checked changed network failure copy and existing preview/live distinctions. The message says how to recover by switching to Ethereum Sepolia and trying again. Failure rows say "Not sent"; successful selection alone permits the Sepolia claim. | No localization testing; the page is English. |
| Typography | Source retains five semantic sizes, two system families, three weights, monospace tabular telemetry and wrapping for hashes. Probe confirms these and no text clipping; phone and desktop wrapping inspected. | No translated text or text-enlargement review. |
| Colors | Existing semantic hex tokens retained. Probe measured rendered solid text/background pairs and all pass 4.5:1 (3:1 for large text). Focus and state text inspected in screenshots. | Canvas art is outside the probe's text-contrast assessment; no light theme is implemented. |
| UI | Existing button, watch, canvas, dialog and transaction-log patterns retained. Regression walks connected, wrong-network, rejected, pending and confirmed transaction states, gameplay focus changes, preview/live grace, collapse and restart. The probe reports no surface/motion violations. | No 10% animation-panel replay or subjective audio assessment. |

No additional design findings were established within this revision scope. `DESIGN.md` retains the implemented tokens and responsive system and now records the corrected interaction rules.

## Commands and results

- `npm ci`: passed using the existing manifest and lockfile; dependencies unchanged.
- `npm run typecheck`: passed (`tsc --noEmit`).
- `npm run build`: passed; Vite 6.4.5 wrote a 13,926-byte HTML entry, 15,417-byte CSS bundle, 34,393-byte JS bundle, 347-byte favicon and 55,958-byte share image. Complete export: **120,041 bytes**.
- `node test/scratch/revision-checks.mjs baseline`: all three original behaviors reproduced before the fixes. No real wallet was involved.
- `node test/scratch/revision-checks.mjs regression`: **15/15 scenarios passed**, zero captured page or console errors. Covers initial connection, add/switch success, rejection and ineffective switches with/without chain events, both exact transaction payloads, mocked receipts/explorer URLs, movement release across focus changes, preview replacement and restart cancellation.
- `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`: **16/16 passed** on the revised export. Screenshots: `test/scratch/taste/shots/390.png`, `390-full.png`, `1440.png`, `1440-full.png`; the probe also measured 320 and reduced motion.
- Assigned browser tool: viewed the actual production export at 390×844 and 1440×900, inspected screenshots, keyboard focus and arming. The real status, economy and Sepolia RPC requests returned HTTP 200. Console had zero errors or warnings. The observed live wheel was idle; transition regression cases use controlled feeds.

No real signing/broadcast, audible listening, WebKit/Safari execution, native device, screen reader or native zoom validation is claimed. WebKit launch was attempted but its required system libraries are unavailable. These limitations do not prevent exercising the reported defects with Chromium and native provider test doubles.

The ignore change has an explicit path budget: `/.gitignore` ≤ 512 bytes, `/.imd-responses.json` ≤ 4,096 bytes and `/artifacts/validation.md` ≤ 12,288 bytes. Only those two required records are newly included; other artifact paths stay excluded. The existing `node_modules/` rule still excludes dependency directories at every nesting level. Temporary tests, browser snapshots and caches stay outside the submission. `dist/` contains only required HTML, JS, CSS, favicon and share image.
