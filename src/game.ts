// 6-Pocket Raid Drill: a small canvas extraction game around the central Mint Portal.

export const W = 480;
export const H = 360;
const PORTAL = { x: W / 2, y: H / 2, r: 24 };
const POCKETS = 6;
const COLLAPSE_SECONDS = 10;
const DRAIN_PER_SECOND = 7;
const SAFE_RADIUS = 44;

export type RelicKind = "diamond" | "heart" | "seal" | "crown";
export const RELICS: Record<RelicKind, { name: string; slots: number; points: number; color: string }> = {
  diamond: { name: "Sugar Diamond", slots: 1, points: 250, color: "#7fe7ff" },
  heart: { name: "Amber Heart", slots: 1, points: 250, color: "#ff7a8a" },
  seal: { name: "Pristine Seal", slots: 1, points: 220, color: "#c9b6ff" },
  crown: { name: "Hollow Crown", slots: 3, points: 450, color: "#ffc048" },
};

interface Relic { kind: RelicKind; x: number; y: number }
interface Snap { x: number; y: number; hx: number; hy: number; stun: number; cool: number; phase: number }
interface Vent { x: number; y: number; t: number; off: number }

export interface RaidResult { score: number; relics: number; banked: boolean; reason: string; at: number }

export interface GameHooks {
  canStart: () => boolean;
  onHud: (hud: { hp: number; pockets: RelicKind[]; carry: number; collapseIn: number | null; collapsing: boolean; running: boolean }) => void;
  onEnd: (r: RaidResult) => void;
  onAnnounce: (text: string) => void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export class RaidGame {
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private last = 0;
  private raf = 0;
  private keys = new Set<string>();
  private pad = new Set<string>();
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  private px = PORTAL.x;
  private py = PORTAL.y;
  private facing = 1;
  private hp = 100;
  private pockets: RelicKind[] = [];
  private relics: Relic[] = [];
  private snaps: Snap[] = [];
  private vents: Vent[] = [];
  private clock = 0;
  private nextCollapse = 25;
  private collapseLeft: number | null = null;
  private puffCool = 0;
  private puffFx = 0;
  private hitFx = 0;
  private toast = "";
  private toastT = 0;
  private idleMessage = "";

  constructor(private canvas: HTMLCanvasElement, private hooks: GameHooks) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("blur", () => { this.keys.clear(); this.pad.clear(); });
    this.layout();
  }

  get isRunning(): boolean { return this.running; }
  get isCollapsing(): boolean { return this.collapseLeft !== null; }

  setIdleMessage(text: string): void {
    this.idleMessage = text;
    if (!this.running) this.draw();
  }

  setPad(dir: string, on: boolean): void {
    if (on) this.pad.add(dir); else this.pad.delete(dir);
  }

  private resize(): void {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.draw();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    // A held key must be released even if focus moved to Puff, Drop or a form control.
    if (!down) { this.keys.delete(k); return; }
    if (!this.running) return;
    const target = e.target as HTMLElement | null;
    // Leave typing and form controls alone; the canvas and the page body drive the game.
    if (target && target !== this.canvas && target !== document.body && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName)) return;
    const move = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"];
    if (move.includes(k)) {
      e.preventDefault();
      this.keys.add(k);
    } else if (k === " " || k === "spacebar") {
      e.preventDefault();
      this.puff();
    } else if (k === "x") {
      e.preventDefault();
      this.dropLowest();
    }
  }

  private layout(): void {
    this.relics = [];
    this.snaps = [];
    this.vents = [];
    for (let i = 0; i < 5; i++) {
      const p = this.freeSpot(80);
      this.snaps.push({ x: p.x, y: p.y, hx: p.x, hy: p.y, stun: 0, cool: 0, phase: Math.random() * 3 });
    }
    for (let i = 0; i < 3; i++) {
      const p = this.freeSpot(90);
      this.vents.push({ x: p.x, y: p.y, t: Math.random() * 5, off: 0 });
    }
    for (let i = 0; i < 6; i++) this.spawnRelic();
  }

  private freeSpot(minFromPortal: number): { x: number; y: number } {
    for (let tries = 0; tries < 60; tries++) {
      const x = rand(28, W - 28);
      const y = rand(28, H - 28);
      if (dist(x, y, PORTAL.x, PORTAL.y) < minFromPortal) continue;
      const crowded = [...this.snaps, ...this.vents, ...this.relics].some((o) => dist(o.x, o.y, x, y) < 40);
      if (!crowded) return { x, y };
    }
    return { x: rand(28, W - 28), y: rand(28, 60) };
  }

  private spawnRelic(): void {
    const roll = Math.random();
    const kind: RelicKind = roll < 0.3 ? "diamond" : roll < 0.6 ? "heart" : roll < 0.85 ? "seal" : "crown";
    const p = this.freeSpot(60);
    this.relics.push({ kind, ...p });
  }

  start(): boolean {
    if (this.running) return true;
    if (!this.hooks.canStart()) return false;
    this.px = PORTAL.x;
    this.py = PORTAL.y;
    this.hp = 100;
    this.pockets = [];
    this.clock = 0;
    this.nextCollapse = rand(20, 30);
    this.collapseLeft = null;
    this.puffCool = 0;
    this.keys.clear();
    this.pad.clear();
    this.layout();
    this.running = true;
    this.last = performance.now();
    this.say("Raid started. Collect relics and watch for the collapse.");
    this.loop(this.last);
    return true;
  }

  /** Start the 10-second GET OUT phase now (scheduled timer, or the live wheel stopped for 8 s). */
  triggerCollapse(reason: string): void {
    if (!this.running || this.collapseLeft !== null) return;
    this.collapseLeft = COLLAPSE_SECONDS;
    this.say(`Portal collapsing${reason ? ` (${reason})` : ""}. Get back to the Mint Portal within 10 seconds.`);
  }

  puff(): void {
    if (!this.running || this.puffCool > 0) return;
    this.puffCool = 3;
    this.puffFx = 0.35;
    let stunned = 0;
    for (const s of this.snaps) if (dist(s.x, s.y, this.px, this.py) < 80) { s.stun = 2.5; stunned++; }
    for (const v of this.vents) if (dist(v.x, v.y, this.px, this.py) < 80) v.off = 2;
    this.flash(stunned ? `Puff stunned ${stunned} trap${stunned === 1 ? "" : "s"}` : "Puff");
  }

  dropLowest(): void {
    if (!this.running || !this.pockets.length) return;
    let idx = 0;
    this.pockets.forEach((k, i) => { if (RELICS[k].points < RELICS[this.pockets[idx]].points) idx = i; });
    const [kind] = this.pockets.splice(idx, 1);
    const angle = Math.random() * Math.PI * 2;
    this.relics.push({ kind, x: Math.min(W - 16, Math.max(16, this.px + Math.cos(angle) * 34)), y: Math.min(H - 16, Math.max(16, this.py + Math.sin(angle) * 34)) });
    this.flash(`Dropped ${RELICS[kind].name}`);
    this.emitHud();
  }

  private slotsUsed(): number { return this.pockets.reduce((n, k) => n + RELICS[k].slots, 0); }
  private carry(): number { return this.pockets.reduce((n, k) => n + RELICS[k].points, 0); }

  private say(text: string): void { this.hooks.onAnnounce(text); }
  private flash(text: string): void { this.toast = text; this.toastT = 1.6; }

  private end(banked: boolean, reason: string): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    const result: RaidResult = { score: banked ? this.carry() : 0, relics: banked ? this.pockets.length : 0, banked, reason, at: Date.now() };
    this.collapseLeft = null;
    this.idleMessage = banked ? `Banked ${result.score} points` : reason;
    this.emitHud();
    this.draw();
    this.hooks.onEnd(result);
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.draw();
    if (this.running) this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number): void {
    this.clock += dt;
    this.puffCool = Math.max(0, this.puffCool - dt);
    this.puffFx = Math.max(0, this.puffFx - dt);
    this.hitFx = Math.max(0, this.hitFx - dt);
    this.toastT = Math.max(0, this.toastT - dt);

    // Movement.
    const held = (a: string, b: string, p: string) => this.keys.has(a) || this.keys.has(b) || this.pad.has(p);
    let dx = (held("arrowright", "d", "right") ? 1 : 0) - (held("arrowleft", "a", "left") ? 1 : 0);
    let dy = (held("arrowdown", "s", "down") ? 1 : 0) - (held("arrowup", "w", "up") ? 1 : 0);
    if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
    const speed = 125;
    this.px = Math.min(W - 10, Math.max(10, this.px + dx * speed * dt));
    this.py = Math.min(H - 10, Math.max(10, this.py + dy * speed * dt));
    if (dx) this.facing = dx > 0 ? 1 : -1;

    // Pick up relics that fit.
    for (let i = this.relics.length - 1; i >= 0; i--) {
      const r = this.relics[i];
      if (dist(r.x, r.y, this.px, this.py) > 16) continue;
      const info = RELICS[r.kind];
      if (this.slotsUsed() + info.slots > POCKETS) {
        if (this.toastT <= 0) this.flash(`No room for ${info.name}. Press X to drop`);
        continue;
      }
      this.pockets.push(r.kind);
      this.relics.splice(i, 1);
      this.flash(`+${info.points} ${info.name}`);
      window.setTimeout(() => { if (this.running && this.relics.length < 7) this.spawnRelic(); }, 2500);
    }

    // Snap-Jaw traps creep toward a nearby raider and bite on contact.
    for (const s of this.snaps) {
      s.phase += dt;
      s.cool = Math.max(0, s.cool - dt);
      if (s.stun > 0) { s.stun -= dt; continue; }
      const d = dist(s.x, s.y, this.px, this.py);
      // The Mint Portal is a safe zone: traps only chase a raider outside it.
      const safe = dist(this.px, this.py, PORTAL.x, PORTAL.y) < SAFE_RADIUS;
      const chase = d < 110 && !safe;
      const tx = chase ? this.px : s.hx;
      const ty = chase ? this.py : s.hy;
      const td = dist(s.x, s.y, tx, ty);
      if (td > 1) { s.x += ((tx - s.x) / td) * 30 * dt; s.y += ((ty - s.y) / td) * 30 * dt; }
      const fromPortal = dist(s.x, s.y, PORTAL.x, PORTAL.y);
      if (fromPortal < SAFE_RADIUS + 8) {
        const k = fromPortal || 1;
        s.x = PORTAL.x + ((s.x - PORTAL.x) / k) * (SAFE_RADIUS + 8);
        s.y = PORTAL.y + ((s.y - PORTAL.y) / k) * (SAFE_RADIUS + 8);
      }
      if (d < 18 && s.cool <= 0) {
        this.hurt(20);
        s.cool = 1.2;
        const k = d || 1;
        this.px = Math.min(W - 10, Math.max(10, this.px + ((this.px - s.x) / k) * 26));
        this.py = Math.min(H - 10, Math.max(10, this.py + ((this.py - s.y) / k) * 26));
        this.flash("Snap-Jaw bite -20 HP");
      }
    }

    // Spore vents cycle: idle 2.5 s, warn 0.8 s, cloud 1.8 s.
    for (const v of this.vents) {
      v.off = Math.max(0, v.off - dt);
      v.t = (v.t + dt) % 5.1;
      if (v.off <= 0 && v.t > 3.3 && dist(v.x, v.y, this.px, this.py) < 38) this.hurt(18 * dt, false);
    }

    // Collapse schedule and the GET OUT drain.
    if (this.collapseLeft === null && this.clock >= this.nextCollapse) this.triggerCollapse("scheduled");
    if (this.collapseLeft !== null) {
      this.collapseLeft -= dt;
      this.hurt(DRAIN_PER_SECOND * dt, false);
      if (dist(this.px, this.py, PORTAL.x, PORTAL.y) < PORTAL.r) {
        this.end(true, "Banked at the Mint Portal");
        return;
      }
      if (this.collapseLeft <= 0) { this.end(false, "The portal closed with you outside"); return; }
    }
    if (this.hp <= 0) { this.end(false, "Knocked out, loot lost"); return; }
    this.emitHud();
  }

  private hurt(amount: number, fx = true): void {
    this.hp = Math.max(0, this.hp - amount);
    if (fx) this.hitFx = 0.3;
  }

  private emitHud(): void {
    this.hooks.onHud({
      hp: this.hp,
      pockets: [...this.pockets],
      carry: this.carry(),
      collapseIn: this.running ? (this.collapseLeft ?? Math.max(0, this.nextCollapse - this.clock)) : null,
      collapsing: this.collapseLeft !== null,
      running: this.running,
    });
  }

  // ---------- drawing ----------

  draw(): void {
    const c = this.ctx;
    const t = this.reducedMotion ? 0 : performance.now() / 1000;
    c.fillStyle = "#0f1117";
    c.fillRect(0, 0, W, H);
    c.strokeStyle = "#191c27";
    c.lineWidth = 1;
    for (let x = 0; x <= W; x += 24) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); c.stroke(); }
    for (let y = 0; y <= H; y += 24) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }
    // Garden tufts.
    c.fillStyle = "#1d3a2a";
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % W;
      const y = (i * 53 + 17) % H;
      c.fillRect(x, y, 3, 2);
      c.fillRect(x + 1, y - 2, 1, 2);
    }

    const collapsing = this.collapseLeft !== null;
    // Mint Portal and its trap-free ring.
    c.strokeStyle = "#262938"; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.arc(PORTAL.x, PORTAL.y, SAFE_RADIUS, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    const pulse = 1 + Math.sin(t * 3) * 0.06;
    c.lineWidth = 3;
    c.strokeStyle = collapsing ? "#f44a5e" : "#35d07f";
    c.beginPath(); c.arc(PORTAL.x, PORTAL.y, PORTAL.r * pulse, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2;
    c.strokeStyle = "#ffc048";
    c.beginPath(); c.arc(PORTAL.x, PORTAL.y, PORTAL.r * 0.6, 0, Math.PI * 2); c.stroke();
    c.fillStyle = collapsing ? "rgba(244,74,94,0.25)" : "rgba(53,208,127,0.15)";
    c.beginPath(); c.arc(PORTAL.x, PORTAL.y, PORTAL.r * 0.6, 0, Math.PI * 2); c.fill();

    // Spore vents.
    for (const v of this.vents) {
      const phase = v.off > 0 ? "off" : v.t > 3.3 ? "cloud" : v.t > 2.5 ? "warn" : "idle";
      c.fillStyle = "#3a2f1a";
      c.fillRect(v.x - 6, v.y - 6, 12, 12);
      c.fillStyle = "#6b5a2a";
      c.fillRect(v.x - 3, v.y - 3, 6, 6);
      if (phase === "warn") {
        c.strokeStyle = "#ffc048"; c.setLineDash([3, 3]); c.lineWidth = 1;
        c.beginPath(); c.arc(v.x, v.y, 38, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      } else if (phase === "cloud") {
        c.fillStyle = "rgba(173, 214, 90, 0.28)";
        c.beginPath(); c.arc(v.x, v.y, 38, 0, Math.PI * 2); c.fill();
        c.fillStyle = "rgba(173, 214, 90, 0.5)";
        for (let i = 0; i < 6; i++) {
          const a = i + t * 1.5;
          c.fillRect(v.x + Math.cos(a) * 22 - 2, v.y + Math.sin(a) * 18 - 2, 4, 4);
        }
      }
    }

    // Relics.
    for (const r of this.relics) this.drawRelic(r.kind, r.x, r.y + (this.reducedMotion ? 0 : Math.sin(t * 2 + r.x) * 1.5));

    // Snap-Jaws.
    for (const s of this.snaps) {
      const open = s.stun > 0 ? 0.2 : (Math.sin(s.phase * 6) + 1) / 2;
      c.fillStyle = s.stun > 0 ? "#4b5068" : "#b23246";
      c.fillRect(s.x - 9, s.y - 4 - open * 4, 18, 4);
      c.fillRect(s.x - 9, s.y + open * 4, 18, 4);
      c.fillStyle = "#e8e9ef";
      for (let i = -8; i <= 6; i += 4) {
        c.fillRect(s.x + i, s.y - open * 4, 2, 2);
        c.fillRect(s.x + i + 1, s.y + open * 4 - 2, 2, 2);
      }
      if (s.stun > 0) { c.fillStyle = "#9ba1b5"; c.fillRect(s.x - 1, s.y - 16, 2, 2); c.fillRect(s.x + 4, s.y - 14, 2, 2); }
    }

    // Puff ring.
    if (this.puffFx > 0) {
      c.strokeStyle = `rgba(232,233,239,${this.puffFx * 2})`;
      c.lineWidth = 2;
      c.beginPath(); c.arc(this.px, this.py, 80 * (1 - this.puffFx / 0.35) + 10, 0, Math.PI * 2); c.stroke();
    }

    if (this.running || this.idleMessage) this.drawHamster(this.px, this.py);

    // Collapse overlay.
    if (collapsing) {
      const a = 0.18 + (this.reducedMotion ? 0 : (Math.sin(t * 8) + 1) * 0.06);
      c.fillStyle = `rgba(244,74,94,${a})`;
      c.fillRect(0, 0, W, H);
      c.fillStyle = "#f44a5e";
      c.font = "700 40px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      c.textAlign = "center";
      c.fillText("GET OUT", W / 2, 54);
      c.font = "700 18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      c.fillText(`${Math.max(0, this.collapseLeft ?? 0).toFixed(1)} s to the portal`, W / 2, 78);
    }
    if (this.hitFx > 0) { c.fillStyle = `rgba(244,74,94,${this.hitFx})`; c.fillRect(0, 0, W, H); }

    if (this.toastT > 0 && this.running) {
      c.font = "600 14px system-ui, sans-serif";
      c.textAlign = "center";
      const w = c.measureText(this.toast).width + 20;
      c.fillStyle = "rgba(11,11,14,0.85)";
      c.fillRect(W / 2 - w / 2, H - 38, w, 26);
      c.fillStyle = "#e8e9ef";
      c.fillText(this.toast, W / 2, H - 20);
    }

    if (!this.running) {
      c.fillStyle = "rgba(11,11,14,0.72)";
      c.fillRect(0, 0, W, H);
      c.textAlign = "center";
      c.fillStyle = "#e8e9ef";
      c.font = "700 22px system-ui, sans-serif";
      c.fillText(this.idleMessage || "Mint Portal ready", W / 2, H / 2 - 44);
      c.font = "400 15px system-ui, sans-serif";
      c.fillStyle = "#b4b9ca";
      const lines = this.hooks.canStart() ? ["Press Start raid to drop in"] : ["Squeektoshi is asleep.", "Turn on Practice override to raid."];
      lines.forEach((line, i) => c.fillText(line, W / 2, H / 2 + 54 + i * 20));
      this.drawHamster(W / 2, H / 2);
    }
  }

  private drawRelic(kind: RelicKind, x: number, y: number): void {
    const c = this.ctx;
    const col = RELICS[kind].color;
    c.fillStyle = col;
    x = Math.round(x); y = Math.round(y);
    if (kind === "diamond") {
      c.fillRect(x - 2, y - 6, 4, 2); c.fillRect(x - 4, y - 4, 8, 4); c.fillRect(x - 2, y, 4, 4); c.fillRect(x - 1, y + 4, 2, 2);
    } else if (kind === "heart") {
      c.fillRect(x - 5, y - 4, 4, 4); c.fillRect(x + 1, y - 4, 4, 4); c.fillRect(x - 5, y, 10, 2); c.fillRect(x - 3, y + 2, 6, 2); c.fillRect(x - 1, y + 4, 2, 2);
    } else if (kind === "seal") {
      c.fillRect(x - 4, y - 5, 8, 10); c.fillRect(x - 5, y - 4, 10, 8);
      c.fillStyle = "#0f1117"; c.fillRect(x - 1, y - 2, 2, 4);
    } else {
      c.fillRect(x - 8, y, 16, 4); c.fillRect(x - 8, y - 6, 3, 6); c.fillRect(x - 1, y - 8, 3, 8); c.fillRect(x + 5, y - 6, 3, 6);
      c.fillStyle = "#f44a5e"; c.fillRect(x - 1, y + 1, 2, 2);
    }
  }

  private drawHamster(x: number, y: number): void {
    const c = this.ctx;
    x = Math.round(x); y = Math.round(y);
    const f = this.facing;
    c.fillStyle = "#c98a4b"; c.fillRect(x - 8, y - 6, 16, 12);
    c.fillStyle = "#f2dcb4"; c.fillRect(x - 4 * f - (f < 0 ? 6 : 0), y - 1, 6, 6);
    c.fillStyle = "#a86d36"; c.fillRect(x - 6, y - 9, 4, 3); c.fillRect(x + 2, y - 9, 4, 3);
    c.fillStyle = "#0b0b0e"; c.fillRect(x + 4 * f - 1, y - 3, 2, 2);
    c.fillStyle = "#ff9fb0"; c.fillRect(x + 7 * f - (f < 0 ? 1 : 0), y, 2, 2);
    // Pocket pouch shows how full the raider is.
    const fill = this.slotsUsed() / POCKETS;
    if (fill > 0) { c.fillStyle = "#ffc048"; c.fillRect(x - 8, y + 6, Math.max(2, Math.round(16 * fill)), 2); }
  }
}
