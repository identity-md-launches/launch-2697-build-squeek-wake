import "./style.css";
import {
  MINING, SQK_TOKEN, fetchCheckpointStatus, fetchEconomy, fetchStatus, rpc,
  type CheckpointStatus, type EconomyReading, type WheelReading,
} from "./telemetry";
import { Siren } from "./siren";
import { RELICS, RaidGame, type RaidResult, type RelicKind } from "./game";
import {
  OPEN_IN, SEPOLIA, ensureSepolia, errText, isMobileBrowser, listWallets, shortAddr, startDiscovery,
  type Discovered, type Eip1193,
} from "./wallet";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmtInt = new Intl.NumberFormat("en-US");
const fmt = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const STATUS_MS = 5000;
const ECONOMY_MS = 15000;
const GRACE_SECONDS = 8;
const ZOOMIES_RPM = 40;
const EXPLORER = "https://eth-sepolia.blockscout.com";

// ---------------- state ----------------
let reading: WheelReading | null = null;
let economy: EconomyReading | null = null;
let checkpoint: CheckpointStatus | null = null;
let prevWork: bigint | null = null;
let lastStatusOk = 0;
let statusErr = "";
let economyErr = "";
let cpErr = "";
let wasRunning: boolean | null = null;

// ---------------- banner & feed pill ----------------
function renderBanner(): void {
  const parts: string[] = [];
  if (statusErr) parts.push(reading ? `Wheel feed unreachable (${statusErr}). Showing the last reading; retrying every 5 s.` : `Unable to reach api.squeekchain.com (${statusErr}). Retrying every 5 s.`);
  else if (reading && reading.freshness !== "online") parts.push(`The wheel feed reports "${reading.freshness || "unknown"}" freshness, so readings may be out of date.`);
  if (economyErr) parts.push(`Economy figures unavailable (${economyErr}); retrying every 15 s.`);
  if (cpErr) parts.push(`Sepolia RPC unavailable for checkpointStatus() (${cpErr}); retrying every 15 s.`);
  const banner = $("banner");
  banner.textContent = parts.join(" ");
  banner.hidden = parts.length === 0;

  const pill = $("feedPill");
  const text = $("feedPillText");
  if (!reading && !statusErr) { pill.dataset.state = "loading"; text.textContent = "Connecting"; }
  else if (statusErr) { pill.dataset.state = "offline"; text.textContent = "Feed offline"; }
  else if (reading && reading.freshness !== "online") { pill.dataset.state = "stale"; text.textContent = "Feed stale"; }
  else { pill.dataset.state = "live"; text.textContent = "Live feed"; }
}

const errMsg = (e: unknown) => (e instanceof DOMException && e.name === "AbortError" ? "timed out" : e instanceof Error ? e.message : "network error");

// ---------------- polling ----------------
async function pollStatus(): Promise<void> {
  try {
    const r = await fetchStatus(prevWork);
    prevWork = r.work ?? prevWork;
    reading = r;
    statusErr = "";
    lastStatusOk = Date.now();
    renderReading();
    onWheelState(r);
  } catch (e) {
    statusErr = errMsg(e);
  }
  renderBanner();
  window.setTimeout(pollStatus, STATUS_MS);
}

async function pollSlow(): Promise<void> {
  const [eco, cp] = await Promise.allSettled([fetchEconomy(), fetchCheckpointStatus()]);
  if (eco.status === "fulfilled") { economy = eco.value; economyErr = ""; } else economyErr = errMsg(eco.reason);
  if (cp.status === "fulfilled") { checkpoint = cp.value; cpErr = ""; } else cpErr = errMsg(cp.reason);
  renderEconomy();
  renderCheckpoint();
  renderBanner();
  window.setTimeout(pollSlow, ECONOMY_MS);
}

// ---------------- module A: readings ----------------
function renderReading(): void {
  if (!reading) return;
  const r = reading;
  $("rpm").textContent = fmt(r.rpm, 1);
  $("speed").textContent = fmt(r.speed, 2);
  $("coreStatus").textContent = r.coreStatus ? r.coreStatus.charAt(0) + r.coreStatus.slice(1).toLowerCase().replace(/_/g, " ") : "--";
  $("km").textContent = fmt(r.km, 3);
  $("work").textContent = r.work !== null ? fmtInt.format(r.work) : "--";
  $("blockHeight").textContent = r.blockHeight ? fmtInt.format(Number(r.blockHeight)) : "--";
  const pct = r.blockProgress * 100;
  $("blockPct").textContent = `${fmt(pct, 1)}%`;
  $("blockFill").style.transform = `scaleX(${r.blockProgress})`;
  $("blockBar").setAttribute("aria-valuenow", pct.toFixed(1));
  $("settled").textContent = r.settledThroughRound ? fmtInt.format(Number(r.settledThroughRound)) : "--";

  const st = $("wheelState");
  st.dataset.state = r.running ? "running" : "idle";
  document.querySelector<HTMLElement>(".panel-wheel")!.dataset.running = String(r.running);
  $("wheelStateText").textContent = r.running ? "Running" : r.freshness === "online" ? "Asleep" : "Feed not online";
  renderUpdated();
  renderGate();
}

function renderUpdated(): void {
  if (!lastStatusOk) return;
  const s = Math.max(0, Math.round((Date.now() - lastStatusOk) / 1000));
  $("updatedAt").textContent = s < 2 ? "Updated just now" : `Updated ${s} s ago`;
}

function renderEconomy(): void {
  if (!economy) return;
  $("minted").textContent = fmt(economy.mintedSqk, 2);
  $("round").textContent = economy.currentRound ? fmtInt.format(Number(economy.currentRound)) : "--";
  $("funded").textContent = economy.fundedBlocks ? fmtInt.format(Number(economy.fundedBlocks)) : "--";
}

// Wheel rotation follows live RPM (rpm * 6 degrees per second). Static under reduced motion.
let angle = 0;
let lastFrame = performance.now();
let simUntil = 0;
function spin(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const simulating = now < simUntil;
  const rpm = simulating ? 45 : reading?.running ? Math.max(reading.rpm, reading.rpm > 0 ? 0 : 4) : 0;
  if (!reducedMotion.matches && rpm > 0) {
    angle = (angle + rpm * 6 * dt) % 360;
    $("wheelRotor").setAttribute("transform", `rotate(${angle.toFixed(2)} 60 60)`);
  }
  requestAnimationFrame(spin);
}

// ---------------- siren ----------------
const siren = new Siren();
let armed = false;
let prevAlarmCond: boolean | null = null;
const alarmMode = () => (document.querySelector<HTMLInputElement>('input[name="alarmMode"]:checked')?.value ?? "any") as "any" | "zoomies";
const alarmCond = (r: WheelReading) => (alarmMode() === "any" ? r.running : r.running && r.rpm > ZOOMIES_RPM);
const modeLabel = () => (alarmMode() === "any" ? "any wheel motion" : "zoomies above 40 RPM");

siren.onChange = (ringing) => { $("silenceBtn").hidden = !ringing; };

function renderAlarm(): void {
  const btn = $<HTMLButtonElement>("armBtn");
  btn.setAttribute("aria-pressed", String(armed));
  btn.textContent = armed ? "Disarm alarm" : "Arm alarm";
  const already = armed && reading && alarmCond(reading);
  $("alarmHint").textContent = armed
    ? `Armed for ${modeLabel()}. ${already ? "The wheel already qualifies, so the siren rings on the next wake." : "Keep this tab open; the siren rings when Squeektoshi wakes."}`
    : "The alarm is off. Arm it and keep this tab open; the siren plays when the wheel starts.";
}

let titleTimer = 0;
function wake(simulated: boolean): void {
  const ok = siren.play(simulated ? 4 : 8);
  const alert = $("wakeAlert");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  alert.textContent = simulated
    ? `Preview at ${time}: this is how a wake looks and sounds.${ok ? "" : " Audio is unavailable in this browser."}`
    : `Squeektoshi woke up at ${time}. The wheel is running.${ok ? "" : " Audio is blocked; click Test siren once to allow sound."}`;
  alert.hidden = false;
  window.clearTimeout(titleTimer);
  document.title = simulated ? "Wake preview · Squeek Wake & Raid" : "Squeektoshi is awake · Squeek Wake & Raid";
  titleTimer = window.setTimeout(() => (document.title = baseTitle), 15000);
}
const baseTitle = document.title;

$("armBtn").addEventListener("click", () => {
  armed = !armed;
  if (armed) siren.unlock(); else siren.stop();
  prevAlarmCond = reading ? alarmCond(reading) : null;
  renderAlarm();
});
document.querySelectorAll<HTMLInputElement>('input[name="alarmMode"]').forEach((el) =>
  el.addEventListener("change", () => { prevAlarmCond = reading ? alarmCond(reading) : null; renderAlarm(); }));
$<HTMLInputElement>("volume").addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  siren.setVolume(v / 100);
  $("volumeOut").textContent = `${v}%`;
});
siren.setVolume(0.6);
$("testBtn").addEventListener("click", () => {
  if (!siren.play(2.5)) { const a = $("wakeAlert"); a.textContent = "Audio is unavailable in this browser."; a.hidden = false; }
});
$("simWakeBtn").addEventListener("click", () => {
  simUntil = performance.now() + 4000;
  wake(true);
});
$("silenceBtn").addEventListener("click", () => siren.stop());

// ---------------- portal collapse watch ----------------
let graceEnd = 0;
let graceTimer = 0;
let gracePreview = false;
let collapsed = false;

function setWatch(state: "idle" | "grace" | "collapse", text: string, count: string): void {
  $("watch").dataset.state = state;
  $("watchText").textContent = text;
  $("watchCount").textContent = count;
}

function startGrace(preview: boolean): void {
  window.clearInterval(graceTimer);
  gracePreview = preview;
  collapsed = false;
  graceEnd = performance.now() + GRACE_SECONDS * 1000;
  setWatch("grace", `${preview ? "Preview: " : ""}The wheel stopped. Grace countdown running; it cancels if Squeektoshi runs again.`, `${GRACE_SECONDS.toFixed(1)} s`);
  graceTimer = window.setInterval(() => {
    const left = Math.max(0, (graceEnd - performance.now()) / 1000);
    $("watchCount").textContent = `${left.toFixed(1)} s`;
    if (left <= 0) {
      window.clearInterval(graceTimer);
      collapsed = true;
      setWatch("collapse", `PORTAL COLLAPSING. ${preview ? "Preview only. " : ""}The wheel has been still for 8 seconds; head to the Live Garden or the livestream.`, "0.0 s");
      if (!preview) game.triggerCollapse("the wheel stopped");
      if (preview) graceTimer = window.setTimeout(resetWatch, 10000);
    }
  }, 100);
}

function resetWatch(): void {
  window.clearInterval(graceTimer);
  window.clearTimeout(graceTimer);
  collapsed = false;
  gracePreview = false;
  setWatch("idle", "Watching. The 8-second grace countdown starts when a running wheel stops.", `${GRACE_SECONDS.toFixed(1)} s`);
}

$("simStopBtn").addEventListener("click", () => startGrace(true));

function onWheelState(r: WheelReading): void {
  // Alarm edge.
  const cond = alarmCond(r);
  if (armed && prevAlarmCond === false && cond) wake(false);
  prevAlarmCond = cond;
  renderAlarm();

  // Portal watch edge.
  if (wasRunning === true && !r.running) startGrace(false);
  if (r.running && (graceEnd > 0 || collapsed) && !gracePreview) { graceEnd = 0; resetWatch(); }
  if (wasRunning === null && !r.running && !gracePreview) {
    setWatch("idle", "Squeektoshi is asleep. The countdown starts the next time a running wheel stops.", `${GRACE_SECONDS.toFixed(1)} s`);
  }
  wasRunning = r.running;
}

// ---------------- module B: raid drill ----------------
interface Saved { best: number; history: RaidResult[] }
const STORE = "squeek-raid:v1";
function loadSaved(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "null") as Saved | null;
    if (raw && typeof raw.best === "number" && Array.isArray(raw.history)) return raw;
  } catch { /* storage blocked or corrupt */ }
  return { best: 0, history: [] };
}
const saved = loadSaved();
function persist(): void {
  try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode */ }
}

function renderScores(): void {
  $("best").textContent = fmtInt.format(saved.best);
  const list = $("history");
  list.replaceChildren(...saved.history.slice(0, 8).map((h) => {
    const li = document.createElement("li");
    const time = new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const score = document.createElement("span");
    score.className = `num ${h.banked ? "ok" : "lost"}`;
    score.textContent = h.banked ? fmtInt.format(h.score) : "0";
    const what = document.createElement("span");
    what.textContent = h.banked ? `Banked ${h.relics} relic${h.relics === 1 ? "" : "s"}` : h.reason;
    const when = document.createElement("span");
    when.className = "muted num";
    when.textContent = time;
    li.append(score, what, when);
    return li;
  }));
  $("historyEmpty").hidden = saved.history.length > 0;
}

const practice = $<HTMLInputElement>("practice");
const canRaid = () => practice.checked || !!reading?.running;

function renderPockets(pockets: RelicKind[]): void {
  const slots: string[] = [];
  for (const k of pockets) for (let i = 0; i < RELICS[k].slots; i++) slots.push(RELICS[k].color);
  const el = $("pockets");
  el.replaceChildren(...Array.from({ length: 6 }, (_, i) => {
    const s = document.createElement("span");
    s.className = "slot";
    if (slots[i]) { s.style.setProperty("--c", slots[i]); s.dataset.full = ""; }
    return s;
  }));
  el.setAttribute("aria-label", `${slots.length} of 6 pockets used`);
}

const game = new RaidGame($<HTMLCanvasElement>("game"), {
  canStart: canRaid,
  onHud: (h) => {
    $("hpFill").style.transform = `scaleX(${h.hp / 100})`;
    $("hpText").textContent = String(Math.ceil(h.hp));
    renderPockets(h.pockets);
    $("carry").textContent = fmtInt.format(h.carry);
    $("collapseLabel").textContent = h.collapsing ? "Get out in" : "Collapse in";
    $("collapseIn").textContent = h.collapseIn === null ? "--" : `${h.collapseIn.toFixed(1)} s`;
    $("collapseIn").classList.toggle("danger", h.collapsing);
    $("startBtn").textContent = h.running ? "Raid in progress" : "Start raid";
    ($("startBtn") as HTMLButtonElement).disabled = h.running || !canRaid();
  },
  onEnd: (r) => {
    saved.history.unshift(r);
    saved.history = saved.history.slice(0, 20);
    const pb = r.banked && r.score > saved.best;
    if (pb) saved.best = r.score;
    persist();
    renderScores();
    announce(r.banked ? `Banked ${r.score} points${pb ? ", a new personal best" : ""}.` : `Raid lost: ${r.reason}.`);
    renderGate();
  },
  onAnnounce: (t) => announce(t),
});

function announce(text: string): void {
  const s = $("gameStatus");
  s.textContent = "";
  window.setTimeout(() => (s.textContent = text), 50);
}

function renderGate(): void {
  const ok = canRaid();
  const running = !!reading?.running;
  $("gameGate").textContent = running
    ? "Squeektoshi is running, so the portal is open."
    : practice.checked ? "Practice override is on. Squeektoshi is asleep." : "Squeektoshi is asleep. Turn on Practice override to raid now.";
  ($("startBtn") as HTMLButtonElement).disabled = game.isRunning || !ok;
  if (!game.isRunning) game.draw();
}

practice.addEventListener("change", renderGate);
$("startBtn").addEventListener("click", () => {
  if (game.start()) $("game").focus({ preventScroll: true });
});
$("puffBtn").addEventListener("click", () => game.puff());
$("dropBtn").addEventListener("click", () => game.dropLowest());
document.querySelectorAll<HTMLButtonElement>(".pad-btn").forEach((b) => {
  const dir = b.dataset.dir ?? "";
  const on = (e: PointerEvent) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); game.setPad(dir, true); };
  const off = () => game.setPad(dir, false);
  b.addEventListener("pointerdown", on);
  b.addEventListener("pointerup", off);
  b.addEventListener("pointercancel", off);
  b.addEventListener("lostpointercapture", off);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  // Keyboard users on the pad: a short nudge per press.
  b.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); game.setPad(dir, true); window.setTimeout(off, 180); }
  });
});

// ---------------- module C: keeper console ----------------
let wallet: Discovered | null = null;
let account = "";
let chainId = "";
let busy = false;

interface TxEntry { id: number; label: string; hash: string; status: "pending" | "confirmed" | "failed" | "error"; note: string; at: number }
const txs: TxEntry[] = [];
let txSeq = 0;

function renderWallet(): void {
  const btn = $("connectBtn");
  const onSepolia = chainId.toLowerCase() === SEPOLIA.chainId;
  if (account) btn.textContent = shortAddr(account);
  else btn.innerHTML = 'Connect<span class="wide-only"> wallet</span>';
  btn.setAttribute("aria-label", account ? `${shortAddr(account)} wallet options${onSepolia ? "" : ", wrong network"}` : "Connect wallet");
  btn.dataset.wrong = account && !onSepolia ? "true" : "false";
  $("walletLine").textContent = account
    ? `Connected ${shortAddr(account)} via ${wallet?.info.name ?? "wallet"} on ${onSepolia ? "Ethereum Sepolia" : `chain ${parseInt(chainId, 16) || "unknown"}. Sending switches to Sepolia`}.`
    : "No wallet connected. Either button asks your wallet to connect first.";
  renderCheckpoint();
}

function renderCheckpoint(): void {
  const cp = checkpoint;
  $("cpPaused").textContent = cp ? (cp.corePaused ? "Paused" : "Running") : "--";
  $("cpNext").textContent = cp ? fmtInt.format(cp.nextRound) : "--";
  $("cpSettled").textContent = cp ? (cp.roundSettled ? "Yes" : "No") : "--";
  const ready = !!cp && cp.roundSettled && !cp.corePaused;
  $<HTMLButtonElement>("checkpointBtn").disabled = !ready || busy;
  $<HTMLButtonElement>("pingBtn").disabled = busy;
  $("checkpointHint").textContent = !cp
    ? cpErr ? "Checkpoint status unavailable; the button stays off until the RPC answers." : "Waiting for the checkpoint status."
    : cp.corePaused ? "The mining core is paused, so a checkpoint cannot run."
    : !cp.roundSettled ? `Round ${fmtInt.format(cp.nextRound)} is not settled yet. The button turns on once it settles.`
    : `Round ${fmtInt.format(cp.nextRound)} is settled. Any wallet can run the checkpoint; it costs only Sepolia gas.`;
}

function renderTxs(): void {
  const list = $("txlog");
  list.replaceChildren(...txs.map((t) => {
    const li = document.createElement("li");
    li.dataset.status = t.status;
    const head = document.createElement("div");
    head.className = "tx-head";
    const label = document.createElement("span");
    label.textContent = t.label;
    const st = document.createElement("span");
    st.className = "tx-status";
    st.textContent = { pending: "Pending", confirmed: "Confirmed", failed: "Reverted", error: "Not sent" }[t.status];
    head.append(label, st);
    li.append(head);
    if (t.hash) {
      const a = document.createElement("a");
      a.href = `${EXPLORER}/tx/${t.hash}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "num hash";
      a.textContent = t.hash;
      li.append(a);
    }
    if (t.note) {
      const p = document.createElement("p");
      p.className = "muted small";
      p.textContent = t.note;
      li.append(p);
    }
    return li;
  }));
  $("txEmpty").hidden = txs.length > 0;
}

function bindProvider(p: Eip1193): void {
  p.on?.("accountsChanged", (accs: unknown) => {
    const list = accs as string[];
    account = list?.[0] ?? "";
    if (!account) wallet = null;
    renderWallet();
  });
  p.on?.("chainChanged", (id: unknown) => { chainId = String(id); renderWallet(); });
}

async function selectSepolia(p: Eip1193): Promise<void> {
  try {
    await ensureSepolia(p);
    chainId = SEPOLIA.chainId;
  } catch (e) {
    // Refresh the actual chain even when a wallet did not emit chainChanged.
    chainId = await p.request({ method: "eth_chainId" }).then(String, () => "");
    throw e;
  } finally {
    renderWallet();
  }
}

async function connect(d: Discovered): Promise<boolean> {
  const note = $("sheetNote");
  note.textContent = `Waiting for ${d.info.name}…`;
  try {
    const accs = (await d.provider.request({ method: "eth_requestAccounts" })) as string[];
    if (!accs?.length) throw new Error("No account was shared.");
    wallet = d;
    account = accs[0];
    chainId = String(await d.provider.request({ method: "eth_chainId" }));
    bindProvider(d.provider);
    try { await selectSepolia(d.provider); } catch (e) { note.textContent = `Connected, but still off Sepolia: ${errText(e)}`; }
    return true;
  } catch (e) {
    note.textContent = errText(e);
    return false;
  }
}

const sheet = $<HTMLDialogElement>("walletSheet");
let afterConnect: (() => void) | null = null;

function renderSheet(): void {
  const list = $("walletList");
  const rows: HTMLElement[] = [];
  const row = (label: string, icon: string, onClick: (() => void) | null, href?: string) => {
    const li = document.createElement("li");
    const el = href ? document.createElement("a") : document.createElement("button");
    el.className = "wallet-row";
    if (href) { (el as HTMLAnchorElement).href = href; (el as HTMLAnchorElement).rel = "noopener"; }
    else (el as HTMLButtonElement).type = "button";
    if (icon) { const img = document.createElement("img"); img.src = icon; img.alt = ""; img.width = 28; img.height = 28; el.append(img); }
    else { const s = document.createElement("span"); s.className = "wallet-ph"; s.setAttribute("aria-hidden", "true"); el.append(s); }
    const t = document.createElement("span"); t.textContent = label; el.append(t);
    if (onClick) el.addEventListener("click", onClick);
    li.append(el);
    rows.push(li);
  };

  if (account) {
    $("sheetTitle").textContent = "Wallet";
    if (chainId.toLowerCase() !== SEPOLIA.chainId && wallet) {
      row("Switch to Ethereum Sepolia", "", async () => {
        try { await selectSepolia(wallet!.provider); renderSheet(); }
        catch (e) { $("sheetNote").textContent = errText(e); }
      });
    }
    row(`Disconnect ${shortAddr(account)}`, wallet?.info.icon ?? "", async () => {
      try { await wallet?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch { /* optional method */ }
      wallet = null; account = ""; chainId = "";
      renderWallet();
      sheet.close();
    });
  } else {
    $("sheetTitle").textContent = "Connect a wallet";
    const found = listWallets();
    for (const d of found) row(d.info.name, d.info.icon, async () => {
      if (await connect(d)) { sheet.close(); const next = afterConnect; afterConnect = null; next?.(); }
    });
    if (!found.length) {
      if (isMobileBrowser()) {
        for (const o of OPEN_IN) row(`Open in ${o.name}`, "", null, o.href(location.href));
      } else {
        const li = document.createElement("li");
        li.className = "muted small";
        li.textContent = "No browser wallet found. Install MetaMask or Rabby, then reload this page.";
        rows.push(li);
      }
    }
  }
  list.replaceChildren(...rows);
}

function openSheet(then?: () => void): void {
  afterConnect = then ?? null;
  $("sheetNote").textContent = "Connects on Ethereum Sepolia. Transactions use Sepolia test ETH only.";
  renderSheet();
  if (!sheet.open) sheet.showModal();
}

$("connectBtn").addEventListener("click", () => openSheet());
$("sheetClose").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

async function sendTx(label: string, to: string, data: string): Promise<void> {
  if (!wallet || !account) { openSheet(() => void sendTx(label, to, data)); return; }
  const entry: TxEntry = { id: ++txSeq, label, hash: "", status: "pending", note: "Confirm in your wallet.", at: Date.now() };
  txs.unshift(entry);
  busy = true;
  renderCheckpoint();
  renderTxs();
  try {
    await selectSepolia(wallet.provider);
    const hash = String(await wallet.provider.request({ method: "eth_sendTransaction", params: [{ from: account, to, value: "0x0", data }] }));
    entry.hash = hash;
    entry.note = "Submitted. Waiting for Sepolia to include it.";
    renderTxs();
    void watchReceipt(entry);
  } catch (e) {
    entry.status = "error";
    entry.note = errText(e);
  } finally {
    busy = false;
    renderCheckpoint();
    renderTxs();
  }
}

async function watchReceipt(entry: TxEntry): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => window.setTimeout(r, 4000));
    try {
      const rc = await rpc<{ status?: string; blockNumber?: string } | null>("eth_getTransactionReceipt", [entry.hash]);
      if (rc) {
        entry.status = rc.status === "0x1" ? "confirmed" : "failed";
        entry.note = rc.status === "0x1"
          ? `Included in block ${fmtInt.format(parseInt(rc.blockNumber ?? "0", 16))}.`
          : "The transaction reverted. Check the explorer for the reason.";
        renderTxs();
        if (entry.status === "confirmed") window.setTimeout(() => void pollCheckpointOnce(), 2000);
        return;
      }
    } catch { /* keep waiting */ }
  }
  entry.note = "Still pending after 4 minutes. Follow it on the explorer.";
  renderTxs();
}

async function pollCheckpointOnce(): Promise<void> {
  try { checkpoint = await fetchCheckpointStatus(); cpErr = ""; } catch (e) { cpErr = errMsg(e); }
  renderCheckpoint();
  renderBanner();
}

$("checkpointBtn").addEventListener("click", () => void sendTx("Run mining checkpoint", MINING, "0xc2c4c5c1"));
$("pingBtn").addEventListener("click", () =>
  void sendTx("Tester ping (0-approve SQK)", SQK_TOKEN,
    "0x095ea7b3000000000000000000000000cd46990f8349057335289ef282c276204b6cdc620000000000000000000000000000000000000000000000000000000000000000"));

// ---------------- boot ----------------
startDiscovery(() => { if (sheet.open && !account) renderSheet(); });
renderPockets([]);
renderScores();
renderAlarm();
renderWallet();
renderTxs();
renderBanner();
renderGate();
window.setInterval(renderUpdated, 1000);
requestAnimationFrame(spin);
void pollStatus();
void pollSlow();
