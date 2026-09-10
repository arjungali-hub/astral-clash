// Astral Clash — HUD font loading for direction 1c "Telemetry"
// The HUD starts drawing on frame 1. ctx.font falls back SILENTLY and per-call,
// so gate the first paint and keep a metric-aware fallback.

export const HUD_STACK = "'AstralHUD', 'Courier New', monospace";
export const DISPLAY_STACK = "'AstralDisplay', 'Segoe UI', Tahoma, sans-serif";

export let hudFontReady = false;

export async function loadHudFonts() {
  try {
    const faces = [
      new FontFace('AstralHUD', "url(/fonts/astral-hud.woff2) format('woff2')",
        { weight: '400 600', display: 'block' }),
      new FontFace('AstralHUD', "url(/fonts/astral-hud-bold.woff2) format('woff2')",
        { weight: '700', display: 'block' }),
      new FontFace('AstralDisplay', "url(/fonts/astral-display.woff2) format('woff2-variations')",
        { weight: '400 800', display: 'swap' }),
    ];
    await Promise.all(faces.map(f => f.load()));
    faces.forEach(f => document.fonts.add(f));
    await document.fonts.ready;                       // covers the DOM cuts too
    hudFontReady = document.fonts.check("13px 'AstralHUD'");
  } catch (e) {
    console.warn('[type] HUD font failed, falling back to Courier New', e);
    hudFontReady = false;   // Courier New is also monospaced + tabular: metrics
  }                         // shift but nothing jitters frame to frame
  return hudFontReady;
}

// --- call this BEFORE the first requestAnimationFrame -----------------------
//   await loadHudFonts();
//   startMatchLoop();
// If you cannot block, hold only the HUD layer:
//   if (hudFontReady) drawHud(ctx); else drawHudSkeleton(ctx);

// --- ctx.font strings -------------------------------------------------------
// Sizes come from index.html. hudScale is the user's 1.0 / 1.3 setting.
// Round to whole device pixels: the 1755x975 virtual canvas lands on
// non-integer sizes otherwise, and there is no hinting to save you.

export const HUD_SIZES = {
  micro: 9, small: 11, body: 12, value: 13, name: 15, timer: 18,
};

export function hudFont(size, weight = 500, hudScale = 1, dpr = 1) {
  const px = Math.max(9, Math.round(size * hudScale * dpr) / dpr);
  return `${weight} ${px}px ${HUD_STACK}`;
}

// Resolved table, for reference:
//        base   x1.3
//   9  ->  9      12      (12 is the floor that still reads on #0d0f18)
//  11  -> 11      14
//  12  -> 12      16
//  13  -> 13      17
//  15  -> 15      20
//  18  -> 18      23

// Announcements (FIGHT!, KO, results) use the display cut:
export function announceFont(canvasWidth, weight = 800) {
  return `${weight} ${Math.round(canvasWidth * 0.085)}px ${DISPLAY_STACK}`;
}

// Snap the HUD transform so 9px lands on whole pixels:
export function prepHudLayer(ctx, dpr = window.devicePixelRatio || 1) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.imageSmoothingEnabled = false;
}
