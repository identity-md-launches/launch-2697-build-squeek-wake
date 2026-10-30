# DESIGN.md: Squeek Wake & Raid

Source of truth: `src/style.css` (tokens at `:root`, components below it), markup in `index.html`, canvas palette in `src/game.ts`.

## Overview

A dark hardware-bench telemetry interface for people watching the Squeekchain hamster wheel on Ethereum Sepolia. Three modules sit on one page as flat panels on a near-black bench: the wake siren, the raid drill and the keeper console. Changing values are monospace with tabular figures. Labels and prose are a system sans. One emerald fill marks the main action and the "running" state, gold marks progress and accents, and red is used only for collapse, loss and failure. Density is moderate: readouts sit in a grid with labels above values, and groups are separated by space plus a single 1px rule.

These are system rules. The two-column module arrangement at desktop is this page's layout, not a requirement for future pages.

## Colors

Defined in `src/style.css` `:root`. Primitives (`--ink-*`, `--emerald-500`, `--gold-400`, `--red-500`) are never used directly by components. Components reference the role tokens:

| Role token | Value | Job |
| --- | --- | --- |
| `--color-bg` | `#0b0b0e` | page background |
| `--color-surface` | `#12141c` | panels, wallet sheet |
| `--color-surface-inset` | `#181b26` | secondary buttons, bars, watch box, D-pad |
| `--color-border` | `#262938` | 1px panel borders, rules, disabled outline |
| `--color-text` | `#e8e9ef` | body and value text |
| `--color-text-muted` | `#9ba1b5` | labels, hints, units |
| `--color-active` | `#35d07f` | primary fill, running state, banked score, HP fill |
| `--color-accent` | `#ffc048` | block progress, grace countdown, tx hash links, personal best |
| `--color-alert` | `#f44a5e` | PORTAL COLLAPSING box, lost raids, failed tx, collapse timer |
| `--color-on-fill` | `#0b0b0e` | text on emerald and red fills |
| `--color-focus` | `#ffc048` | `:focus-visible` outline |

Two one-off values: the `.banner` background `#2a1a10`, a dark amber tint used only for the offline/API-error banner, and the `.btn-primary` hover fill `#4fdc93`.

Measured contrast (WCAG formula on the hex pairs, computed in `test/scratch`):

| Pair | Ratio |
| --- | --- |
| muted on surface | 7.14 |
| muted on inset | 6.67 |
| on-fill on active (primary button) | 9.81 |
| on-fill on alert (collapse box) | 5.60 |
| alert on surface | 5.24 |
| accent on surface | 11.28 |
| text on banner | 13.83 |

The design probe also reported that all rendered text passes 4.5:1. The canvas game uses its own art palette in `src/game.ts` (`RELICS[*].color`, trap and garden colours). Those colours belong to the game art and are not UI tokens.

## Typography

- Families: `--font-sans` (`system-ui, -apple-system, "Segoe UI", Roboto, …`) for prose and controls; `--font-mono` (`ui-monospace, "SFMono-Regular", …`) only for numbers via `.num` and `.readout dd`, always with `font-variant-numeric: tabular-nums`. No web fonts are loaded.
- Weights: 400 body, 600 headings h2/h3, buttons and states, 700 h1 and brand.
- Scale (five sizes, `src/style.css`):

| Token | Size | Use |
| --- | --- | --- |
| `--fs-small` | 14px | labels, hints, buttons, HUD, logs |
| `--fs-body` | 16px | body, h3, readout values |
| `--fs-title` | 20px | h2 panel titles, personal best |
| `--fs-figure` | 28px | RPM figure, watch countdown |
| `--fs-display` | `clamp(30px, 2.4vw + 20px, 44px)` | h1 only |

- Line height: body 1.5, h1 1.08, h2 1.2, h3 1.3. The h1 uses `letter-spacing: -0.02em`. Nothing else is tracked, and no text uses `text-transform: uppercase`.
- Wrapping: headings `text-wrap: balance`, paragraphs `pretty`, hints capped at `60ch`, long values and hashes `overflow-wrap: anywhere`.

## Layout

- Spacing scale `--space-1..6` = 4, 8, 12, 16, 24, 32px. Inside a group the gap is 8 to 12px. Between groups it is 24px with a 1px `--color-border` rule (`.subsection`, `.scores`, `.block-bar`).
- Content width: `main`, `.topbar` and `.footer` have `max-width: 1320px` with 16px inline padding. The intro is capped at `46rem` and the lede at `40rem`.
- `.grid`: one column below 1040px. From 1040px up it is `minmax(0,5fr) minmax(0,7fr)`, with the wheel panel spanning two rows on the left and the raid and keeper panels stacked on the right.
- Panel padding is 16px, or 24px from 600px. `.readout-grid` has 2 columns, or 3 from 600px. `.tx-actions` stacks, and becomes 2 columns from 720px.
- Below 600px the header drops the feed pill (the panel's state line and the error banner carry status). Below 420px "Connect wallet" shortens to "Connect" and the gauge shrinks to 96px.
- The wallet `<dialog>` is a centred 420px sheet. Below 600px it becomes a full-width bottom sheet with safe-area padding.
- Checked with no horizontal scroll at 320, 390 and 1440 wide. On the first 390×844 screen the order is header, h1 and lede, wheel gauge, then the Arm alarm button (bottom edge at about 587px).

## Elevation & Depth

Flat. There are no shadows. Depth comes from tonal layers (`--color-bg` → `--color-surface` → `--color-surface-inset`) and 1px `--color-border` lines. Status boxes (`.banner`, `.wake-alert`, `.watch`, tx log rows) use a 3px `border-inline-start` in the status colour rather than a full card. The only overlay is the modal dialog with a `rgba(11,11,14,0.7)` backdrop.

## Shapes

`--radius-panel` 8px for panels and the sheet. `--radius-control` 6px for buttons, the D-pad and wallet rows. `--radius-inset` 4px for inline status boxes, the canvas frame and the skip link. Bars are pill-ended (5px and 4px radii). Inner surfaces stay under 6px radius so they never read as cards inside cards.

## Components

- **Button** `.btn` (`src/style.css`): 44px min-height, 14px/600 sans, inset fill, 1px border. Variants: `.btn-primary` (emerald fill, at most one per module; `aria-pressed="true"` turns it into an outlined "on" state), `.btn-quiet` (transparent), `.btn-danger-quiet` (red outline, used by Silence siren). `:disabled` drops to transparent with a dashed `--color-border` outline and muted text. `:active` uses `scale: 0.96`. Hover changes only the border, and only on `(hover: hover)` devices.
- **Readout** `dl.readout`: a `dt` label (14px muted sans) above a `dd` value (mono, tabular). Use `.readout-grid` for 2/3-column stats and `.readout-main` for the stacked gauge column. Placeholder value `--` while loading.
- **Progress bar** `.bar > .bar-fill`: a 10px track. The fill is scaled with `transform: scaleX()` and animated over 600ms unless reduced motion is set. It carries `role="progressbar"` with `aria-valuenow`.
- **State pill** `.state` / `.feed-pill`: an 8px `.dot` plus a text label. The colour comes from `data-state` (`live`/`running` emerald, `stale` gold, `offline` red, otherwise muted). The text always states the status, so colour is never the only cue.
- **Status boxes**: `.banner` (`role="status"`, hidden when every source is healthy), `.wake-alert` (`role="alert"`), `.watch` with `data-state` `idle | grace | collapse`. The countdown is `aria-hidden` and the sentence in `#watchText` is the live region.
- **Raid HUD** `.hud`: HP bar, six `.slot` squares (filled with the relic colour through `--c`), carry value and collapse timer (`.danger` while collapsing).
- **D-pad** `.pad`: a 3×2 grid of 48×44 `.pad-btn` buttons with `aria-label`s and pointer-capture hold, plus Puff and Drop `.btn`s.
- **Tx log** `ol.txlog > li[data-status]`: `pending | confirmed | failed | error` sets the left rule colour. Each row has the label, a status word and a Blockscout hash link.
- **Wallet sheet** `dialog.sheet` with `.wallet-row` (48px rows, a 28px icon with a 10% white outline). It is opened with `showModal()`, so Escape and focus return come from the browser.
- **Focus**: global `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }`. The canvas is focusable (`tabindex="0"`) and gets focus when a raid starts.

## Do's and Don'ts

- Do start a new module as a `section.panel` with a `.panel-head` (h2 plus one muted status line) inside `.grid`.
- Do put every changing number in `.num` or `.readout dd` so it stays mono and tabular.
- Do keep one `.btn-primary` per module. Peers are plain `.btn`.
- Do use `--color-alert` only for collapse, loss or failure, and `--color-active` only for "running", "go" and success.
- Don't add shadows, gradients, purple tones, or uppercase or tracked kicker labels above headings.
- Don't add font sizes beyond the five `--fs-*` tokens (the probe's ceiling is six per width).
- Don't nest a radius-8 bordered card inside a panel. Separate groups with `.subsection` spacing and a rule.
- Recipe for one more panel: `<section class="panel" aria-labelledby="x"><div class="panel-head"><h2 id="x">…</h2><p class="muted">…</p></div><dl class="readout readout-grid">…</dl><div class="actions"><button class="btn btn-primary">Verb</button></div></section>`.
