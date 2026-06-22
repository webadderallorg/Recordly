// Built-in keystroke overlay. Settings live under the cursor section.

export function activate(api) {
  api.registerSettingsPanel({
    id: "keystrokes",
    label: "Keystrokes",
    parentSection: "cursor", // nest under the cursor (mouse) settings
    fields: [
      { id: "enabled", label: "Show keystrokes", type: "toggle", defaultValue: true },
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
      { id: "marginX", label: "Horizontal margin", type: "slider", defaultValue: 40, min: 0, max: 300, step: 4 },
      { id: "marginY", label: "Vertical margin", type: "slider", defaultValue: 48, min: 0, max: 300, step: 4 },
      { id: "fadeMs", label: "Display duration (ms)", type: "slider", defaultValue: 1500, min: 500, max: 4000, step: 100 },
    ],
  });

  api.registerRenderHook("final", (hookCtx) => {
    if (api.getSetting("enabled") === false) return;

    const fadeMs = Number(api.getSetting("fadeMs") ?? 1500);
    const position = String(api.getSetting("position") ?? "bottom-center");
    const marginX = Number(api.getSetting("marginX") ?? 40);
    const marginY = Number(api.getSetting("marginY") ?? 48);

    const events = api.getKeystrokesInRange(hookCtx.timeMs - fadeMs, hookCtx.timeMs + 50);
    if (!events.length) return;

    const last = events[events.length - 1];
    const life = hookCtx.timeMs - last.timeMs;
    const t = life / fadeMs;
    if (t < 0 || t >= 1) return;

    // keyviz-style: pop+slide-up on entrance, hold, fade+drift on exit
    const ENTER = 0.1, EXIT = 0.72;
    let alpha, slide, scale;
    if (t < ENTER) {
      const e = 1 - Math.pow(1 - t / ENTER, 3); // ease-out cubic
      alpha = e;
      slide = (1 - e) * 16;
      scale = 0.86 + 0.14 * e;
    } else if (t > EXIT) {
      const p = (t - EXIT) / (1 - EXIT);
      alpha = 1 - p;
      slide = -p * 10;
      scale = 1;
    } else {
      alpha = 1; slide = 0; scale = 1;
    }
    if (alpha <= 0) return;

    const { ctx, width, height } = hookCtx;

    const badges = [
      ...last.modifiers.map((m) => ({ text: fmtMod(m), isMod: true })),
      { text: fmtKey(last.key), isMod: false },
    ];

    const FONT = 18, PX = 14, PY = 8, GAP = 6, R = 8;
    ctx.save();
    ctx.font = `600 ${FONT}px -apple-system, system-ui, sans-serif`;

    const bw = badges.map((b) => ctx.measureText(b.text).width + PX * 2);
    const totalW = bw.reduce((a, v) => a + v, 0) + GAP * (badges.length - 1);
    const rowH = FONT + PY * 2;

    const isRight = position.endsWith("right");
    const isCenter = position.endsWith("center");
    const x0 = isRight ? width - totalW - marginX : isCenter ? (width - totalW) / 2 : marginX;
    const y0 = position.startsWith("top") ? marginY : height - marginY - rowH;

    // animate around the row center
    const cx = x0 + totalW / 2, cy = y0 + rowH / 2;
    ctx.translate(cx, cy + slide);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = alpha;

    let x = x0;
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i];
      const w = bw[i];

      ctx.globalAlpha = alpha * (b.isMod ? 0.75 : 1);
      ctx.fillStyle = b.isMod ? "#374151" : "#1e293b";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
      rrect(ctx, x, y0, w, rowH, R);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      if (!b.isMod) {
        ctx.globalAlpha = alpha * 0.3;
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1;
        rrect(ctx, x, y0, w, rowH, R);
        ctx.stroke();
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = b.isMod ? "#d1d5db" : "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.text, x + w / 2, y0 + rowH / 2);
      x += w + GAP;
    }

    ctx.restore();
  });
}

export function deactivate() {}

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

function fmtMod(m) {
  return { Meta: "⌘", Command: "⌘", Control: "⌃", Ctrl: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧" }[m] ?? m;
}

function fmtKey(k) {
  return (
    { " ": "Space", Enter: "↩", Escape: "Esc", Backspace: "⌫", Delete: "⌦",
      Tab: "⇥", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      CapsLock: "⇪" }[k] ?? (k.length === 1 ? k.toUpperCase() : k)
  );
}
