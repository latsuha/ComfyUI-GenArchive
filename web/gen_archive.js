import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

/* ───────────────────────────── utilities ───────────────────────────── */

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (label, title, fn, cls = "gaw-btn") => {
  const b = el("button", cls, label);
  if (title) b.title = title;
  b.addEventListener("click", (ev) => { ev.stopPropagation(); fn(ev); });
  return b;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hueOf = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
const catColor = (n) => `hsl(${hueOf(n)} 55% 42%)`;

const A = {
  async get(path) {
    const r = await api.fetchApi(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await api.fetchApi(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      let msg = t;
      try { msg = JSON.parse(t).error || t; } catch (_) { /* plain text */ }
      throw new Error(msg);
    }
    return r.json();
  },
  url(session, rel, thumb, ver) {
    return api.apiURL(
      `/gen_archive/file?session=${encodeURIComponent(session)}&path=${encodeURIComponent(rel)}` +
        (thumb ? `&thumb=${thumb}` : "") + (ver ? `&v=${ver}` : "")
    );
  },
  // image of an archive entry; e.v is a cache-buster that changes whenever the file is edited
  eurl(session, e, thumb) { return this.url(session, e.file, thumb, e.v); },
  // server-rendered colour-corrected preview (max = longest side in px, 0 = full size)
  preview(session, e, p, max) {
    const q = Object.entries(p).map(([k, v]) => `${k}=${Number(v).toFixed(3)}`).join("&");
    return api.apiURL(`/gen_archive/preview?session=${encodeURIComponent(session)}&path=${encodeURIComponent(e.file)}&max=${max}&${q}&v=${e.v || 0}`);
  },
};

let toastEl = null, toastTimer = null;
function toast(msg, ms = 2400) {
  if (!toastEl) { toastEl = el("div", "gaw-toast"); document.body.append(toastEl); }
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, ms);
}

const mouse = { x: 120, y: 120 };
for (const ev of ["mousemove", "pointermove", "mousedown", "pointerdown"]) {
  window.addEventListener(ev, (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, true);
}

let menuEl = null, menuOutside = null, menuKey = null;
// ComfyUI's canvas calls preventDefault() on pointerdown, which suppresses the
// compatibility "mousedown" event - so we must listen to pointerdown as well.
const MENU_EVENTS = ["pointerdown", "mousedown", "touchstart"];
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
  if (menuOutside) { for (const ev of MENU_EVENTS) window.removeEventListener(ev, menuOutside, true); menuOutside = null; }
  if (menuKey) { window.removeEventListener("keydown", menuKey, true); menuKey = null; }
}
function popupMenu(items, x = mouse.x, y = mouse.y) {
  closeMenu();
  const m = el("div", "gaw-menu");
  for (const it of items) {
    if (it.sep) { m.append(el("div", "gaw-menu-sep")); continue; }
    const b = el("button", "gaw-menu-item", it.label);
    b.addEventListener("click", () => { closeMenu(); it.fn(); });
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + "px";
  menuEl = m;
  menuOutside = (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); };
  menuKey = (e) => { if (e.key === "Escape") { closeMenu(); e.stopImmediatePropagation(); e.preventDefault(); } };
  setTimeout(() => {
    if (!menuEl) return;
    for (const ev of MENU_EVENTS) window.addEventListener(ev, menuOutside, true);
    window.addEventListener("keydown", menuKey, true);
  }, 0);
}

/* ───────────────────────── styles ───────────────────────── */

const CSS = `
.gaw-root{position:fixed;inset:0;z-index:9000;background:#14161a;color:#e4e6eb;font:13px/1.4 system-ui,Segoe UI,sans-serif;display:flex;flex-direction:column;outline:none}
.gaw-root *{box-sizing:border-box}
.gaw-top{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#1d2026;border-bottom:1px solid #2c3038;flex-wrap:wrap}
.gaw-sel,.gaw-top input[type=text]{background:#2a2e36;color:#e4e6eb;border:1px solid #3a3f4a;border-radius:6px;padding:5px 8px;font:inherit;max-width:260px}
.gaw-btn{background:#2f343e;color:#e4e6eb;border:1px solid #444a57;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit}
.gaw-btn:hover{background:#3b4150}
.gaw-count{margin-left:auto;color:#9aa1ad}
.gaw-cats{display:flex;gap:6px;flex-wrap:wrap;padding:8px 12px;background:#181b20;border-bottom:1px solid #2c3038;min-height:42px;align-items:center}
.gaw-chip{border:0;border-radius:14px;padding:4px 12px;color:#fff;cursor:pointer;font:inherit;opacity:.92}
.gaw-chip:hover{opacity:1;filter:brightness(1.15)}
.gaw-chip.on{outline:2px solid #fff}
.gaw-chip.new{background:#3a3f4a}
.gaw-hint{color:#7d8491;font-size:12px}
.gaw-gridwrap{flex:1;overflow:auto;padding:12px}
.gaw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--gaw-col,220px),1fr));gap:10px}
.gaw-card{position:relative;aspect-ratio:1;background:#0d0e11;border:2px solid transparent;border-radius:8px;overflow:hidden;cursor:pointer}
.gaw-card img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}
.gaw-card.sel{border-color:#ff5a5f;box-shadow:0 0 0 2px #ff5a5f55}
.gaw-card.cur{border-color:#4aa3ff}
.gaw-card.sel.cur{border-color:#ffb020}
.gaw-card .gaw-id{position:absolute;left:0;bottom:0;right:0;padding:2px 6px;background:#000a;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gaw-card .gaw-tick{position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;background:#ff5a5f;color:#fff;display:none;align-items:center;justify-content:center;font-weight:700}
.gaw-card.sel .gaw-tick{display:flex}
.gaw-badges{position:absolute;left:4px;top:4px;display:flex;flex-direction:column;gap:3px;align-items:flex-start;max-width:80%}
.gaw-badge{font-size:11px;padding:1px 7px;border-radius:9px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.gaw-status{padding:6px 12px;background:#1d2026;border-top:1px solid #2c3038;color:#8b93a1;font-size:12px}
.gaw-empty{color:#8b93a1;padding:40px;text-align:center}
.gaw-lb{position:absolute;inset:0;background:#0b0c0f;display:none;z-index:2}
.gaw-lbbody{position:absolute;inset:0;display:flex}
.gaw-stage{position:relative;flex:1;overflow:hidden;user-select:none;cursor:grab}
.gaw-stage.drag{cursor:grabbing}
.gaw-lbimg{position:absolute;left:50%;top:50%;max-width:none!important;max-height:none!important;transform-origin:center center;pointer-events:none}
.gaw-lbtop{position:absolute;left:0;right:0;top:0;display:flex;gap:8px;align-items:center;padding:8px 12px;background:linear-gradient(#000c,#0000);z-index:3}
.gaw-lbtitle{font-weight:600;margin-right:auto}
.gaw-lbcats{position:absolute;left:0;right:0;bottom:0;display:flex;gap:6px;flex-wrap:wrap;justify-content:center;padding:10px 12px;background:linear-gradient(#0000,#000c);z-index:3}
.gaw-side{width:300px;background:#181b20;border-left:1px solid #2c3038;overflow:auto;padding:12px}
.gaw-side h4{margin:12px 0 6px;font-size:12px;color:#9aa1ad;text-transform:uppercase;letter-spacing:.04em}
.gaw-side h3{margin:0 0 4px;font-size:15px}
.gaw-side .gaw-refimg{width:100%;border-radius:6px;cursor:pointer;background:#000;display:block}
.gaw-side .gaw-refname{font-size:12px;color:#9aa1ad;margin:2px 0 8px;word-break:break-all}
.gaw-side pre{white-space:pre-wrap;word-break:break-word;margin:0;font:12px/1.4 ui-monospace,Consolas,monospace;color:#c9ced8}
.gaw-vers{display:flex;gap:6px;flex-wrap:wrap}
.gaw-ver{width:64px;text-align:center;font-size:11px;cursor:pointer;border:2px solid transparent;border-radius:6px;padding:2px;background:#0d0e11}
.gaw-ver.on{border-color:#4aa3ff}
.gaw-ver img{width:100%;height:56px;object-fit:contain;display:block}
.gaw-menu{position:fixed;z-index:100000;background:#252932;border:1px solid #444a57;border-radius:8px;padding:4px;min-width:200px;box-shadow:0 8px 24px #000a}
.gaw-menu-item{display:block;width:100%;text-align:left;background:none;border:0;color:#e4e6eb;padding:6px 10px;border-radius:5px;cursor:pointer;font:13px system-ui,sans-serif}
.gaw-menu-item:hover{background:#3b4150}
.gaw-menu-sep{height:1px;background:#3a3f4a;margin:4px 2px}
.gaw-toast{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);background:#000d;color:#fff;padding:8px 16px;border-radius:8px;z-index:100001;opacity:0;transition:opacity .25s;pointer-events:none;font:13px system-ui,sans-serif;max-width:80vw}
.gaw-cp{position:absolute;left:12px;top:56px;width:270px;max-height:calc(100% - 150px);overflow:auto;background:#14171cee;border:1px solid #3a3f4a;border-radius:10px;padding:10px 12px;z-index:4;display:none;user-select:none;cursor:default}
.gaw-cp h4{margin:0 0 8px;font-size:13px}
.gaw-cp-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin-bottom:8px}
.gaw-cp-row label{font-size:12px;color:#c9ced8;cursor:pointer}
.gaw-cp-row span{font-size:12px;color:#8b93a1;font-variant-numeric:tabular-nums}
.gaw-cp-row input[type=range]{grid-column:1 / span 2;width:100%;margin:0}
.gaw-seg{display:flex;border:1px solid #444a57;border-radius:8px;overflow:hidden;margin:10px 0 8px}
.gaw-seg button{flex:1;background:#2a2e36;color:#c9ced8;border:0;padding:6px 4px;cursor:pointer;font:12px system-ui,sans-serif}
.gaw-seg button.on{background:#3d7be0;color:#fff}
.gaw-cp-btns{display:flex;gap:6px}
.gaw-cp-btns .gaw-btn{flex:1;white-space:nowrap;padding:5px 6px}
.gaw-btn.primary{background:#3d7be0;border-color:#3d7be0;color:#fff}
.gaw-btn.primary:hover{background:#4d8bf0}
.gaw-btn:disabled{opacity:.5;cursor:default}
.gaw-ver div{word-break:break-all}
.gaw-cp-presets{display:flex;gap:6px;margin-bottom:6px}
.gaw-cp-presets .gaw-sel{flex:1;min-width:0}
.gaw-cp-presets .gaw-btn{padding:4px 8px}
.gaw-cp-gh{display:flex;justify-content:space-between;width:100%;background:none;border:0;padding:0;margin:8px 0 6px;color:#9aa1ad;font:600 11px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;text-align:left}
.gaw-cp-dot{color:#ffb020}
.gaw-modal{position:absolute;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:50}
.gaw-modal-box{background:#1d2026;border:1px solid #3a3f4a;border-radius:12px;padding:16px 18px;width:min(440px,92vw);max-height:80%;overflow:auto}
.gaw-modal-box h3{margin:0 0 10px;font-size:15px}
.gaw-pitem{display:flex;gap:10px;align-items:flex-start;padding:7px 8px;border-radius:6px;cursor:pointer}
.gaw-pitem:hover{background:#2a2e36}
.gaw-pitem small{display:block;color:#8b93a1;font-size:12px}
.gaw-small{font-size:12px;color:#8b93a1;margin-top:6px}
.gaw-toggle{width:100%;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gaw-toggle.on{background:#2e9e4f;border-color:#2e9e4f;color:#fff}
.gaw-toggle.on:hover{background:#38b25c}
.gaw-rp{width:292px}
.gaw-rp-h{margin:10px 0 4px;font:600 11px system-ui,sans-serif;color:#9aa1ad;text-transform:uppercase;letter-spacing:.05em}
.gaw-rp .gaw-seg{margin:0 0 6px}
.gaw-rp .gaw-cp-btns{margin-bottom:6px}
.gaw-rp .gaw-cp-row{margin-bottom:5px}
.gaw-rp[data-kind="color"]{left:auto;right:12px}
.gaw-rp[data-kind="color"] .gaw-ref-only{display:none}
.gaw-toggle.on.skip{background:#a8741a;border-color:#a8741a}
.gaw-keys{width:min(580px,94vw)}
.gaw-krow{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:3px 0;border-bottom:1px solid #262a32}
.gaw-klabel{font-size:13px}
.gaw-kchips{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
.gaw-kchip{display:inline-flex;border:1px solid #444a57;border-radius:6px;overflow:hidden;background:#2a2e36}
.gaw-kchip button{background:none;border:0;color:#e4e6eb;padding:2px 8px;cursor:pointer;font:12px ui-monospace,Consolas,monospace}
.gaw-kchip button:hover{background:#3b4150}
.gaw-kchip .gaw-kx{color:#8b93a1;padding:2px 6px;border-left:1px solid #3a3f4a}
.gaw-kadd{background:none;border:1px dashed #444a57;border-radius:6px;color:#9aa1ad;cursor:pointer;padding:2px 8px}
.gaw-kadd:hover{background:#2a2e36}
.gaw-brushcur{position:absolute;border:1px solid #fff;box-shadow:0 0 0 1px #000a;border-radius:50%;pointer-events:none;display:none;z-index:3;transform:translate(-50%,-50%)}
`;
function injectStyle() {
  if (document.getElementById("gaw-style")) return;
  const s = el("style");
  s.id = "gaw-style";
  s.textContent = CSS;
  document.head.append(s);
}

const wval = (node, name) => node.widgets?.find((w) => w.name === name)?.value;
function setW(node, name, value) {
  const w = node.widgets?.find((x) => x.name === name);
  if (w) { w.value = value; w.callback?.(value); }
}
function currentGraph() { return app.canvas?.graph ?? app.graph; }

/* ───────────────────────── viewer ───────────────────────── */

// colour-correction sliders: k = parameter name used by the server
const signed = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`;
const ADJ = [
  { g: "Tone", k: "exposure", label: "Exposure", min: -3, max: 3, step: 0.05, def: 0, fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV` },
  { g: "Tone", k: "contrast", label: "Contrast", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Tone", k: "gamma", label: "Gamma", min: 0.4, max: 2.5, step: 0.01, def: 1, fmt: (v) => v.toFixed(2) },
  { g: "Color", k: "saturation", label: "Saturation", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Color", k: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Color", k: "temperature", label: "Warmth", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Channels", k: "red", label: "Red", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Channels", k: "green", label: "Green", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Channels", k: "blue", label: "Blue", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Detail", k: "sharpness", label: "Sharpness", min: -100, max: 100, step: 1, def: 0, fmt: signed },
  { g: "Detail", k: "grain", label: "Grain", min: 0, max: 100, step: 1, def: 0, fmt: (v) => String(Math.round(v)) },
  { g: "Detail", k: "grain_size", label: "Grain size", min: 1, max: 6, step: 0.1, def: 1, fmt: (v) => v.toFixed(1), noNeutral: true },
  { g: "Detail", k: "noise", label: "Color noise", min: 0, max: 100, step: 1, def: 0, fmt: (v) => String(Math.round(v)) },
];
// one-line description of a preset, e.g. "Contrast -15 · Saturation -8 · Grain 12"
const presetSummary = (p) => {
  const parts = ADJ.filter((a) => !a.noNeutral && Math.abs((p[a.k] ?? a.def) - a.def) > 1e-4).map((a) => `${a.label} ${a.fmt(p[a.k])}`);
  if ((p.grain || 0) > 0 && Math.abs((p.grain_size ?? 1) - 1) > 1e-4) parts.push(`Grain size ${p.grain_size.toFixed(1)}`);
  return parts.join(" · ") || "neutral";
};
const defaultAdj = () => Object.fromEntries(ADJ.map((a) => [a.k, a.def]));
const verLabel = (v) => {
  const p = [];
  if (v.regen) p.push(`reg_${v.regen}`);
  if (v.color) p.push(`color_${v.color}`);
  if (v.fix) p.push(`fix_${v.fix}`);
  return p.join("+") || "original";
};

// Hotkeys by PHYSICAL key, so they also work with a Ukrainian/Russian keyboard layout.
const hotkey = (e) => {
  const c = e.code || "";
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (c === "BracketLeft") return e.shiftKey ? "{" : "[";
  if (c === "BracketRight") return e.shiftKey ? "}" : "]";
  return e.key;
};
const loadImg = (url) => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error("Could not load an image"));
  im.src = url;
});
// blend modes of the retouch layer: [label, canvas globalCompositeOperation]
const BLENDS = [
  ["Normal", "source-over"], ["Multiply", "multiply"], ["Screen", "screen"], ["Overlay", "overlay"],
  ["Soft light", "soft-light"], ["Hard light", "hard-light"], ["Darken", "darken"], ["Lighten", "lighten"],
  ["Difference", "difference"], ["Color", "color"], ["Luminosity", "luminosity"],
];

// ---- keyboard shortcuts: every action can be re-bound in the ⌨ Keys dialog ----
// A combo is a string like "d", "Space", "Delete", "Shift+[", "Ctrl+z". Letters are matched by the PHYSICAL key.
function comboOf(e) {
  const c = e.code || "";
  let k;
  if (/^Key[A-Z]$/.test(c)) k = c.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(c)) k = c.slice(5);
  else if (c === "BracketLeft") k = "[";
  else if (c === "BracketRight") k = "]";
  else k = e.key;
  if (!k || ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(k)) return "";   // a modifier on its own
  return (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + (k === " " ? "Space" : k);
}
// builds the key event the built-in handlers expect for a combo
function fakeKeyEvent(combo, orig) {
  const parts = combo.split("+");
  const base = parts.pop();
  const shift = parts.includes("Shift");
  let key = base, code = base;
  if (base === "Space") { key = " "; code = "Space"; }
  else if (/^[a-z]$/.test(base)) { key = shift ? base.toUpperCase() : base; code = "Key" + base.toUpperCase(); }
  else if (/^\d$/.test(base)) code = "Digit" + base;
  else if (base === "[") { key = shift ? "{" : "["; code = "BracketLeft"; }
  else if (base === "]") { key = shift ? "}" : "]"; code = "BracketRight"; }
  return {
    key, code, shiftKey: shift, ctrlKey: parts.includes("Ctrl"), altKey: parts.includes("Alt"), metaKey: false, target: orig.target,
    preventDefault: () => orig.preventDefault(), stopImmediatePropagation: () => orig.stopImmediatePropagation(),
  };
}
const ARROWS = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
const prettyKey = (c) => c.split("+").map((p) => (p.length === 1 ? p.toUpperCase() : ARROWS[p] || p)).join("+");

const KEY_CTX = [["grid", "Image grid"], ["lightbox", "Fullscreen view"], ["retouch", "Retouch / color brush editor"]];
// keys[0] is the built-in default that triggers the action internally; all keys listed are the default bindings
const ACTIONS = [
  { id: "g.left", ctx: "grid", label: "Move left", keys: ["ArrowLeft"] },
  { id: "g.right", ctx: "grid", label: "Move right", keys: ["ArrowRight"] },
  { id: "g.up", ctx: "grid", label: "Move up", keys: ["ArrowUp"] },
  { id: "g.down", ctx: "grid", label: "Move down", keys: ["ArrowDown"] },
  { id: "g.home", ctx: "grid", label: "First image", keys: ["Home"] },
  { id: "g.end", ctx: "grid", label: "Last image", keys: ["End"] },
  { id: "g.select", ctx: "grid", label: "Select / deselect the image", keys: ["Space"] },
  { id: "g.open", ctx: "grid", label: "Open fullscreen", keys: ["Enter"] },
  { id: "g.all", ctx: "grid", label: "Select all", keys: ["Ctrl+a"] },
  { id: "g.newcat", ctx: "grid", label: "New category (with the selection)", keys: ["n", "c"] },
  { id: "g.preset", ctx: "grid", label: "Apply a color preset to the selection", keys: ["p"] },
  { id: "g.delete", ctx: "grid", label: "Delete the selection", keys: ["Delete"] },
  { id: "g.refresh", ctx: "grid", label: "Refresh", keys: ["r"] },
  { id: "l.next", ctx: "lightbox", label: "Next image", keys: ["ArrowRight", "d"] },
  { id: "l.prev", ctx: "lightbox", label: "Previous image", keys: ["ArrowLeft", "a"] },
  { id: "l.verprev", ctx: "lightbox", label: "Previous version (original / regenerations)", keys: ["ArrowUp"] },
  { id: "l.vernext", ctx: "lightbox", label: "Next version", keys: ["ArrowDown"] },
  { id: "l.first", ctx: "lightbox", label: "First image", keys: ["Home"] },
  { id: "l.last", ctx: "lightbox", label: "Last image", keys: ["End"] },
  { id: "l.select", ctx: "lightbox", label: "Select / deselect", keys: ["Space"] },
  { id: "l.close", ctx: "lightbox", label: "Close fullscreen", keys: ["Enter", "q"] },
  { id: "l.info", ctx: "lightbox", label: "Show / hide the info panel", keys: ["i"] },
  { id: "l.fit", ctx: "lightbox", label: "Fit / 100% zoom", keys: ["z"] },
  { id: "l.advance", ctx: "lightbox", label: "Auto-advance after adding to a category", keys: ["t"] },
  { id: "l.newcat", ctx: "lightbox", label: "New category", keys: ["n", "c"] },
  { id: "l.delete", ctx: "lightbox", label: "Delete this image", keys: ["Delete"] },
  { id: "l.color", ctx: "lightbox", label: "Show / hide the color panel", keys: ["e"] },
  { id: "l.preset", ctx: "lightbox", label: "Activate / deactivate the selected color preset", keys: ["p"] },
  { id: "l.apply", ctx: "lightbox", label: "Apply the color correction", keys: ["s"] },
  { id: "l.retouch", ctx: "lightbox", label: "Retouch from a reference", keys: ["r"] },
  { id: "l.brush", ctx: "lightbox", label: "Color brush mode", keys: ["b"] },
  { id: "r.move", ctx: "retouch", label: "Move tool", keys: ["m", "v"] },
  { id: "r.brush", ctx: "retouch", label: "Brush", keys: ["b"] },
  { id: "r.erase", ctx: "retouch", label: "Eraser", keys: ["e"] },
  { id: "r.swap", ctx: "retouch", label: "Swap brush / eraser", keys: ["x"] },
  { id: "r.smaller", ctx: "retouch", label: "Smaller brush", keys: ["["] },
  { id: "r.bigger", ctx: "retouch", label: "Bigger brush", keys: ["]"] },
  { id: "r.softer", ctx: "retouch", label: "Softer brush (hardness -)", keys: ["Shift+["] },
  { id: "r.harder", ctx: "retouch", label: "Harder brush (hardness +)", keys: ["Shift+]"] },
  { id: "r.hold", ctx: "retouch", label: "Hold: show the whole layer", keys: ["h"] },
  { id: "r.pan", ctx: "retouch", label: "Pan (hold, then drag)", keys: ["Space"] },
  { id: "r.apply", ctx: "retouch", label: "Apply", keys: ["s"] },
  { id: "r.close", ctx: "retouch", label: "Close the editor", keys: ["r"] },
  { id: "r.undo", ctx: "retouch", label: "Undo", keys: ["Ctrl+z"] },
  { id: "r.redo", ctx: "retouch", label: "Redo", keys: ["Ctrl+Shift+z", "Ctrl+y"] },
];
const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const RT_PASS = new Set(["l.fit", "l.info"]);          // fullscreen actions that still work inside the editor
const RESERVED_KEYS = new Set(["Escape", "Alt+g", "Tab"]);   // fixed (Esc = cancel/close, Alt+G = close viewer)
function loadKeyCfg() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem("gaw.keys") || "{}"); } catch (_) { /* ignore */ }
  const cfg = {};
  for (const [id, v] of Object.entries(raw || {})) {
    if (ACTION_BY_ID[id] && Array.isArray(v) && v.every((s) => typeof s === "string")) cfg[id] = v;
  }
  return cfg;
}

let viewer = null;
function openViewer(opts = {}) {
  injectStyle();
  if (viewer) { viewer.useSession(opts.session); return viewer; }
  viewer = new Viewer(opts);
  return viewer;
}

class Viewer {
  constructor(opts) {
    this.session = opts.session || localStorage.getItem("gaw.session") || "";
    this.data = { entries: [], categories: {}, rev: "" };
    this.byId = new Map();
    this.versions = new Map();
    this.ord = new Map();
    this.view = [];
    this.viewIndex = new Map();
    this.viewKey = "";
    this.selected = new Set();
    this.cards = new Map();
    this.filter = "all";
    this.cursor = 0;
    this.anchor = null;
    this.lbId = null;
    this.autoAdvance = true;
    this.z = { scale: 1, fit: 1, x: 0, y: 0 };
    this.adj = defaultAdj();
    this.cpMode = localStorage.getItem("gaw.cpmode") === "copy" ? "copy" : "overwrite";
    this._shownId = null;
    this._keepView = false;
    this._compare = false;
    this._previewTimer = null;
    this.presets = {};
    this.modal = null;
    this._lastPreset = "";
    this.presetSel = localStorage.getItem("gaw.presetsel") || "";  // preset chosen in the list: stays selected for all images
    this.presetActive = false;      // when on, the selected preset is pre-applied to every image you open
    this._done = new Set();         // images already corrected in this viewer session (never auto-corrected twice)
    this._applying = false;
    this.cpAdvance = localStorage.getItem("gaw.cpadvance") === "1";
    this.rt = null;        // state of the retouch editor while it is open
    this._space = false;   // Space held = pan instead of paint
    this.presetSticky = localStorage.getItem("gaw.presetsticky") === "1";   // keep the preset active when changing image
    this._presetSkipped = false;   // active preset skipped on this image (already edited)
    this.keyCfg = loadKeyCfg();    // user's shortcut overrides
    this._keyCapture = null;       // set while the ⌨ dialog waits for a key
    this._buildKeymap();
    let savedGroups = {};
    try { savedGroups = JSON.parse(localStorage.getItem("gaw.cpgroups") || "{}"); } catch (_) { /* ignore */ }
    this.cpOpen = { Channels: false, ...savedGroups };  // which slider groups are expanded
    this._build();
    this._keyHandler = (e) => this._onKey(e);
    window.addEventListener("keydown", this._keyHandler, true);
    this._keyUpHandler = (e) => this._onKeyUp(e);
    window.addEventListener("keyup", this._keyUpHandler, true);
    this.timer = setInterval(() => this.refresh(false), 15000);
    this.loadSessions().then(() => this.refresh(true));
    this.loadPresets();
    this.root.focus();
  }

  close() {
    clearInterval(this.timer);
    window.removeEventListener("keydown", this._keyHandler, true);
    window.removeEventListener("keyup", this._keyUpHandler, true);
    if (this.rt) { this.rt.active = false; cancelAnimationFrame(this.rt.raf); this.rt = null; }
    closeMenu();
    this.root.remove();
    viewer = null;
  }

  useSession(name) {
    if (name && name !== this.session) { this.session = name; this.selected.clear(); this.filter = "all"; this.loadSessions().then(() => this.refresh(true)); }
  }

  /* ---------- DOM ---------- */
  _build() {
    const root = (this.root = el("div", "gaw-root"));
    root.tabIndex = -1;
    const top = el("div", "gaw-top");
    this.selSession = el("select", "gaw-sel");
    this.selSession.title = "Session";
    this.selSession.addEventListener("change", () => { this.session = this.selSession.value; this.selected.clear(); this.filter = "all"; this.refresh(true); this.selSession.blur(); this.root.focus(); });
    this.selFilter = el("select", "gaw-sel");
    this.selFilter.title = "Filter";
    this.selFilter.addEventListener("change", () => { this.filter = this.selFilter.value; this.cursor = 0; this.renderView(true); this.selFilter.blur(); this.root.focus(); });
    this.range = el("input");
    this.range.type = "range"; this.range.min = 110; this.range.max = 480;
    this.range.value = localStorage.getItem("gaw.col") || 220;
    this.range.title = "Thumbnail size";
    root.style.setProperty("--gaw-col", this.range.value + "px");
    this.range.addEventListener("input", () => { root.style.setProperty("--gaw-col", this.range.value + "px"); localStorage.setItem("gaw.col", this.range.value); });
    this.lblCount = el("span", "gaw-count");
    top.append(
      this.selSession,
      btn("⟳", "Refresh (R)", () => this.refresh(true)),
      this.selFilter,
      this.range,
      btn("⌨ Keys", "Customize the keyboard shortcuts", () => this.openKeysDialog()),
      btn("🎨 Preset…", "Apply a saved color preset to the selected images (P)", () => this.openPresetDialog()),
      btn("🗑 Delete", "Permanently delete the selected images (Delete key)", () => this.deleteSelected()),
      btn("📂 Folder", "Open the session folder in the file explorer", () => this.openFolder("")),
      this.lblCount,
      btn("✕ Close", "Esc", () => this.close())
    );
    this.catBar = el("div", "gaw-cats");
    this.gridWrap = el("div", "gaw-gridwrap");
    this.grid = el("div", "gaw-grid");
    this.gridWrap.append(this.grid);
    this.status = el("div", "gaw-status");
    this._buildLightbox();
    root.append(top, this.catBar, this.gridWrap, this.status, this.lb);
    document.body.append(root);
    this._refreshHints();
  }

  _buildLightbox() {
    const lb = (this.lb = el("div", "gaw-lb"));
    const body = el("div", "gaw-lbbody");
    const stage = (this.stage = el("div", "gaw-stage"));
    this.lbImg = el("img", "gaw-lbimg");
    this.lbImg.draggable = false;
    this.lbImg.addEventListener("load", () => {
      if (this._keepView) { this._keepView = false; return; }  // preview swap: keep zoom/pan
      this._fit();
    });
    this.lbImg.addEventListener("error", () => { this._keepView = false; toast("Could not load the image"); });
    const bar = el("div", "gaw-lbtop");
    this.lbTitle = el("span", "gaw-lbtitle");
    bar.append(
      this.lbTitle,
      btn("◀", "Previous (←)", () => this.lbStep(-1)),
      btn("▶", "Next (→)", () => this.lbStep(1)),
      btn("⌨", "Customize the keyboard shortcuts", () => this.openKeysDialog()),
      btn("🖌 Retouch", "Restore details from a reference image (R)", () => this.toggleRetouch()),
      btn("🎨 Color", "Color correction panel (E)", () => this.toggleColor()),
      btn("ℹ", "Info panel (I)", () => this.toggleSide()),
      btn("🗑", "Permanently delete this image (Delete)", () => this.deleteSelected()),
      btn("✕", "Close (Esc)", () => this.closeLightbox())
    );
    this.lbCats = el("div", "gaw-lbcats");
    this.rtCanvas = el("canvas", "gaw-lbimg");   // retouch editor view (same zoom/pan as the image)
    this.rtCanvas.style.display = "none";
    this.rtCursor = el("div", "gaw-brushcur");
    stage.append(this.rtCanvas, this.lbImg, bar, this.lbCats, this._buildColorPanel(), this._buildRetouchPanel(), this.rtCursor);
    this.side = el("div", "gaw-side");
    body.append(stage, this.side);
    lb.append(body);

    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (this.rt?.active && e.ctrlKey) this._rtWheelScale(e); else this._zoom(e);
    }, { passive: false });
    stage.addEventListener("dblclick", (e) => { if ((e.target === stage || e.target === this.lbImg) && !this.rt?.active) this._toggleFit(); });
    stage.addEventListener("mousedown", (e) => {
      if (e.target !== stage && e.target !== this.lbImg) return;
      if (this.rt?.active && e.button === 0 && !this._space) { e.preventDefault(); this._rtPointerDown(e); return; }
      e.preventDefault();
      stage.classList.add("drag");
      let lx = e.clientX, ly = e.clientY;
      const mv = (m) => { this.z.x += m.clientX - lx; this.z.y += m.clientY - ly; lx = m.clientX; ly = m.clientY; this._applyZ(); };
      const up = () => { stage.classList.remove("drag"); window.removeEventListener("mousemove", mv, true); window.removeEventListener("mouseup", up, true); };
      window.addEventListener("mousemove", mv, true);
      window.addEventListener("mouseup", up, true);
    });
    stage.addEventListener("mousemove", (e) => this._rtCursorMove(e));
    stage.addEventListener("mouseleave", () => { this.rtCursor.style.display = "none"; });
  }

  /* ---------- colour correction panel ---------- */
  _buildColorPanel() {
    const cp = (this.cp = el("div", "gaw-cp"));
    cp.append(el("h4", null, "🎨 Color correction"));
    const prow = el("div", "gaw-cp-presets");
    this.cpPreset = el("select", "gaw-sel");
    this.cpPreset.title = "Saved presets";
    this.cpPreset.addEventListener("change", () => { this.selectPreset(this.cpPreset.value); this.cpPreset.blur(); this.root.focus(); });
    prow.append(
      this.cpPreset,
      btn("💾", "Save the current slider settings as a preset", () => this.savePreset()),
      btn("🗑", "Delete the selected preset", () => this.deletePreset())
    );
    cp.append(prow);
    this.cpActive = el("button", "gaw-btn gaw-toggle");
    this.cpActive.addEventListener("click", () => this.togglePresetActive());
    cp.append(this.cpActive);
    this.cpInputs = {};
    this.cpGroups = {};
    for (const a of ADJ) {
      let grp = this.cpGroups[a.g];
      if (!grp) {
        const g = a.g;
        const head = el("button", "gaw-cp-gh");
        const caption = el("span");
        const dot = el("span", "gaw-cp-dot");
        head.append(caption, dot);
        const body = el("div");
        const setOpen = (open) => { body.style.display = open ? "" : "none"; caption.textContent = (open ? "▾ " : "▸ ") + g; };
        setOpen(this.cpOpen[g] !== false);
        head.addEventListener("click", () => {
          const open = body.style.display === "none";
          setOpen(open);
          this.cpOpen[g] = open;
          localStorage.setItem("gaw.cpgroups", JSON.stringify(this.cpOpen));
        });
        cp.append(head, body);
        grp = this.cpGroups[g] = { head, body, dot };
      }
      const row = el("div", "gaw-cp-row");
      const lab = el("label", null, a.label);
      lab.title = "Double-click to reset";
      const val = el("span");
      const inp = el("input");
      inp.type = "range"; inp.min = a.min; inp.max = a.max; inp.step = a.step; inp.value = a.def;
      inp.addEventListener("input", () => { this.adj[a.k] = Number(inp.value); this._syncColorUI(); this._schedulePreview(); });
      inp.addEventListener("change", () => { inp.blur(); this.root.focus(); });  // keep hotkeys working
      lab.addEventListener("dblclick", () => { this.adj[a.k] = a.def; this._syncColorUI(); this._schedulePreview(); });
      row.append(lab, val, inp);
      grp.body.append(row);
      this.cpInputs[a.k] = { inp, val };
    }
    const seg = (this.cpSeg = el("div", "gaw-seg"));
    for (const [mode, text, title] of [
      ["overwrite", "Overwrite file", "Change the image file itself (you can undo it with Revert)"],
      ["copy", "Save copy", "Keep the original and save <name>_color_N next to it"],
    ]) {
      const b = el("button", null, text);
      b.title = title; b.dataset.mode = mode;
      b.addEventListener("click", () => { this.cpMode = mode; localStorage.setItem("gaw.cpmode", mode); this._syncColorUI(); });
      seg.append(b);
    }
    const row1 = el("div", "gaw-cp-btns");
    this.cpApply = btn("✔ Apply", "Apply to the full-resolution file (S)", () => this.applyAdjust(), "gaw-btn primary");
    row1.append(this.cpApply, btn("Reset", "Reset all sliders", () => { this.adj = defaultAdj(); this._syncColorUI(); this._schedulePreview(); }));
    const row2 = el("div", "gaw-cp-btns");
    row2.style.marginTop = "6px";
    const hold = el("button", "gaw-btn", "👁 Hold: original");
    hold.title = "Press and hold to compare with the original";
    const setCmp = (v) => { if (this._compare !== v) { this._compare = v; this._refreshLbImage(); } };
    hold.addEventListener("pointerdown", () => setCmp(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) hold.addEventListener(ev, () => setCmp(false));
    this.cpRevert = btn("↩ Revert file", "Restore the file as it was before the first overwrite", () => this.revertFile());
    row2.append(hold, this.cpRevert);
    const adv = el("label", "gaw-small");
    adv.style.cssText = "display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:8px";
    const advBox = el("input");
    advBox.type = "checkbox";
    advBox.checked = this.cpAdvance;
    advBox.addEventListener("change", () => {
      this.cpAdvance = advBox.checked;
      localStorage.setItem("gaw.cpadvance", this.cpAdvance ? "1" : "0");
      advBox.blur(); this.root.focus();
    });
    adv.append(advBox, el("span", null, "Go to the next image after Apply"));
    const adv2 = el("label", "gaw-small");
    adv2.style.cssText = "display:flex;gap:6px;align-items:center;cursor:pointer;margin-top:6px";
    const stickBox = el("input");
    stickBox.type = "checkbox";
    stickBox.checked = this.presetSticky;
    stickBox.addEventListener("change", () => {
      this.presetSticky = stickBox.checked;
      localStorage.setItem("gaw.presetsticky", this.presetSticky ? "1" : "0");
      stickBox.blur(); this.root.focus();
    });
    adv2.title = "Off: the preset button switches itself off when you open another image. On: it stays active for every image.";
    adv2.append(stickBox, el("span", null, "Keep the preset active on other images"));
    const keys = (this.cpKeys = el("div", "gaw-small"));
    this.cpPaint = el("button", "gaw-btn gaw-toggle");
    this.cpPaint.addEventListener("click", () => this.toggleColorPaint());
    cp.append(seg, this.cpPaint, row1, row2, adv, adv2, keys);
    cp.addEventListener("wheel", (e) => e.stopPropagation());
    cp.style.display = localStorage.getItem("gaw.cpopen") === "1" ? "block" : "none";
    this._syncColorUI();
    return cp;
  }

  toggleColor() {
    if (this.rt?.active) { toast("Close the retouch first (R)"); return; }
    const open = this.cp.style.display === "none";
    this.cp.style.display = open ? "block" : "none";
    localStorage.setItem("gaw.cpopen", open ? "1" : "0");
    if (!open) {  // closing the panel discards unapplied tweaks (an active preset stays pre-applied)
      this.adj = this._baseAdj(this.byId.get(this.lbId)); this._compare = false;
      this._syncColorUI(); this._refreshLbImage();
    }
  }

  _adjNeutral() { return ADJ.every((a) => a.noNeutral || Math.abs(this.adj[a.k] - a.def) < 1e-4); }

  _syncColorUI() {
    if (!this.cpInputs) return;
    for (const a of ADJ) {
      const { inp, val } = this.cpInputs[a.k];
      const v = this.adj[a.k];
      inp.value = v;
      val.textContent = a.fmt(v);
      val.style.color = Math.abs(v - a.def) > 1e-4 ? "#ffb020" : "";
    }
    for (const [g, ref] of Object.entries(this.cpGroups)) {  // ● marks groups that have changes (even when collapsed)
      ref.dot.textContent = ADJ.some((a) => a.g === g && !a.noNeutral && Math.abs(this.adj[a.k] - a.def) > 1e-4) ? "●" : "";
    }
    if (this.cpPreset) this.cpPreset.value = this.presets[this.presetSel] ? this.presetSel : "";
    if (this.cpActive) {
      const skip = this.presetActive && this._presetSkipped;
      this.cpActive.classList.toggle("on", this.presetActive);
      this.cpActive.classList.toggle("skip", skip);
      const k = this._keyLabel("l.preset");
      this.cpActive.textContent = skip ? `⚡ Preset ON, skipped here (already edited) - click to apply (${k})`
        : this.presetActive ? `⚡ Preset ON: ${this.presetSel} (${k})` : `⚡ Activate selected preset (${k})`;
    }
    if (this.cpPaint) {
      const on = !!(this.rt?.active && this.rt.kind === "color");
      this.cpPaint.classList.toggle("on", on);
      this.cpPaint.textContent = on ? "🖌 Brush mode ON: paint the correction (B)" : "🖌 Paint this correction with a brush (B)";
      this.cpPaint.title = "The image returns to its original colours (sliders stay). Paint to apply the correction only where you want it.";
    }
    for (const b of this.cpSeg.children) b.classList.toggle("on", b.dataset.mode === this.cpMode);
    this.cpApply.textContent = this.cpMode === "copy" ? "✔ Apply (save copy)" : "✔ Apply (overwrite)";
    this.cpRevert.style.display = this.byId.get(this.lbId)?.adjusted ? "" : "none";
  }

  // which image the lightbox should currently show: original or the colour-corrected preview
  // (fresh = a different image was just opened: always use the same preview size so prefetching works)
  _lbUrl(e, fresh) {
    if (this._compare || this._adjNeutral()) return A.eurl(this.session, e);
    return A.preview(this.session, e, this.adj, (fresh || this.z.scale < 0.99) ? 2000 : 0);
  }

  // images already edited (and copies) never get the preset pre-applied a second time
  _presetEligible(e) { return !!e && !e.adjusted && !(e.color > 0 || e.fix > 0) && !this._done.has(e.id); }

  // slider values a freshly opened image starts with: the active preset, or neutral
  _baseAdj(e) {
    const p = this.presets[this.presetSel];
    if (this.presetActive && p && this._presetEligible(e)) return { ...defaultAdj(), ...p };
    return defaultAdj();
  }

  _prefetchPreset(n) {  // let the server render the next image's preview while you look at this one
    const p = this.presets[this.presetSel];
    if (!n || !this.presetActive || !this.presetSticky || !p || n.adjusted || n.color > 0 || n.fix > 0 || this._done.has(n.id)) return;
    const im = new Image();
    im.src = A.preview(this.session, n, { ...defaultAdj(), ...p }, 2000);
  }

  _setLbSrc(url, keepView) {
    if (this.lbImg.dataset.src === url) return false;
    this.lbImg.dataset.src = url;
    this._keepView = !!keepView;
    this.lbImg.src = url;
    return true;
  }

  _refreshLbImage() {
    if (this.rt?.active && this.rt.kind === "color") {   // colour brush: the slider values change the paintable layer
      this._rtRender();
      this._rtReloadColorLayer();
      return;
    }
    const e = this.byId.get(this.lbId);
    if (e) this._setLbSrc(this._lbUrl(e), true);
  }

  _schedulePreview() {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._refreshLbImage(), 80);
  }

  async applyAdjust() {
    if (this.rt?.active && this.rt.kind === "color") { this.rtApply(); return; }   // brush mode: apply the painted mask
    if (this._applying) return;
    const e = this.byId.get(this.lbId);
    if (!e) return;
    if (this._adjNeutral()) { toast("Nothing to apply - move a slider first"); return; }
    const params = { ...this.adj };
    const nextBefore = this.cpAdvance ? this.neighbor(1) : null;
    this._applying = true;
    this.cpApply.disabled = true;
    try {
      const res = await A.post("/gen_archive/adjust", { session: this.session, id: e.id, mode: this.cpMode, params });
      this._done.add(e.id);
      this.adj = defaultAdj(); this._compare = false;
      await this.refresh(true);
      if (nextBefore && this.byId.has(nextBefore.id)) {
        this.gotoId(nextBefore.id);
        toast(res.mode === "copy" ? `Saved a copy: ${res.id}` : `Applied to ${e.id}`, 1300);
      } else if (res.mode === "copy") { this.gotoId(res.id); toast(`Saved a copy: ${res.id}`); }
      else toast(`Applied to ${e.id} (use Revert to undo)`);
    } catch (err) { toast("Error: " + err.message, 4000); }
    finally { this._applying = false; this.cpApply.disabled = false; this._syncColorUI(); }
  }

  async revertFile() {
    const e = this.byId.get(this.lbId);
    if (!e) return;
    try {
      await A.post("/gen_archive/revert", { session: this.session, id: e.id });
      this.adj = defaultAdj(); this._compare = false;
      await this.refresh(true);
      toast(`Restored ${e.id}`);
    } catch (err) { toast("Error: " + err.message, 4000); }
  }

  /* ---------- retouch: restore details from a reference ---------- */
  _buildRetouchPanel() {
    const rp = (this.rp = el("div", "gaw-cp gaw-rp"));
    rp.append(el("h4", null, "🖌 Restore from reference"));
    this.rpSource = el("select", "gaw-sel");
    this.rpSource.style.cssText = "width:100%;margin-bottom:8px";
    this.rpSource.title = "Which image to take the details from";
    this.rpSource.addEventListener("change", () => { this._rtLoadSource(Number(this.rpSource.value)); this.rpSource.blur(); this.root.focus(); });
    rp.append(this.rpSource);

    const tools = (this.rpTools = el("div", "gaw-seg"));
    for (const [t, text, title] of [
      ["move", "✋ Move", "Drag the reference layer to line it up with the image (M). Ctrl+wheel scales it."],
      ["brush", "🖌 Brush", "Paint to bring the reference back (B)"],
      ["erase", "◌ Eraser", "Paint to hide the reference again (E)"],
    ]) {
      const b = el("button", null, text);
      b.title = title; b.dataset.tool = t;
      b.addEventListener("click", () => this._rtSetTool(t));
      tools.append(b);
    }
    rp.append(tools);

    this.rpSliders = {};
    const R = () => this.rt;
    const slider = (key, label, min, max, step, get, set, fmt) => {
      const row = el("div", "gaw-cp-row");
      const val = el("span");
      const inp = el("input");
      inp.type = "range"; inp.min = min; inp.max = max; inp.step = step;
      inp.addEventListener("input", () => { set(Number(inp.value)); this._rtSyncUI(); this._rtRender(); });
      inp.addEventListener("change", () => { inp.blur(); this.root.focus(); });
      row.append(el("label", null, label), val, inp);
      this.rpSliders[key] = { inp, val, get, fmt };
      return row;
    };
    const pct = (v) => `${Math.round(v)}%`;
    this.rpBlend = el("select", "gaw-sel");
    this.rpBlend.style.cssText = "width:100%;margin-bottom:6px";
    for (const [n, v] of BLENDS) { const o = el("option", null, "Blend mode: " + n); o.value = v; this.rpBlend.append(o); }
    this.rpBlend.addEventListener("change", () => { R().blend = this.rpBlend.value; this._rtRender(); this.rpBlend.blur(); this.root.focus(); });

    rp.append(
      el("div", "gaw-rp-h", "Brush"),
      slider("size", "Size", 2, 800, 1, () => R().brush.size, (v) => { R().brush.size = v; }, (v) => `${Math.round(v)} px`),
      slider("hard", "Hardness", 0, 100, 1, () => R().brush.hardness, (v) => { R().brush.hardness = v; }, pct),
      slider("flow", "Flow", 1, 100, 1, () => R().brush.flow, (v) => { R().brush.flow = v; }, pct),
      el("div", "gaw-rp-h", "Reference layer"),
      this.rpBlend,
      slider("opacity", "Opacity", 0, 100, 1, () => R().opacity, (v) => { R().opacity = v; }, pct),
      slider("alignop", "Move view opacity", 5, 100, 1, () => R().alignOpacity, (v) => { R().alignOpacity = v; }, pct),
      slider("scale", "Scale", 20, 300, 0.5, () => R().tf.rel * 100, (v) => { R().tf.rel = v / 100; }, (v) => `${v.toFixed(1)}%`),
      slider("rot", "Rotation", -180, 180, 0.1, () => R().tf.rot, (v) => { R().tf.rot = v; }, (v) => `${v.toFixed(1)}°`)
    );
    const rowL = el("div", "gaw-cp-btns");
    rowL.append(
      btn("⇋ Flip", "Mirror the reference layer horizontally", () => { R().tf.flip = !R().tf.flip; this._rtRender(); }),
      btn("Reset layer", "Center the layer and reset its scale and rotation", () => this._rtResetTf())
    );
    rp.append(rowL, el("div", "gaw-rp-h", "Mask"));
    const rowM = el("div", "gaw-cp-btns");
    rowM.append(
      btn("Fill", "Show the reference everywhere", () => this._rtMaskOp((c, w, h) => { c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); })),
      btn("Clear", "Hide the reference everywhere", () => this._rtMaskOp((c, w, h) => { c.clearRect(0, 0, w, h); })),
      btn("Invert", "Swap shown and hidden areas", () => this._rtMaskOp((c, w, h) => { c.globalCompositeOperation = "xor"; c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); }))
    );
    const rowU = el("div", "gaw-cp-btns");
    this.rpUndo = btn("↶ Undo", "Ctrl+Z", () => this._rtUndo());
    this.rpRedo = btn("↷ Redo", "Ctrl+Shift+Z / Ctrl+Y", () => this._rtRedo());
    rowU.append(this.rpUndo, this.rpRedo);
    const rowH = el("div", "gaw-cp-btns");
    const hold = el("button", "gaw-btn", "👁 Hold: reference");
    hold.title = "Press and hold (or hold H) to see the whole reference layer";
    const setHold = (v) => { if (this.rt && this.rt.hold !== v) { this.rt.hold = v; this._rtRender(); } };
    hold.addEventListener("pointerdown", () => setHold(true));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) hold.addEventListener(ev, () => setHold(false));
    rowH.append(hold);
    const ghostLab = el("label", "gaw-small");
    ghostLab.style.cssText = "display:flex;gap:6px;align-items:center;cursor:pointer;margin:2px 0 8px";
    this.rpGhost = el("input");
    this.rpGhost.type = "checkbox";
    this.rpGhost.addEventListener("change", () => { R().ghost = this.rpGhost.checked; this._rtRender(); this.rpGhost.blur(); this.root.focus(); });
    ghostLab.append(this.rpGhost, el("span", null, "Faint reference overlay while painting"));
    rp.append(rowM, rowU, rowH, ghostLab);

    const seg = (this.rpSeg = el("div", "gaw-seg"));
    for (const [mode, text, title] of [
      ["overwrite", "Overwrite file", "Change the image file itself (Revert can undo it)"],
      ["copy", "Save copy (_fix_N)", "Keep the original and save <name>_fix_N next to it"],
    ]) {
      const b = el("button", null, text);
      b.title = title; b.dataset.mode = mode;
      b.addEventListener("click", () => { this.cpMode = mode; localStorage.setItem("gaw.cpmode", mode); this._syncColorUI(); this._rtSyncUI(); });
      seg.append(b);
    }
    const rowA = el("div", "gaw-cp-btns");
    this.rpApply = btn("✔ Apply", "Render at full resolution and save (S)", () => this.rtApply(), "gaw-btn primary");
    rowA.append(this.rpApply, btn("✕ Close", "Close without saving (R / Esc)", () => this.exitRetouch()));
    this.rpHint = el("div", "gaw-small");
    rp.append(seg, rowA, this.rpHint);
    for (const x of [
      this.rpSource, this.rpBlend, rowL, ghostLab, this.rpTools.querySelector('[data-tool="move"]'),
      ...["opacity", "alignop", "scale", "rot"].map((k) => this.rpSliders[k].inp.parentElement),
      ...[...rp.querySelectorAll(".gaw-rp-h")].filter((h) => h.textContent === "Reference layer"),
    ]) x.classList.add("gaw-ref-only");   // hidden in colour-brush mode
    rp.addEventListener("wheel", (e) => e.stopPropagation());
    rp.style.display = "none";
    return rp;
  }

  // images the layer can be taken from: this image's references and its other versions
  _rtSources(e) {
    const out = [];
    for (const [k, r] of Object.entries(e.refs || {})) {
      out.push({ label: `${k.replace("ref_", "Ref_")}: ${r.orig_name || r.file}`, url: A.url(this.session, r.file) });
    }
    for (const v of this.versions.get(e.base) || []) {
      if (v.id !== e.id) out.push({ label: `Version: ${v.id}`, url: A.eurl(this.session, v) });
    }
    return out;
  }

  // the brush settings (size / hardness / flow) are remembered between images and sessions
  _loadBrush(W, H) {
    let b = {};
    try { b = JSON.parse(localStorage.getItem("gaw.brush") || "{}"); } catch (_) { /* ignore */ }
    const num = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);
    return {
      size: num(b.size, 2, 800, clamp(Math.round(Math.max(W, H) / 20), 10, 400)),
      hardness: num(b.hardness, 0, 100, 60),
      flow: num(b.flow, 1, 100, 100),
    };
  }

  _saveBrush() {
    const rt = this.rt;
    if (!rt) return;
    localStorage.setItem("gaw.brush", JSON.stringify(rt.brush));
    localStorage.setItem("gaw.alignop", String(rt.alignOpacity));
  }

  /* ---------- colour brush: paint a colour correction only where you want it ---------- */
  // shared setup of the brush editor; kind = "ref" (restore from a reference) or "color" (colour brush)
  _rtInit(e, base, kind, sources) {
    const W = base.naturalWidth, H = base.naturalHeight;
    const ws = Math.min(1, 3072 / Math.max(W, H));   // painting/preview resolution (the final render is full size)
    const Wp = Math.max(1, Math.round(W * ws)), Hp = Math.max(1, Math.round(H * ws));
    const mk = () => { const c = document.createElement("canvas"); c.width = Wp; c.height = Hp; return c; };
    const mask = mk();
    const cv = this.rtCanvas;
    cv.width = Wp; cv.height = Hp;
    cv.style.width = W + "px"; cv.style.height = H + "px";
    this.rt = {
      kind, active: true, id: e.id, base, W, H, ws, Wp, Hp,
      mask, mctx: mask.getContext("2d"), tmp: mk(), ub: mk(), ctx: cv.getContext("2d"),
      sources, ref: null, tf: { cx: W / 2, cy: H / 2, rel: 1, cover: 1, rot: 0, flip: false },
      tool: kind === "color" ? "brush" : "move", brush: this._loadBrush(W, H),
      alignOpacity: Number(localStorage.getItem("gaw.alignop")) || 50,
      opacity: 100, blend: "source-over", ghost: false, hold: false,
      undo: [], redo: [], stroke: null, raf: 0, layerToken: 0,
    };
    this.rp.dataset.kind = kind;
    this.rp.querySelector("h4").textContent = kind === "color" ? "🎨 Color brush" : "🖌 Restore from reference";
    this.rpSliders.flow.inp.parentElement.firstChild.textContent = kind === "color" ? "Intensity" : "Flow";
    return this.rt;
  }

  // B: the image goes back to its original colours while your sliders / preset stay as they are;
  // paint over the image to apply the correction only there (Intensity = how strongly it builds up)
  async toggleColorPaint() {
    if (this.rt?.active) {
      if (this.rt.kind === "color") this.exitRetouch(); else toast("Close the retouch first (R)");
      return;
    }
    const e = this.byId.get(this.lbId);
    if (!e) return;
    if (this.cp.style.display === "none") { this.cp.style.display = "block"; localStorage.setItem("gaw.cpopen", "1"); }
    toast("Loading the full-size image…", 1200);
    let base;
    try { base = await loadImg(A.eurl(this.session, e)); } catch (err) { toast(err.message); return; }
    if (this.lbId !== e.id || this.rt?.active) return;
    this._rtInit(e, base, "color", []);
    this._compare = false;
    this.lbImg.style.visibility = "hidden";
    this.rtCanvas.style.display = "block";
    this.rp.style.display = "block";
    this._rtSetTool("brush");
    this._syncColorUI();
    await this._rtReloadColorLayer();
    toast(this._adjNeutral() ? "Brush mode: set the color sliders (or activate a preset), then paint" : "Brush mode: paint where the correction should apply", 3500);
  }

  // the "layer" of the colour brush is the image with the current slider values applied (rendered by the server)
  async _rtReloadColorLayer() {
    const rt = this.rt;
    if (!rt?.active || rt.kind !== "color") return;
    const e = this.byId.get(rt.id);
    if (!e) return;
    const url = this._adjNeutral() ? A.eurl(this.session, e) : A.preview(this.session, e, this.adj, 3072);
    const token = ++rt.layerToken;
    try {
      const im = await loadImg(url);
      if (this.rt !== rt || token !== rt.layerToken) return;   // a newer slider value superseded this one
      rt.ref = im;
      rt.tf.cover = Math.max(rt.W / im.naturalWidth, rt.H / im.naturalHeight);
      this._rtRender();
    } catch (err) { toast(err.message); }
  }

  async toggleRetouch() {
    if (this.rt?.active) { this.exitRetouch(); return; }
    const e = this.byId.get(this.lbId);
    if (!e) return;
    const sources = this._rtSources(e);
    if (!sources.length) { toast("This image has no reference images or other versions to restore from"); return; }
    toast("Loading the full-size image…", 1500);
    let base;
    try { base = await loadImg(A.eurl(this.session, e)); } catch (err) { toast(err.message); return; }
    if (this.lbId !== e.id || this.rt?.active) return;
    this._rtInit(e, base, "ref", sources);
    const cv = this.rtCanvas;
    // retouch works on the original: leave the colour panel and drop pending colour tweaks
    this._cpWasOpen = this.cp.style.display !== "none";
    this.cp.style.display = "none";
    this.adj = defaultAdj(); this._compare = false; this._refreshLbImage();
    this.lbImg.style.visibility = "hidden";
    cv.style.display = "block";
    this.rp.style.display = "block";
    this.rpSource.innerHTML = "";
    sources.forEach((s, i) => { const o = el("option", null, s.label); o.value = String(i); this.rpSource.append(o); });
    this._rtSyncUI();
    await this._rtLoadSource(0);
    toast("Retouch: line the layer up with ✋ Move, then paint with 🖌 Brush", 3500);
  }

  exitRetouch(force) {
    const rt = this.rt;
    if (!rt?.active) return true;
    if (!force && rt.undo.length && !window.confirm("Discard the unsaved retouch?")) return false;
    rt.active = false;
    cancelAnimationFrame(rt.raf);
    this.rtCanvas.style.display = "none";
    this.lbImg.style.visibility = "";
    this.rp.style.display = "none";
    this.rtCursor.style.display = "none";
    this.stage.style.cursor = "";
    if (this._cpWasOpen) this.cp.style.display = "block";
    this.rt = null;
    this._space = false;
    this.rp.dataset.kind = "";
    if (rt.kind !== "color") this.adj = this._baseAdj(this.byId.get(this.lbId));   // the colour brush keeps your sliders
    this._syncColorUI(); this._refreshLbImage();
    return true;
  }

  async _rtLoadSource(i) {
    const rt = this.rt;
    const s = rt?.sources[i];
    if (!s) return;
    try {
      const im = await loadImg(s.url);
      if (this.rt !== rt) return;
      rt.ref = im;
      rt.tf.cover = Math.max(rt.W / im.naturalWidth, rt.H / im.naturalHeight);   // "cover" fit = 100%
      this.rpSource.value = String(i);
      this._rtResetTf();
    } catch (err) { toast(err.message); }
  }

  _rtResetTf() {
    const rt = this.rt, tf = rt.tf;
    tf.cx = rt.W / 2; tf.cy = rt.H / 2; tf.rel = 1; tf.rot = 0; tf.flip = false;
    this._rtSyncUI(); this._rtRender();
  }

  _rtSetTool(t) {
    const rt = this.rt;
    if (!rt) return;
    rt.tool = t;
    this.rtCursor.style.display = "none";
    this.stage.style.cursor = t === "move" ? "move" : "crosshair";
    this._rtSyncUI(); this._rtRender();
  }

  _rtSyncUI() {
    const rt = this.rt;
    if (!rt || !this.rpSliders) return;
    for (const s of Object.values(this.rpSliders)) { const v = s.get(); s.inp.value = v; s.val.textContent = s.fmt(v); }
    for (const b of this.rpTools.children) b.classList.toggle("on", b.dataset.tool === rt.tool);
    for (const b of this.rpSeg.children) b.classList.toggle("on", b.dataset.mode === this.cpMode);
    this.rpSeg.children[1].textContent = rt.kind === "color" ? "Save copy (_color_N)" : "Save copy (_fix_N)";
    this.rpBlend.value = rt.blend;
    this.rpGhost.checked = rt.ghost;
    this.rpUndo.disabled = !rt.undo.length;
    this.rpRedo.disabled = !rt.redo.length;
    this.rpApply.textContent = this.cpMode === "copy" ? "✔ Apply (save copy)" : "✔ Apply (overwrite)";
    this._saveBrush();
  }

  // ---- compositing (the same code draws the preview and the full-size result) ----
  _rtDrawLayer(ctx, k) {
    const rt = this.rt, im = rt.ref, tf = rt.tf, s = tf.cover * tf.rel * k;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(tf.cx * k, tf.cy * k);
    ctx.rotate(tf.rot * Math.PI / 180);
    ctx.scale(tf.flip ? -s : s, s);
    ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2);
    ctx.restore();
  }

  // k = scale from original pixels to the target canvas; o = { align, hold, ghost, tmp }
  _rtCompose(ctx, W, H, k, o = {}) {
    const rt = this.rt;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(rt.base, 0, 0, W, H);
    if (rt.ref && !(rt.kind === "color" && this._compare)) {   // (colour brush + "Hold: original" = no layer)
      if (o.align || o.hold) {            // aligning / looking at the whole reference
        ctx.globalAlpha = o.hold ? 1 : rt.alignOpacity / 100;
        this._rtDrawLayer(ctx, k);
      } else {
        if (o.ghost) { ctx.globalAlpha = 0.28; this._rtDrawLayer(ctx, k); ctx.globalAlpha = 1; }
        const tmp = o.tmp || document.createElement("canvas");
        if (tmp.width !== W || tmp.height !== H) { tmp.width = W; tmp.height = H; }
        const t = tmp.getContext("2d");
        t.globalCompositeOperation = "source-over";
        t.globalAlpha = 1;
        t.clearRect(0, 0, W, H);
        this._rtDrawLayer(t, k);
        t.globalCompositeOperation = "destination-in";   // keep the layer only where the mask is painted
        t.drawImage(rt.mask, 0, 0, W, H);
        t.globalCompositeOperation = "source-over";
        ctx.globalAlpha = rt.opacity / 100;
        ctx.globalCompositeOperation = rt.blend;
        ctx.drawImage(tmp, 0, 0);
      }
    }
    ctx.restore();
  }

  _rtRender() {
    const rt = this.rt;
    if (!rt || !rt.active || rt.raf) return;
    rt.raf = requestAnimationFrame(() => {
      rt.raf = 0;
      if (this.rt !== rt || !rt.active) return;
      this._rtCompose(rt.ctx, rt.Wp, rt.Hp, rt.ws, {
        align: rt.tool === "move" && !rt.hold, hold: rt.hold, ghost: rt.ghost && rt.tool !== "move", tmp: rt.tmp,
      });
    });
  }

  // ---- pointer handling ----
  _rtImgPt(e) {   // mouse position -> pixel position in the original image
    const r = this.stage.getBoundingClientRect(), rt = this.rt;
    return {
      x: rt.W / 2 + (e.clientX - (r.left + r.width / 2) - this.z.x) / this.z.scale,
      y: rt.H / 2 + (e.clientY - (r.top + r.height / 2) - this.z.y) / this.z.scale,
    };
  }

  _rtPointerDown(e) {
    const rt = this.rt;
    const p0 = this._rtImgPt(e);
    let mv, up;
    const finish = () => { window.removeEventListener("mousemove", mv, true); window.removeEventListener("mouseup", up, true); };
    if (rt.tool === "move") {
      if (!rt.ref) return;
      let last = p0;
      mv = (m) => { if (!this.rt?.active) return; const p = this._rtImgPt(m); rt.tf.cx += p.x - last.x; rt.tf.cy += p.y - last.y; last = p; this._rtRender(); };
      up = () => finish();
    } else {
      if (!rt.ref) { toast("Choose a reference layer first"); return; }
      const u = rt.ub.getContext("2d");   // remember the mask before the stroke (for undo)
      u.globalCompositeOperation = "copy";
      u.drawImage(rt.mask, 0, 0);
      u.globalCompositeOperation = "source-over";
      rt.stroke = { last: p0, box: null };
      this._rtDab(p0.x, p0.y);
      this._rtRender();
      mv = (m) => { if (!this.rt?.stroke) return; this._rtCursorMove(m); this._rtStrokeTo(this._rtImgPt(m)); this._rtRender(); };
      up = () => { finish(); this._rtEndStroke(); };
    }
    window.addEventListener("mousemove", mv, true);
    window.addEventListener("mouseup", up, true);
  }

  _rtCursorMove(e) {
    const rt = this.rt, c = this.rtCursor;
    if (!rt?.active || rt.tool === "move" || (e.target !== this.stage && !rt.stroke)) { c.style.display = "none"; return; }
    const r = this.stage.getBoundingClientRect(), d = Math.max(4, rt.brush.size * this.z.scale);
    c.style.display = "block";
    c.style.width = d + "px"; c.style.height = d + "px";
    c.style.left = (e.clientX - r.left) + "px"; c.style.top = (e.clientY - r.top) + "px";
  }

  _rtWheelScale(e) {   // Ctrl+wheel: scale the layer around the mouse pointer
    const rt = this.rt;
    if (!rt.ref) return;
    const p = this._rtImgPt(e), tf = rt.tf;
    const rel = clamp(tf.rel * (e.deltaY < 0 ? 1.04 : 1 / 1.04), 0.2, 3), g = rel / tf.rel;
    tf.cx = p.x + (tf.cx - p.x) * g; tf.cy = p.y + (tf.cy - p.y) * g; tf.rel = rel;
    this._rtSyncUI(); this._rtRender();
  }

  // ---- brush ----
  _rtDab(x, y) {
    const rt = this.rt, m = rt.mctx, ws = rt.ws;
    const r = Math.max(0.6, rt.brush.size / 2 * ws), cx = x * ws, cy = y * ws;
    const hard = Math.min(0.99, rt.brush.hardness / 100);
    const g = m.createRadialGradient(cx, cy, r * hard, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${rt.brush.flow / 100})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    m.globalCompositeOperation = rt.tool === "erase" ? "destination-out" : "source-over";
    m.fillStyle = g;
    m.fillRect(cx - r, cy - r, r * 2, r * 2);
    m.globalCompositeOperation = "source-over";
    const b = rt.stroke.box;
    if (!b) rt.stroke.box = { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
    else { b.x0 = Math.min(b.x0, cx - r); b.y0 = Math.min(b.y0, cy - r); b.x1 = Math.max(b.x1, cx + r); b.y1 = Math.max(b.y1, cy + r); }
  }

  _rtStrokeTo(p) {
    const rt = this.rt, s = rt.stroke, a = s.last;
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    const step = Math.max(0.5 / rt.ws, rt.brush.size * 0.12);
    const n = Math.floor(dist / step);
    if (!n) return;
    for (let i = 1; i <= n; i++) {
      const t = (i * step) / dist;
      this._rtDab(a.x + (p.x - a.x) * t, a.y + (p.y - a.y) * t);
    }
    const t = (n * step) / dist;
    s.last = { x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t };
  }

  _rtEndStroke() {
    const rt = this.rt, s = rt?.stroke;
    if (!rt) return;
    rt.stroke = null;
    if (!s?.box) return;
    const x = Math.max(0, Math.floor(s.box.x0)), y = Math.max(0, Math.floor(s.box.y0));
    const w = Math.min(rt.Wp, Math.ceil(s.box.x1)) - x, h = Math.min(rt.Hp, Math.ceil(s.box.y1)) - y;
    if (w <= 0 || h <= 0) return;
    const before = rt.ub.getContext("2d").getImageData(x, y, w, h);
    const after = rt.mctx.getImageData(x, y, w, h);
    this._rtPushPatch({ x, y, w, h }, before, after);
  }

  // ---- mask history (small patches instead of whole-canvas copies) ----
  _rtPushPatch(box, before, after) {
    const rt = this.rt;
    rt.undo.push({ ...box, before, after });
    rt.redo = [];
    const size = (p) => p.before.data.length + p.after.data.length;
    let total = rt.undo.reduce((a, p) => a + size(p), 0);
    while (total > 240e6 && rt.undo.length > 1) total -= size(rt.undo.shift());
    this._rtSyncUI();
  }

  _rtMaskOp(fn) {
    const rt = this.rt;
    if (!rt) return;
    const { Wp, Hp, mctx } = rt;
    const before = mctx.getImageData(0, 0, Wp, Hp);
    mctx.save();
    fn(mctx, Wp, Hp);
    mctx.restore();
    const after = mctx.getImageData(0, 0, Wp, Hp);
    this._rtPushPatch({ x: 0, y: 0, w: Wp, h: Hp }, before, after);
    this._rtRender();
  }

  _rtUndo() {
    const rt = this.rt, p = rt?.undo.pop();
    if (!p) return;
    rt.mctx.putImageData(p.before, p.x, p.y);
    rt.redo.push(p);
    this._rtSyncUI(); this._rtRender();
  }

  _rtRedo() {
    const rt = this.rt, p = rt?.redo.pop();
    if (!p) return;
    rt.mctx.putImageData(p.after, p.x, p.y);
    rt.undo.push(p);
    this._rtSyncUI(); this._rtRender();
  }

  // ---- keyboard ----
  _keyRetouch(e, k) {   // returns true when the key was consumed by the retouch editor
    const rt = this.rt;
    const step = e.shiftKey ? 10 : 1;
    if (k === " ") { this._space = true; return true; }
    if ((k === "m" || k === "v") && rt.kind !== "color") this._rtSetTool("move");
    else if (k === "b") this._rtSetTool("brush");
    else if (k === "e") this._rtSetTool("erase");
    else if (k === "x") this._rtSetTool(rt.tool === "brush" ? "erase" : "brush");   // swap brush <-> eraser
    else if (k === "[") { rt.brush.size = Math.max(2, Math.round(rt.brush.size * 0.85)); this._rtSyncUI(); }
    else if (k === "]") { rt.brush.size = Math.min(800, Math.round(rt.brush.size * 1.18) + 1); this._rtSyncUI(); }
    else if (k === "{") { rt.brush.hardness = Math.max(0, rt.brush.hardness - 10); this._rtSyncUI(); }
    else if (k === "}") { rt.brush.hardness = Math.min(100, rt.brush.hardness + 10); this._rtSyncUI(); }
    else if (k === "h") { if (!rt.hold) { rt.hold = true; this._rtRender(); } }
    else if (k === "s") this.rtApply();
    else if (k === "r" || k === "Escape") this.exitRetouch();
    else if (k.startsWith("Arrow") && rt.tool === "move" && rt.ref) {
      if (k === "ArrowLeft") rt.tf.cx -= step;
      else if (k === "ArrowRight") rt.tf.cx += step;
      else if (k === "ArrowUp") rt.tf.cy -= step;
      else rt.tf.cy += step;
      this._rtRender();
    } else if (k === "z" || k === "i") return false;   // zoom-to-fit and the info panel still work
    return true;                                         // everything else is ignored while retouching
  }

  _onKeyUp(e) {
    let k = hotkey(e);
    const combo = comboOf(e);
    if (combo && this.rt?.active) {   // the key may have been re-assigned in the ⌨ dialog
      const canon = this._translateKey(combo);
      if (canon) k = hotkey(fakeKeyEvent(canon, e));
    }
    if (k === "h" && this.rt?.hold) { this.rt.hold = false; this._rtRender(); }
    if (k === " ") this._space = false;
  }

  // ---- save ----
  async rtApply() {
    const rt = this.rt;
    if (!rt?.active || this._applying) return;
    if (!rt.ref) { toast("Choose a reference layer first"); return; }
    if (!rt.undo.length) { toast("Nothing to apply - paint with the brush first"); return; }
    this._applying = true;
    this.rpApply.disabled = true;
    toast("Rendering at full resolution…", 60000);
    try {
      let r;
      if (rt.kind === "color") {   // colour brush: send the mask + slider values, the server renders at full size
        if (this._adjNeutral()) throw new Error("set some color sliders (or activate a preset) first");
        const maskBlob = await new Promise((resolve) => rt.mask.toBlob(resolve, "image/png"));
        if (!maskBlob) throw new Error("could not export the brush mask");
        const q = `session=${encodeURIComponent(this.session)}&id=${encodeURIComponent(rt.id)}&mode=${this.cpMode}&params=${encodeURIComponent(JSON.stringify(this.adj))}`;
        r = await api.fetchApi(`/gen_archive/adjust_masked?${q}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: maskBlob });
      } else {
        const full = document.createElement("canvas");
        full.width = rt.W; full.height = rt.H;
        this._rtCompose(full.getContext("2d"), rt.W, rt.H, 1, {});
        const blob = await new Promise((resolve) => full.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("the browser could not render the full-size image");
        const q = `session=${encodeURIComponent(this.session)}&id=${encodeURIComponent(rt.id)}&mode=${this.cpMode}`;
        r = await api.fetchApi(`/gen_archive/retouch?${q}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
      }
      const txt = await r.text();
      let res = {};
      try { res = JSON.parse(txt); } catch (_) { /* plain text error */ }
      if (!r.ok) throw new Error(res.error || txt);
      const id = rt.id;
      this._done.add(id);
      if (rt.kind === "color") this.adj = defaultAdj();   // the correction is now in the file
      this.exitRetouch(true);
      await this.refresh(true);
      if (res.mode === "copy") { this.gotoId(res.id); toast(`Saved a copy: ${res.id}`); }
      else toast(`Retouch applied to ${id} (use Revert to undo)`);
    } catch (err) { toast("Error: " + err.message, 5000); }
    finally { this._applying = false; if (this.rpApply) this.rpApply.disabled = false; }
  }

  /* ---------- keyboard shortcuts ---------- */
  _bindings(a) { return [...(this.keyCfg[a.id] ?? a.keys)]; }

  _buildKeymap() {
    this.keymap = { grid: new Map(), lightbox: new Map(), retouch: new Map() };
    for (const a of ACTIONS) {
      for (const c of this._bindings(a)) {
        if (!this.keymap[a.ctx].has(c)) this.keymap[a.ctx].set(c, { id: a.id, canon: a.keys[0] });
      }
    }
  }

  _setBindings(a, list) {
    const uniq = [...new Set(list)];
    if (JSON.stringify(uniq) === JSON.stringify(a.keys)) delete this.keyCfg[a.id]; else this.keyCfg[a.id] = uniq;
    localStorage.setItem("gaw.keys", JSON.stringify(this.keyCfg));
    this._buildKeymap();
    this._refreshHints();
    this._syncColorUI();
  }

  _keyLabel(id) {
    const a = ACTION_BY_ID[id];
    const b = a ? this._bindings(a) : [];
    return b.length ? b.map(prettyKey).join("/") : "—";
  }

  // string = the default key the built-in handler expects, null = swallow, undefined = not an action key
  _xlat(ctx, combo, only) {
    const hit = this.keymap[ctx].get(combo);
    if (hit && (!only || only.has(hit.id))) return hit.canon;
    for (const a of ACTIONS) {   // a default key that was re-assigned or removed must stop working
      if (a.ctx === ctx && (!only || only.has(a.id)) && a.keys.includes(combo)) return null;
    }
    return undefined;
  }

  _translateKey(combo) {
    let r;
    if (!this.lbId) r = this._xlat("grid", combo);
    else if (!this.rt?.active) r = this._xlat("lightbox", combo);
    else {
      r = this._xlat("retouch", combo);
      if (r === undefined) r = this._xlat("lightbox", combo, RT_PASS);
    }
    return r === undefined ? combo : r;
  }

  // hint lines that mention keys follow your bindings
  _refreshHints() {
    const K = (id) => this._keyLabel(id);
    if (this.status) {
      this.status.textContent = `Click / ${K("g.select")}: select · ${K("g.open")} / double-click: fullscreen · 1-9: add to category · ${K("g.newcat")}: new category · ${K("g.all")}: select all · Esc: clear selection / close · ${K("g.refresh")}: refresh · ${K("g.preset")}: apply color preset · ${K("g.delete")}: delete · ⌨ Keys: customize`;
    }
    if (this.cpKeys) this.cpKeys.textContent = `Hotkeys: ${K("l.preset")} activate preset · ${K("l.apply")} apply · ${K("l.brush")} brush mode · ${K("l.color")} hide panel`;
    if (this.rpHint) {
      this.rpHint.textContent = `${K("r.brush")} brush · ${K("r.erase")} eraser · ${K("r.swap")} swap · ${K("r.move")} move · ${K("r.smaller")} ${K("r.bigger")} size · ${K("r.softer")} ${K("r.harder")} hardness · ${K("r.hold")} hold layer · ${K("r.pan")}+drag pan · ${K("r.undo")} undo`;
    }
  }

  openKeysDialog() {
    if (this.modal) return;
    const wrap = el("div", "gaw-modal");
    const box = el("div", "gaw-modal-box gaw-keys");
    box.append(el("h3", null, "⌨ Keyboard shortcuts"));
    box.append(el("div", "gaw-small", "Click a key to change it, × removes it, ＋ adds another key. Digits 1-9 (categories), Esc and Alt+G are fixed. A key only needs to be unique within its own group."));
    const body = el("div");
    const foot = el("div", "gaw-small");
    foot.style.minHeight = "18px";
    const stopCapture = () => { this._keyCapture = null; foot.textContent = ""; };

    const capture = (a, index) => {
      foot.textContent = `Press the new key for “${a.label}” (Esc = cancel)…`;
      this._keyCapture = (e) => {
        if (e.key === "Escape") { stopCapture(); return; }
        const combo = comboOf(e);
        if (!combo) return;                      // only a modifier so far: wait for the real key
        if (RESERVED_KEYS.has(combo) || /^\d$/.test(combo) || combo.endsWith("+")) {
          foot.textContent = `“${prettyKey(combo)}” is reserved - press another key (Esc = cancel)…`;
          return;
        }
        const clash = ACTIONS.find((x) => x.ctx === a.ctx && x.id !== a.id && this._bindings(x).includes(combo));
        if (clash && !window.confirm(`“${prettyKey(combo)}” is already used for “${clash.label}”.\nUse it for “${a.label}” instead?`)) { stopCapture(); return; }
        if (clash) this._setBindings(clash, this._bindings(clash).filter((c) => c !== combo));
        const list = this._bindings(a);
        if (index >= 0) list[index] = combo; else list.push(combo);
        this._setBindings(a, list);
        stopCapture();
        render();
      };
    };

    const render = () => {
      body.innerHTML = "";
      for (const [ctx, title] of KEY_CTX) {
        body.append(el("div", "gaw-rp-h", title));
        for (const a of ACTIONS.filter((x) => x.ctx === ctx)) {
          const row = el("div", "gaw-krow");
          row.append(el("span", "gaw-klabel", a.label));
          const chips = el("span", "gaw-kchips");
          const list = this._bindings(a);
          list.forEach((c, i) => {
            const chip = el("span", "gaw-kchip");
            const b = el("button", null, prettyKey(c));
            b.title = "Click, then press the new key";
            b.addEventListener("click", () => capture(a, i));
            const x = el("button", "gaw-kx", "×");
            x.title = "Remove this key";
            x.addEventListener("click", () => { this._setBindings(a, list.filter((_, j) => j !== i)); render(); });
            chip.append(b, x);
            chips.append(chip);
          });
          const add = el("button", "gaw-kadd", "＋");
          add.title = "Add another key";
          add.addEventListener("click", () => capture(a, -1));
          chips.append(add);
          row.append(chips);
          body.append(row);
        }
      }
    };
    render();

    const row = el("div", "gaw-cp-btns");
    row.style.marginTop = "12px";
    const close = () => { this._keyCapture = null; wrap.remove(); this.modal = null; this.root.focus(); };
    this._closeModal = close;
    row.append(
      btn("Reset all to defaults", "", () => {
        if (!window.confirm("Reset all keyboard shortcuts to their defaults?")) return;
        this.keyCfg = {};
        localStorage.removeItem("gaw.keys");
        this._buildKeymap(); this._refreshHints(); this._syncColorUI();
        stopCapture(); render();
      }),
      btn("Done", "", () => close(), "gaw-btn primary")
    );
    box.append(body, foot, row);
    wrap.append(box);
    wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) close(); });
    this.root.append(wrap);
    this.modal = wrap;
  }

  /* ---------- presets ---------- */
  async loadPresets() {
    try { this.presets = (await A.get("/gen_archive/presets")).presets || {}; } catch (e) { this.presets = {}; }
    this.renderPresetOptions();
  }

  renderPresetOptions() {
    if (!this.cpPreset) return;
    this.cpPreset.innerHTML = "";
    const o0 = el("option", null, "— Presets —");
    o0.value = "";
    this.cpPreset.append(o0);
    for (const n of Object.keys(this.presets)) { const o = el("option", null, n); o.value = n; this.cpPreset.append(o); }
    if (!this.presets[this.presetSel]) { this.presetSel = ""; this.presetActive = false; }
    this.cpPreset.value = this.presetSel;
    this._syncColorUI();
  }

  // choose a preset in the list: it stays selected for all images and is shown on this one right away
  selectPreset(name) {
    if (!name || !this.presets[name]) {
      this.presetSel = ""; this.presetActive = false;
      localStorage.setItem("gaw.presetsel", "");
      this.adj = defaultAdj(); this._compare = false;
      this._syncColorUI(); this._refreshLbImage(); this.renderLbTitle();
      return;
    }
    this.presetSel = name;
    localStorage.setItem("gaw.presetsel", name);
    this.loadPreset(name);
    this.renderLbTitle();
  }

  // the green button / P key: pre-apply the selected preset to every image that is opened
  togglePresetActive() {
    if (!this.presets[this.presetSel]) { toast("Choose a preset in the list first"); return; }
    if (this.presetActive && this._presetSkipped) {   // sticky mode skipped this (already edited) image: apply it here on request
      this._presetSkipped = false;
      this.loadPreset(this.presetSel);
      this._syncColorUI(); this.renderLbTitle();
      return;
    }
    this._presetSkipped = false;
    this.presetActive = !this.presetActive;
    if (this.presetActive) this.loadPreset(this.presetSel);
    else { this.adj = defaultAdj(); this._compare = false; this._syncColorUI(); this._refreshLbImage(); }
    this.renderLbTitle();
    toast(this.presetActive ? `Preset “${this.presetSel}” is ON: it is pre-applied to every image you open (S = apply)` : "Preset OFF", 2400);
  }

  loadPreset(name) {
    const p = this.presets[name];
    if (!p) return;
    this.adj = { ...defaultAdj(), ...p };
    this._lastPreset = name; this._compare = false;
    this._syncColorUI();
    this._refreshLbImage();
  }

  async savePreset() {
    if (this._adjNeutral()) { toast("Move some sliders first, then save them as a preset"); return; }
    const name = (window.prompt("Preset name:", this._lastPreset || "") || "").trim();
    if (!name) return;
    if (this.presets[name] && !window.confirm(`Overwrite the preset “${name}”?`)) return;
    try {
      const res = await A.post("/gen_archive/presets", { action: "save", name, params: this.adj });
      this.presets = res.presets; this._lastPreset = name;
      this.presetSel = name; localStorage.setItem("gaw.presetsel", name);
      this.renderPresetOptions();
      toast(`Preset “${name}” saved`);
    } catch (e) { toast("Error: " + e.message); }
  }

  async deletePreset() {
    const name = this.cpPreset.value;
    if (!name) { toast("Choose a preset in the list first"); return; }
    if (!window.confirm(`Delete the preset “${name}”?`)) return;
    try {
      const res = await A.post("/gen_archive/presets", { action: "delete", name });
      this.presets = res.presets;
      if (this._lastPreset === name) this._lastPreset = "";
      if (this.presetSel === name) { this.presetSel = ""; this.presetActive = false; localStorage.setItem("gaw.presetsel", ""); this.adj = defaultAdj(); this._refreshLbImage(); }
      this.renderPresetOptions();
      toast(`Preset “${name}” deleted`);
    } catch (e) { toast("Error: " + e.message); }
  }

  // grid mode: apply a saved preset to the selected images (or the one under the cursor)
  openPresetDialog() {
    if (this.lbId || this.modal) return;
    const ids = this.targetIds();
    if (!ids.length) { toast("Nothing selected"); return; }
    const names = Object.keys(this.presets);
    if (!names.length) { toast("No presets yet: open an image fullscreen, set the sliders in 🎨 Color and press 💾", 4500); return; }
    const wrap = el("div", "gaw-modal");
    const box = el("div", "gaw-modal-box");
    box.append(el("h3", null, `Apply a preset to ${ids.length} image${ids.length === 1 ? "" : "s"}`));
    let chosen = this.presets[this._lastPreset] ? this._lastPreset : names[0];
    const list = el("div");
    for (const n of names) {
      const item = el("label", "gaw-pitem");
      const r = el("input");
      r.type = "radio"; r.name = "gaw-preset"; r.checked = n === chosen;
      r.addEventListener("change", () => { chosen = n; });
      const t = el("div");
      t.append(el("div", null, n), el("small", null, presetSummary(this.presets[n])));
      item.append(r, t);
      list.append(item);
    }
    const seg = el("div", "gaw-seg");
    const segBtns = [];
    for (const [mode, text] of [["overwrite", "Overwrite files"], ["copy", "Save copies (_color_N)"]]) {
      const b = el("button", this.cpMode === mode ? "on" : "", text);
      b.addEventListener("click", () => {
        this.cpMode = mode; localStorage.setItem("gaw.cpmode", mode);
        segBtns.forEach((x) => x.classList.toggle("on", x === b));
        this._syncColorUI();
      });
      segBtns.push(b);
      seg.append(b);
    }
    const note = el("div", "gaw-small", "Overwriting keeps a backup of every original (use Revert in the Color panel to undo).");
    const row = el("div", "gaw-cp-btns");
    row.style.marginTop = "12px";
    const close = () => { wrap.remove(); this.modal = null; this.root.focus(); };
    this._closeModal = close;
    row.append(
      btn("Cancel", "", () => close()),
      btn("✔ Apply", "", () => { const name = chosen; close(); this.applyPresetToIds(ids, name, this.cpMode); }, "gaw-btn primary")
    );
    box.append(list, seg, note, row);
    wrap.append(box);
    wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) close(); });  // click outside = cancel
    this.root.append(wrap);
    this.modal = wrap;
  }

  async applyPresetToIds(ids, name, mode) {
    const params = this.presets[name];
    if (!params) return;
    this._lastPreset = name;
    toast(`Applying “${name}” to ${ids.length} image(s)…`, 120000);
    try {
      const res = await A.post("/gen_archive/adjust_batch", { session: this.session, ids, mode, params });
      this.selected.clear();
      await this.refresh(true);
      const bad = res.failed.length;
      toast(`“${name}” applied to ${res.done} image(s)` + (mode === "copy" ? " (copies saved)" : "") + (bad ? `; ${bad} failed: ${res.failed[0].error}` : ""), 5000);
    } catch (e) { toast("Error: " + e.message, 5000); }
  }

  /* ---------- data ---------- */
  async loadSessions() {
    try {
      const { sessions } = await A.get("/gen_archive/sessions");
      this.sessions = sessions;
      if (!this.session || !sessions.some((s) => s.name === this.session)) {
        if (sessions.length) this.session = sessions[0].name;
      }
      this.selSession.innerHTML = "";
      for (const s of sessions) {
        const o = el("option", null, `${s.name} (${s.count})`);
        o.value = s.name;
        this.selSession.append(o);
      }
      if (!sessions.length) {
        const o = el("option", null, "— no sessions —"); o.value = ""; this.selSession.append(o);
      }
      this.selSession.value = this.session;
    } catch (e) { toast("Could not load sessions: " + e.message); }
  }

  async refresh(force) {
    if (!this.session) { this.renderAll(); return; }
    try {
      const d = await A.get(`/gen_archive/session?name=${encodeURIComponent(this.session)}`);
      if (!force && d.rev === this.data.rev && d.session === this.data.session) return;
      this.data = d;
      localStorage.setItem("gaw.session", this.session);
      this.renderAll();
    } catch (e) { toast("Load error: " + e.message); }
  }

  _index() {
    this.byId.clear(); this.versions.clear(); this.ord.clear();
    this.data.entries.forEach((e, i) => {
      this.byId.set(e.id, e);
      this.ord.set(e.id, i);
      if (!this.versions.has(e.base)) this.versions.set(e.base, []);
      this.versions.get(e.base).push(e);
    });
    for (const id of [...this.selected]) if (!this.byId.has(id)) this.selected.delete(id);
  }

  cats() { return Object.keys(this.data.categories || {}); }
  catsOf(id) { return this.cats().filter((c) => (this.data.categories[c] || []).includes(id)); }

  computeView() {
    const cats = this.data.categories || {};
    let list = this.data.entries;
    const f = this.filter;
    if (f === "uncat") {
      const any = new Set(Object.values(cats).flat());
      list = list.filter((e) => !any.has(e.id));
    } else if (f === "regen") {
      list = list.filter((e) => (this.versions.get(e.base) || []).length > 1);
    } else if (f === "latest") {
      list = list.filter((e) => { const v = this.versions.get(e.base); return v[v.length - 1] === e; });
    } else if (f.startsWith("cat:")) {
      const s = new Set(cats[f.slice(4)] || []);
      list = list.filter((e) => s.has(e.id));
    }
    this.view = list;
    this.viewIndex.clear();
    list.forEach((e, i) => this.viewIndex.set(e.id, i));
  }

  /* ---------- rendering ---------- */
  renderAll() {
    this._index();
    this.renderFilterOptions();
    this.renderCats();
    this.renderView(false);
    if (this.lbId && this.byId.has(this.lbId)) this.showLb();
  }

  renderFilterOptions() {
    const opts = [["all", "All"], ["uncat", "No category"], ["regen", "Has regenerations"], ["latest", "Latest versions only"]];
    for (const c of this.cats()) opts.push(["cat:" + c, "📁 " + c]);
    if (!opts.some((o) => o[0] === this.filter)) this.filter = "all";
    this.selFilter.innerHTML = "";
    for (const [v, t] of opts) { const o = el("option", null, t); o.value = v; this.selFilter.append(o); }
    this.selFilter.value = this.filter;
  }

  renderCats() {
    const bar = this.catBar;
    bar.innerHTML = "";
    const names = this.cats();
    names.forEach((n, i) => {
      const count = (this.data.categories[n] || []).length;
      const chip = btn(`${i < 9 ? i + 1 + " · " : ""}${n} (${count})`, "Click: add/remove the selected images. Right-click: menu", () => this.assign(n), "gaw-chip");
      chip.style.background = catColor(n);
      chip.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.catMenu(n, ev.clientX, ev.clientY); });
      bar.append(chip);
    });
    bar.append(btn("＋ New category (N)", "Create a category and add the selected images to it", () => this.newCategory(), "gaw-chip new"));
    if (!names.length) bar.append(el("span", "gaw-hint", "No categories yet: select the failed images and press N."));
  }

  renderView(forceRebuild) {
    const curId = this.view[this.cursor]?.id;
    this.computeView();
    const key = this.view.map((e) => e.id).join("|");
    if (curId && this.viewIndex.has(curId)) this.cursor = this.viewIndex.get(curId);
    this.cursor = clamp(this.cursor, 0, Math.max(0, this.view.length - 1));
    if (forceRebuild || key !== this.viewKey) { this.viewKey = key; this.rebuildGrid(); }
    this.renderBadges();
    this.updateCards();
  }

  rebuildGrid() {
    this.grid.innerHTML = "";
    this.cards.clear();
    if (!this.view.length) {
      this.grid.append(el("div", "gaw-empty", this.session ? "Nothing here yet." : "No sessions found. Run a workflow with a Generation Archive node first."));
      return;
    }
    const frag = document.createDocumentFragment();
    this.view.forEach((e) => {
      const c = el("div", "gaw-card");
      const img = new Image();
      img.loading = "lazy"; img.decoding = "async";
      img.src = A.eurl(this.session, e, 400);
      const lab = el("div", "gaw-id", e.id);
      const badges = el("div", "gaw-badges");
      const tick = el("div", "gaw-tick", "✓");
      c.append(img, badges, tick, lab);
      c.addEventListener("click", (ev) => this.onCardClick(e.id, ev));
      c.addEventListener("dblclick", () => this.openLightbox(e.id));
      this.cards.set(e.id, { c, badges, lab });
      frag.append(c);
    });
    this.grid.append(frag);
  }

  renderBadges() {
    for (const e of this.view) {
      const ref = this.cards.get(e.id);
      if (!ref) continue;
      ref.badges.innerHTML = "";
      const vs = this.versions.get(e.base) || [];
      if (e.regen > 0) { const b = el("span", "gaw-badge", `↻ reg_${e.regen}`); b.style.background = "#2e7d32"; ref.badges.append(b); }
      else if (vs.length > 1) { const b = el("span", "gaw-badge", `↻ ${vs.length - 1}`); b.style.background = "#555c6b"; ref.badges.append(b); }
      if (e.color > 0) { const b = el("span", "gaw-badge", `◐ color_${e.color}`); b.style.background = "#8e5bd0"; ref.badges.append(b); }
      if (e.fix > 0) { const b = el("span", "gaw-badge", `🖌 fix_${e.fix}`); b.style.background = "#1f8a8a"; ref.badges.append(b); }
      if (e.adjusted) { const b = el("span", "gaw-badge", "✎ edited"); b.style.background = "#b07a1a"; ref.badges.append(b); }
      const cs = this.catsOf(e.id);
      cs.slice(0, 2).forEach((n) => { const b = el("span", "gaw-badge", n); b.style.background = catColor(n); ref.badges.append(b); });
      if (cs.length > 2) { const b = el("span", "gaw-badge", `+${cs.length - 2}`); b.style.background = "#555c6b"; ref.badges.append(b); }
      const refs = Object.entries(e.refs || {}).map(([k, r]) => `${k}: ${r.orig_name || r.file}`).join("\n");
      ref.c.title = `${e.id}\n${refs}`;
    }
  }

  updateCards() {
    this.view.forEach((e, i) => {
      const ref = this.cards.get(e.id);
      if (!ref) return;
      ref.c.classList.toggle("sel", this.selected.has(e.id));
      ref.c.classList.toggle("cur", i === this.cursor);
    });
    this.lblCount.textContent = `Showing ${this.view.length} of ${this.data.entries.length} · selected ${this.selected.size}`;
  }

  /* ---------- grid interaction ---------- */
  onCardClick(id, ev) {
    const idx = this.viewIndex.get(id);
    if (ev.shiftKey && this.anchor != null) {
      const [a, b] = [Math.min(this.anchor, idx), Math.max(this.anchor, idx)];
      for (let i = a; i <= b; i++) this.selected.add(this.view[i].id);
    } else {
      if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
      this.anchor = idx;
    }
    this.cursor = idx;
    this.updateCards();
  }

  toggleSel(id) {
    if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
    this.updateCards();
    if (this.lbId) this.renderLbTitle();
  }

  targetIds() {
    if (this.lbId) return [this.lbId];
    if (this.selected.size) return [...this.selected];
    const cur = this.view[this.cursor];
    return cur ? [cur.id] : [];
  }

  async assign(cat) {
    const ids = this.targetIds();
    if (!ids.length) { toast("Nothing selected"); return false; }
    const members = new Set(this.data.categories[cat] || []);
    const allIn = ids.every((i) => members.has(i));
    try {
      const res = await A.post("/gen_archive/categories", { session: this.session, action: allIn ? "remove" : "add", category: cat, ids });
      this.data.categories = res.categories;
      this.data.rev = res.rev;
      toast(`${allIn ? "Removed from" : "Added to"} “${cat}”: ${ids.length}`);
      if (!this.lbId) this.selected.clear();
      this.renderFilterOptions(); this.renderCats(); this.renderView(false);
      if (this.lbId) this.renderLbCats();
      return !allIn;
    } catch (e) { toast("Error: " + e.message); return false; }
  }

  async newCategory() {
    const ids = this.targetIds();
    const name = (window.prompt(`Name of the new category (e.g. "color", "anatomy").\nImages to add: ${ids.length}`) || "").trim();
    if (!name) return;
    try {
      const res = await A.post("/gen_archive/categories", { session: this.session, action: "create", category: name, ids });
      this.data.categories = res.categories; this.data.rev = res.rev;
      toast(`Category “${name}” created, ${ids.length} image(s) added.`, 3000);
      if (!this.lbId) this.selected.clear();
      this.renderFilterOptions(); this.renderCats(); this.renderView(false);
      if (this.lbId) this.renderLbCats();
    } catch (e) { toast("Error: " + e.message); }
  }

  catMenu(name, x, y) {
    const post = async (action, extra = {}) => {
      try {
        const res = await A.post("/gen_archive/categories", { session: this.session, action, category: name, ...extra });
        this.data.categories = res.categories; this.data.rev = res.rev;
        this.renderFilterOptions(); this.renderCats(); this.renderView(false);
        return res;
      } catch (e) { toast("Error: " + e.message); return null; }
    };
    popupMenu([
      { label: "Show only this category", fn: () => { this.filter = "cat:" + name; this.selFilter.value = this.filter; this.cursor = 0; this.renderView(true); } },
      { sep: true },
      { label: "Remove already regenerated images from category", fn: async () => { const r = await post("remove_regenerated"); if (r) toast(`Removed: ${r.removed ?? 0}`); } },
      { label: "Export copies to Categories/…", fn: async () => { const r = await post("export"); if (r) { toast(`Exported: ${r.count} → ${r.path}`, 3500); this.openFolder(r.path); } } },
      { label: "Rename…", fn: async () => { const nn = (window.prompt("New name:", name) || "").trim(); if (nn && nn !== name) { if (this.filter === "cat:" + name) this.filter = "cat:" + nn; await post("rename", { new_name: nn }); toast("Renamed (update the category name in your Archive Container node)"); } } },
      { label: "Delete category (images are kept)", fn: async () => { if (window.confirm(`Delete category “${name}”? The images themselves are not deleted.`)) await post("delete"); } },
    ], x, y);
  }

  deleteSelected() {
    const cur = this.view[this.cursor];
    const ids = this.lbId ? [this.lbId] : this.selected.size ? [...this.selected] : cur ? [cur.id] : [];
    return this.deleteIds(ids);
  }

  async deleteIds(ids) {
    if (!ids.length) { toast("Nothing selected"); return; }
    const label = ids.length === 1 ? ids[0] : `${ids.length} images`;
    if (!window.confirm(`Permanently delete ${label} from the archive?\nThe files are removed from the Output folder and cannot be restored.`)) return;
    const wasLb = this.lbId;
    const next = wasLb ? (this.neighbor(1) || this.neighbor(-1)) : null;
    try {
      const res = await A.post("/gen_archive/delete", { session: this.session, ids });
      for (const id of ids) this.selected.delete(id);
      toast(`Deleted: ${res.deleted}`);
      await this.loadSessions();
      await this.refresh(true);
      if (wasLb) {
        if (next && this.byId.has(next.id)) this.gotoId(next.id); else this.closeLightbox();
      }
    } catch (e) { toast("Error: " + e.message); }
  }

  async openFolder(sub) {
    try { await A.post("/gen_archive/open_folder", { session: this.session, sub }); }
    catch (e) { toast("Could not open the folder: " + e.message); }
  }

  /* ---------- fullscreen view ---------- */
  openLightbox(id) {
    this.lbId = id;
    this._shownId = null;
    this.lb.style.display = "block";
    this.side.style.display = this._sideHidden ? "none" : "";
    this.showLb();
  }
  closeLightbox() {
    if (!this.lbId) return;
    if (this.rt?.active && !this.exitRetouch()) return;
    const idx = this.viewIndex.get(this.lbId);
    if (idx != null) { this.cursor = idx; this.cards.get(this.lbId)?.c.scrollIntoView({ block: "nearest" }); }
    this.lbId = null;
    this._shownId = null;
    this.lb.style.display = "none";
    this.updateCards();
    this.root.focus();
  }
  toggleSide() {
    this._sideHidden = !this._sideHidden;
    this.side.style.display = this._sideHidden ? "none" : "";
    setTimeout(() => this._fit(), 0);
  }

  showLb() {
    const e = this.byId.get(this.lbId);
    if (!e) return;
    const same = this._shownId === e.id;  // same image re-rendered (e.g. auto refresh): keep zoom + preview
    this._shownId = e.id;
    if (!same) {
      if (!this.presetSticky) this.presetActive = false;   // the preset button switches itself off when you change image
      this.adj = this._baseAdj(e); this._compare = false;
      this._presetSkipped = this.presetActive && !this._presetEligible(e);
    }
    // fixed display size from the registry, so previews of other resolutions keep the same geometry
    this.lbImg.style.width = e.w ? e.w + "px" : "";
    this.lbImg.style.height = e.h ? e.h + "px" : "";
    const changed = this._setLbSrc(this._lbUrl(e, !same), same);
    if (!changed && !same) this._fit();
    this.renderLbTitle();
    this.renderLbCats();
    this.renderSide(e);
    this._syncColorUI();
    const nxt = this.neighbor(1), prv = this.neighbor(-1);
    for (const n of [nxt, prv]) if (n) { const im = new Image(); im.src = A.eurl(this.session, n); }
    this._prefetchPreset(nxt);
  }

  renderLbTitle() {
    const e = this.byId.get(this.lbId);
    if (!e) return;
    const idx = this.viewIndex.get(e.id);
    const pos = idx != null ? `${idx + 1} / ${this.view.length}` : "outside filter";
    this.lbTitle.textContent = `${e.id} · ${pos}${this.selected.has(e.id) ? " · ✓ selected" : ""}${this.presetActive ? ` · 🎨 ${this.presetSel}` : ""}`;
  }

  renderLbCats() {
    const bar = this.lbCats;
    bar.innerHTML = "";
    const names = this.cats();
    names.forEach((n, i) => {
      const inCat = (this.data.categories[n] || []).includes(this.lbId);
      const chip = btn(`${i < 9 ? i + 1 + " · " : ""}${n}${inCat ? " ✓" : ""}`, "", () => this.assignAndAdvance(n), "gaw-chip" + (inCat ? " on" : ""));
      chip.style.background = catColor(n);
      bar.append(chip);
    });
    bar.append(btn("＋ New (N)", "", () => this.newCategory(), "gaw-chip new"));
    bar.append(btn(`T: auto-advance ${this.autoAdvance ? "ON" : "OFF"}`, "After adding to a category, jump to the next image", () => { this.autoAdvance = !this.autoAdvance; this.renderLbCats(); }, "gaw-chip new"));
  }

  async assignAndAdvance(n) {
    const added = await this.assign(n);
    if (added && this.autoAdvance) this.lbStep(1);
  }

  renderSide(e) {
    const s = this.side;
    s.innerHTML = "";
    s.append(el("h3", null, e.id));
    const date = new Date((e.time || 0) * 1000);
    s.append(el("div", "gaw-refname", `${e.w}×${e.h} · ${date.toLocaleString()}${e.regen_of ? ` · regenerated from ${e.regen_of}` : ""}`));
    if (e.info) { s.append(el("h4", null, "Info")); s.append(el("pre", null, e.info)); }
    const vs = this.versions.get(e.base) || [];
    if (vs.length > 1) {
      s.append(el("h4", null, "Versions (↑ ↓)"));
      const box = el("div", "gaw-vers");
      for (const v of vs) {
        const d = el("div", "gaw-ver" + (v.id === e.id ? " on" : ""));
        const im = new Image(); im.src = A.eurl(this.session, v, 160);
        d.append(im, el("div", null, verLabel(v)));
        d.addEventListener("click", () => this.gotoId(v.id));
        box.append(d);
      }
      s.append(box);
    }
    s.append(el("h4", null, "References"));
    const entries = Object.entries(e.refs || {});
    if (!entries.length) s.append(el("div", "gaw-refname", "No references recorded."));
    for (const [k, r] of entries) {
      const im = new Image();
      im.className = "gaw-refimg";
      im.src = A.url(this.session, r.file, 500);
      im.title = "Click to open the original in a new tab";
      im.addEventListener("click", () => window.open(A.url(this.session, r.file), "_blank"));
      s.append(el("div", "gaw-refname", k.replace("ref_", "Ref_")));
      s.append(im);
      s.append(el("div", "gaw-refname", (r.orig_name || r.file) + (r.orig_path ? `\n${r.orig_path}` : "")));
    }
  }

  gotoId(id) {
    if (!this.byId.has(id)) return;
    if (this.rt?.active && id !== this.lbId) { toast("Finish or close the retouch first (R)"); return; }
    this.lbId = id;
    this.showLb();
  }

  neighbor(dir) {
    const cur = this.byId.get(this.lbId);
    if (!cur || !this.view.length) return null;
    const idx = this.viewIndex.get(cur.id);
    if (idx != null) return this.view[idx + dir] || null;
    const o = this.ord.get(cur.id);
    if (dir > 0) return this.view.find((e) => this.ord.get(e.id) > o) || null;
    for (let i = this.view.length - 1; i >= 0; i--) if (this.ord.get(this.view[i].id) < o) return this.view[i];
    return null;
  }

  lbStep(dir) {
    const n = this.neighbor(dir);
    if (n) this.gotoId(n.id); else toast(dir > 0 ? "This is the last image" : "This is the first image", 900);
  }

  lbVersion(dir) {
    const e = this.byId.get(this.lbId);
    const vs = this.versions.get(e.base) || [];
    const i = vs.indexOf(e) + dir;
    if (vs[i]) this.gotoId(vs[i].id); else toast("No other versions", 900);
  }

  /* ---------- zoom / pan ---------- */
  _fit() {
    if (!this.lbId) return;
    const r = this.stage.getBoundingClientRect();
    const ce = this.byId.get(this.lbId);
    const nw = ce?.w || this.lbImg.naturalWidth || 1, nh = ce?.h || this.lbImg.naturalHeight || 1;
    this.z.fit = Math.min(r.width / nw, r.height / nh) || 1;
    this.z.scale = this.z.fit; this.z.x = 0; this.z.y = 0;
    this._applyZ();
  }
  _applyZ() {
    this.lbImg.style.transform = `translate(-50%,-50%) translate(${this.z.x}px,${this.z.y}px) scale(${this.z.scale})`;
    if (this.rtCanvas) this.rtCanvas.style.transform = this.lbImg.style.transform;
  }
  _zoom(e) {
    const r = this.stage.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2), cy = e.clientY - (r.top + r.height / 2);
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const s1 = this.z.scale, s2 = clamp(s1 * f, this.z.fit * 0.25, 40);
    this.z.x = cx - (cx - this.z.x) * (s2 / s1);
    this.z.y = cy - (cy - this.z.y) * (s2 / s1);
    this.z.scale = s2;
    this._applyZ();
  }
  _toggleFit() {
    if (Math.abs(this.z.scale - this.z.fit) < 1e-3) { this.z.scale = 1; this.z.x = 0; this.z.y = 0; this._applyZ(); }
    else this._fit();
  }

  /* ---------- hotkeys ---------- */
  _onKey(e) {
    if (!this.root.isConnected) return;
    if (this._keyCapture) { e.preventDefault(); e.stopImmediatePropagation(); this._keyCapture(e); return; }   // ⌨ dialog is waiting for a key
    if (this.modal) {  // a dialog is open: it handles Escape, and no ComfyUI hotkey may fire behind it
      if (e.key === "Escape") { this._closeModal(); e.preventDefault(); }
      e.stopImmediatePropagation();
      return;
    }
    if (menuEl) {  // a popup menu is open: Escape only closes the menu
      if (e.key === "Escape") { closeMenu(); e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !(t.type === "range" && e.key !== "Escape")) {
      if (e.key === "Escape") { t.blur(); this.root.focus(); e.stopImmediatePropagation(); }
      return;
    }
    const combo0 = comboOf(e);
    if (combo0 === "Alt+g") { this.close(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    let ev = e;   // the event the built-in handlers see: your custom key is translated to the default one
    if (combo0) {
      const canon = this._translateKey(combo0);
      if (canon === null) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // a default key you re-assigned
      if (canon !== combo0) ev = fakeKeyEvent(canon, e);
    }
    const hk = hotkey(ev);
    if (ev.ctrlKey || ev.metaKey) {
      if (hk === "a" && !this.lbId) { this.view.forEach((v) => this.selected.add(v.id)); this.updateCards(); e.preventDefault(); }
      else if (this.rt?.active && hk === "z") { if (ev.shiftKey) this._rtRedo(); else this._rtUndo(); e.preventDefault(); }
      else if (this.rt?.active && hk === "y") { this._rtRedo(); e.preventDefault(); }
      e.stopImmediatePropagation();
      return;
    }
    const handled = this.lbId ? this._keyLb(ev) : this._keyGrid(ev);
    if (handled) e.preventDefault();
    e.stopImmediatePropagation();
  }

  _digit(e) {
    if (/^[1-9]$/.test(e.key)) { const n = this.cats()[Number(e.key) - 1]; return n ?? null; }
    return null;
  }

  _keyGrid(e) {
    const k = hotkey(e);
    const cols = () => Math.max(1, getComputedStyle(this.grid).gridTemplateColumns.split(" ").filter(Boolean).length);
    const move = (d) => {
      if (!this.view.length) return;
      this.cursor = clamp(this.cursor + d, 0, this.view.length - 1);
      this.updateCards();
      this.cards.get(this.view[this.cursor].id)?.c.scrollIntoView({ block: "nearest" });
    };
    if (k === "ArrowRight") move(1);
    else if (k === "ArrowLeft") move(-1);
    else if (k === "ArrowDown") move(cols());
    else if (k === "ArrowUp") move(-cols());
    else if (k === "Home") move(-1e9);
    else if (k === "End") move(1e9);
    else if (k === " ") { const c = this.view[this.cursor]; if (c) { this.toggleSel(c.id); this.anchor = this.cursor; } }
    else if (k === "Enter") { const c = this.view[this.cursor]; if (c) this.openLightbox(c.id); }
    else if (k === "Escape") { if (this.selected.size) { this.selected.clear(); this.updateCards(); } else this.close(); }
    else if (k.toLowerCase() === "n" || k.toLowerCase() === "c") this.newCategory();
    else if (k.toLowerCase() === "r") { this.loadSessions().then(() => this.refresh(true)); }
    else if (k.toLowerCase() === "p") this.openPresetDialog();
    else if (k === "Delete") this.deleteSelected();
    else if (this._digit(e)) this.assign(this._digit(e));
    else return false;
    return true;
  }

  _keyLb(e) {
    const k = hotkey(e);
    if (this.rt?.active && this._keyRetouch(e, k)) return true;
    if (k === "ArrowRight" || k.toLowerCase() === "d") this.lbStep(1);
    else if (k === "ArrowLeft" || k.toLowerCase() === "a") this.lbStep(-1);
    else if (k === "ArrowUp") this.lbVersion(-1);
    else if (k === "ArrowDown") this.lbVersion(1);
    else if (k === "Home") { const f = this.view[0]; if (f) this.gotoId(f.id); }
    else if (k === "End") { const l = this.view[this.view.length - 1]; if (l) this.gotoId(l.id); }
    else if (k === " ") this.toggleSel(this.lbId);
    else if (k === "Escape" || k === "Enter" || k.toLowerCase() === "q") this.closeLightbox();
    else if (k.toLowerCase() === "i") this.toggleSide();
    else if (k.toLowerCase() === "e") this.toggleColor();
    else if (k.toLowerCase() === "r") this.toggleRetouch();
    else if (k.toLowerCase() === "b") this.toggleColorPaint();
    else if (k.toLowerCase() === "p") this.togglePresetActive();
    else if (k.toLowerCase() === "s") this.applyAdjust();
    else if (k.toLowerCase() === "z") this._toggleFit();
    else if (k.toLowerCase() === "t") { this.autoAdvance = !this.autoAdvance; this.renderLbCats(); }
    else if (k === "Delete") this.deleteSelected();
    else if (k.toLowerCase() === "n" || k.toLowerCase() === "c") this.newCategory();
    else if (this._digit(e)) this.assignAndAdvance(this._digit(e));
    else return false;
    return true;
  }
}

/* ───────────────────── ComfyUI extension ───────────────────── */

function guessSession() {
  const g = currentGraph();
  const nodes = g?._nodes || [];
  const sel = Object.values(app.canvas?.selected_nodes || {}).find((n) => n.type === "GenArchiveRegistry" || n.type === "GenArchiveContainer");
  const n = sel || nodes.find((x) => x.type === "GenArchiveRegistry") || nodes.find((x) => x.type === "GenArchiveContainer");
  return n ? wval(n, "session") : "";
}

async function sessionMenu(node, allowNew) {
  let sessions = [];
  try { sessions = (await A.get("/gen_archive/sessions")).sessions; } catch (e) { toast("Error: " + e.message); return; }
  const items = sessions.map((s) => ({ label: `${s.name} (${s.count})`, fn: () => setW(node, "session", s.name) }));
  if (allowNew) {
    if (items.length) items.push({ sep: true });
    items.push({ label: "＋ New session…", fn: () => { const n = (window.prompt("New session name:", "session_" + new Date().toISOString().slice(0, 10)) || "").trim(); if (n) setW(node, "session", n); } });
  }
  if (!items.length) { toast("No sessions yet - run a workflow with a Generation Archive node first"); return; }
  popupMenu(items);
}

async function categoryMenu(node) {
  const s = wval(node, "session");
  try {
    const d = await A.get(`/gen_archive/session?name=${encodeURIComponent(s)}`);
    const names = Object.keys(d.categories || {});
    if (!names.length) { toast("This session has no categories yet"); return; }
    popupMenu(names.map((n) => ({ label: `${n} (${d.categories[n].length})`, fn: () => setW(node, "category", n) })));
  } catch (e) { toast("Error: " + e.message); }
}

app.registerExtension({
  name: "GenArchive.UI",
  commands: [{
    id: "GenArchive.OpenViewer",
    label: "GenArchive: open viewer",
    function: () => { if (viewer) viewer.close(); else openViewer({ session: guessSession() }); },
  }],
  keybindings: [{ commandId: "GenArchive.OpenViewer", combo: { key: "g", alt: true } }],

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "GenArchiveRegistry" && nodeData.name !== "GenArchiveContainer") return;
    const isContainer = nodeData.name === "GenArchiveContainer";
    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      orig?.apply(this, arguments);
      const add = (label, fn) => { const w = this.addWidget("button", label, null, fn); if (w) w.serialize = false; return w; };
      add("🖼 Open viewer (Alt+G)", () => openViewer({ session: wval(this, "session") }));
      add("▼ Choose session…", () => sessionMenu(this, !isContainer));
      if (isContainer) add("▼ Choose category…", () => categoryMenu(this));
      try {
        const sz = this.computeSize();
        this.setSize([Math.max(sz[0], 320), sz[1]]);
      } catch (e) { /* not critical */ }
    };
  },
});
