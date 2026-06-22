// Built-in keystroke overlay, keyviz-style keycaps. Settings under cursor section.
//
// uiohook reports PHYSICAL key positions, not characters. The layout setting
// remaps them to the user's keyboard. ponytail: AZERTY/QWERTZ cover the common
// non-US layouts; add more rows here if someone needs Dvorak etc.

const AZERTY = { q: "a", a: "q", w: "z", z: "w", ";": "m", m: "," };
const QWERTZ = { y: "z", z: "y" };

function remapKey(key, layout) {
  if (key.length !== 1) return key;
  if (layout === "azerty") return AZERTY[key] ?? key;
  if (layout === "qwertz") return QWERTZ[key] ?? key;
  return key;
}

export function activate(api) {
  api.registerSettingsPanel({
    id: "keystrokes",
    label: "Keystrokes",
    parentSection: "cursor",
    fields: [
      { id: "enabled", label: "Show keystrokes", type: "toggle", defaultValue: true },
      {
        id: "layout",
        label: "Keyboard layout",
        type: "select",
        defaultValue: "qwerty",
        options: [
          { label: "QWERTY", value: "qwerty" },
          { label: "AZERTY", value: "azerty" },
          { label: "QWERTZ", value: "qwertz" },
        ],
      },
      {
        id: "position",
        label: "Position",
        type: "select",
        defaultValue: "bottom-center",
        options: [
          { label: "Bottom Left", value: "bottom-left" },
          { label: "Bottom Center", value: "bottom-center" },
          { label: "Bottom Right", value: "bottom-right" },
          { label: "Top Left", value: "top-left" },
          { label: "Top Center", value: "top-center" },
          { label: "Top Right", value: "top-right" },
        ],
      },
      { id: "marginX", label: "Horizontal margin", type: "slider", defaultValue: 48, min: 0, max: 300, step: 4 },
      { id: "marginY", label: "Vertical margin", type: "slider", defaultValue: 56, min: 0, max: 300, step: 4 },
      { id: "fadeMs", label: "Display duration (ms)", type: "slider", defaultValue: 1500, min: 500, max: 4000, step: 100 },
    ],
  });

  api.registerRenderHook("final", (hookCtx) => {
    if (api.getSetting("enabled") === false) return;

    const fadeMs = Number(api.getSetting("fadeMs") ?? 1500);
    const position = String(api.getSetting("position") ?? "bottom-center");
    const layout = String(api.getSetting("layout") ?? "qwerty");
    const marginX = Number(api.getSetting("marginX") ?? 48);
    const marginY = Number(api.getSetting("marginY") ?? 56);

    const events = api.getKeystrokesInRange(hookCtx.timeMs - fadeMs, hookCtx.timeMs + 50);
    if (!events.length) return;

    const last = events[events.length - 1];
    const t = (hookCtx.timeMs - last.timeMs) / fadeMs;
    if (t < 0 || t >= 1) return;

    // keyviz-style: pop+slide-up on entrance, hold, fade+drift on exit
    const ENTER = 0.1, EXIT = 0.72;
    let alpha, slide, scale;
    if (t < ENTER) {
      const e = 1 - Math.pow(1 - t / ENTER, 3);
      alpha = e; slide = (1 - e) * 18; scale = 0.85 + 0.15 * e;
    } else if (t > EXIT) {
      const p = (t - EXIT) / (1 - EXIT);
      alpha = 1 - p; slide = -p * 10; scale = 1;
    } else {
      alpha = 1; slide = 0; scale = 1;
    }
    if (alpha <= 0) return;

    const { ctx, width, height } = hookCtx;

    // scale keycaps to the canvas so they read at any resolution
    const u = Math.max(44, Math.min(90, Math.round(height * 0.058)));
    const faceH = u;
    const lip = Math.round(u * 0.13);
    const radius = Math.round(u * 0.18);
    const gap = Math.round(u * 0.18);
    const padH = Math.round(u * 0.34);
    const minW = u;
    const capH = faceH + lip;

    const fRegBig = `700 ${Math.round(u * 0.46)}px -apple-system, system-ui, sans-serif`;
    const fRegSmall = `600 ${Math.round(u * 0.26)}px -apple-system, system-ui, sans-serif`;
    const fGlyph = `600 ${Math.round(u * 0.32)}px -apple-system, system-ui, sans-serif`;
    const fLabel = `500 ${Math.round(u * 0.2)}px -apple-system, system-ui, sans-serif`;

    // Build keycap descriptors: modifiers first (⌃⌥⇧⌘ order), then the key
    const caps = last.modifiers.map(modInfo);
    const keyText = fmtKey(remapKey(last.key, layout));
    caps.push({ glyph: keyText, label: null, big: keyText.length === 1 });

    // Measure widths
    for (const c of caps) {
      if (c.label) {
        ctx.font = fGlyph;
        const gw = ctx.measureText(c.glyph).width;
        ctx.font = fLabel;
        const lw = ctx.measureText(c.label).width;
        c.w = Math.max(minW, Math.max(gw, lw) + padH * 2);
      } else {
        ctx.font = c.big ? fRegBig : fRegSmall;
        c.w = Math.max(minW, ctx.measureText(c.glyph).width + padH * 2);
      }
    }

    const totalW = caps.reduce((a, c) => a + c.w, 0) + gap * (caps.length - 1);
    const isRight = position.endsWith("right");
    const isCenter = position.endsWith("center");
    const x0 = isRight ? width - totalW - marginX : isCenter ? (width - totalW) / 2 : marginX;
    const y0 = position.startsWith("top") ? marginY : height - marginY - capH;

    ctx.save();
    const cx = x0 + totalW / 2, cy = y0 + capH / 2;
    ctx.translate(cx, cy + slide);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = alpha;

    let x = x0;
    for (const c of caps) {
      drawKeycap(ctx, x, y0, c.w, faceH, lip, radius, u);

      ctx.fillStyle = "#1a1a1a";
      ctx.textAlign = "center";
      if (c.label) {
        ctx.textBaseline = "middle";
        ctx.font = fGlyph;
        ctx.fillText(c.glyph, x + c.w / 2, y0 + faceH * 0.36);
        ctx.font = fLabel;
        ctx.fillText(c.label, x + c.w / 2, y0 + faceH * 0.7);
      } else {
        ctx.textBaseline = "middle";
        ctx.font = c.big ? fRegBig : fRegSmall;
        ctx.fillText(c.glyph, x + c.w / 2, y0 + faceH / 2);
      }
      x += c.w + gap;
    }

    ctx.restore();
  });
}

export function deactivate() {}

function drawKeycap(ctx, x, y, w, faceH, lip, r, u) {
  // extruded dark base (the black bottom edge)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = Math.round(u * 0.22);
  ctx.shadowOffsetY = Math.round(u * 0.08);
  ctx.fillStyle = "#0f1115";
  rrect(ctx, x, y, w, faceH + lip, r);
  ctx.fill();
  ctx.restore();

  // white face
  ctx.fillStyle = "#ffffff";
  rrect(ctx, x, y, w, faceH, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = Math.max(1, u * 0.02);
  rrect(ctx, x, y, w, faceH, r);
  ctx.stroke();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function modInfo(m) {
  return (
    {
      Meta: { glyph: "⌘", label: "command" },
      Command: { glyph: "⌘", label: "command" },
      Control: { glyph: "⌃", label: "control" },
      Ctrl: { glyph: "⌃", label: "control" },
      Alt: { glyph: "⌥", label: "option" },
      Option: { glyph: "⌥", label: "option" },
      Shift: { glyph: "⇧", label: "shift" },
    }[m] ?? { glyph: m, label: null, big: m.length === 1 }
  );
}

function fmtKey(k) {
  return (
    { " ": "Space", Enter: "↩", Escape: "Esc", Backspace: "⌫", Delete: "⌦",
      Tab: "⇥", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      CapsLock: "⇪" }[k] ?? (k.length === 1 ? k.toUpperCase() : k)
  );
}
