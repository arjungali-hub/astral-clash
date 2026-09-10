# Design prompt: a custom typeface for Astral Clash

Paste everything below the line into Claude. It is written to be handed over
without edits — every number in it was read out of `index.html`, so the result
should drop into the game rather than needing to be re-fitted to it.

Two notes before you send it:

- **Ask for the variable-font route first.** A single variable `.woff2` with a
  weight axis is one request, one file, and one `@font-face` block; three static
  weights is three of everything and they drift.
- **The HUD is the hard constraint, not the logo.** The title is drawn once at
  ~2.5rem where anything looks good. The numbers that decide whether you can
  read your own health bar are drawn to a canvas at **9–18px**, and that is
  where most display typefaces fall apart.

---

I need a custom typeface designed for a game I'm building, and I'd like you to
produce it as an actual usable font file, not a description of one.

## The game

**Astral Clash** is a first-person arena fighter that runs in the browser.
Two players connect peer-to-peer, pick a fighter each, and fight in one of ten
themed arenas. The tone is *sci-fi tournament*: a "dimensional arena" framing,
cyan energy accents, dark chrome UI, and arenas that range from a steel-and-neon
tech nexus through a sandstone temple and a granite castle to a volcanic
foundry. It should feel like a commercial competitive game — closer to Valorant
or Overwatch's confident, engineered look than to a retro pixel game or a
grimdark fantasy one.

Fourteen fighters, named things like Kaelen (Rhythm Blade), Nyx (Umbral
Reaper), Seraphine (Astral Warden), Karrigos (The Hollow Titan).

## Exact palette it has to sit on

| role | hex |
|---|---|
| primary accent (titles, active state, glow) | `#00f3ff` |
| page / panel background | `#0d0f18`, panels `#121622` |
| panel border | `#2e3a59` |
| body text | `#e2e8f0` |
| muted text | `#94a3b8`, dimmest `#64748b` |
| success / ready | `#4ade80` |
| warning | `#f59e0b` |
| danger | `#ef4444` |
| player 1 / player 2 identity | `#00f3ff` / `#f472b6` |

Nearly all text is **light on dark**. Please account for that directly: dark
backgrounds make strokes optically thinner and make tight counters fill in, so
the design should be a touch sturdier than a print-first face would be, with
counters (the holes in a, e, o, 6, 8) kept open.

## Where the type actually gets used

**1. DOM UI** (`font-family` is currently `'Segoe UI', Tahoma, Geneva,
Verdana, sans-serif` — i.e. no design at all):
- The wordmark `ASTRAL CLASH`, ~2.5rem, uppercase, letter-spaced, cyan with a
  glow.
- Panel headings ~1.0–1.3rem, buttons ~0.74–1.0rem, body copy 0.68–0.9rem.
- Fighter names on roster cards, and one-line titles under them.
- **Room codes**, currently `'Courier New', monospace` at 0.8rem. These are
  UUID-ish strings a player reads aloud to a friend, so `0/O`, `1/l/I`,
  `5/S`, `2/Z` and `8/B` must be unmistakable.

**2. Canvas HUD**, drawn with `ctx.font` — this is the demanding half:
- Health and special-meter panels: **9px, 11px, 12px, 13px, 15px, 18px**.
  These are drawn to a 1755×975 virtual canvas that is then scaled to the
  window, so they are frequently rendered at non-integer pixel sizes with no
  hinting help.
- A user setting multiplies all of them by **1.3**, so each size has to work at
  both its base and ×1.3.
- Round timers, the arena-collapse countdown, KO tallies, zone-control seconds.
- Floating damage numbers that fly off a fighter when they are hit.
- Big announcements: `FIGHT!` at ~8.5% of canvas width, `KO`, `Round 2: Draw`,
  and the match result.

## What I need designed

A **display-and-UI family** that covers both jobs, because I do not want two
unrelated typefaces fighting each other on the same screen:

1. **A display cut** for the wordmark, announcements and headings. This carries
   the personality: engineered, slightly wide, confident. Think precision-cut
   metal rather than either a rounded friendly face or a spiky metal-band one.
   Uppercase-first — I use it almost exclusively in caps — but give it real
   lowercase so headings work.
2. **A text cut** for buttons, body copy and especially the HUD: more open,
   less styled, tuned to stay legible at 9px on a dark background. Same
   skeleton as the display cut so they are visibly siblings, but with looser
   spacing, taller x-height, and simplified details that survive being drawn at
   9 pixels with no hinting.

### Non-negotiables

- **Tabular (monospaced) figures**, and please make them the default rather
  than an opt-in feature. Health values, timers and countdowns update every
  frame, and proportional digits make numbers visibly jitter as they change.
  `1` must be the same width as `8`.
- **Unambiguous `0` vs `O`** in both cuts — the room codes depend on it. A
  slashed or dotted zero is fine and probably preferable.
- **x-height at least ~54% of cap height** in the text cut. This is the single
  biggest lever on 9px legibility.
- **No hairline strokes anywhere.** Everything is on a dark background, often
  with a glow behind it; thin strokes disappear.
- Please **avoid the obvious sci-fi clichés**: no chopped-off terminals, no
  stencil gaps, no squared-off circles, no italic-only "speed" slant. Those
  read as 2005 rather than as a current competitive game.

### Character set

- Basic Latin: A–Z, a–z, 0–9
- Punctuation: `. , : ; ! ? ' " ( ) [ ] { } - – — / \ | & @ # % + = < > * _ ~ ^`
- Currency and math: `$ € £ ° × ÷ ± ≤ ≥`
- Symbols the UI already uses: `· ← → ‹ › …`
- Latin-1 accents (à á â ä è é ê ë ì í î ï ò ó ô ö ù ú û ü ñ ç and caps) so
  player-chosen names in European languages do not fall back to another font
  mid-word. Player names are capped at 14 characters.

## Deliverables

1. The font as a **variable `.woff2`** with a weight axis (roughly 400–800),
   plus a static `.woff2` at 400 and 700 as a fallback for anything that cannot
   use the variable file. If a variable font is not practical for you, three
   static weights (400 / 600 / 800) per cut.
2. A `.ttf` or `.otf` source so I can regenerate the web formats myself.
3. The `@font-face` CSS, with `font-display: swap` and correct
   `unicode-range`.
4. **A short integration note covering the canvas problem specifically:**
   `ctx.font = '13px MyFont'` silently falls back to a default face if the font
   has not finished loading, and the HUD starts drawing on the first frame. I
   need to know the right way to gate on `document.fonts.ready` (or
   `FontFace.load()`) before the first HUD paint, and what to fall back to
   sensibly if loading fails — the game currently ships with a vendored
   fallback for its 3D library for exactly this reason and should do the same
   here.
5. A **specimen image** showing: the wordmark; a health-bar row at 11px and at
   14px (11 × 1.3); the digits `0123456789` and `0O 1lI 5S 2Z 8B` at 9px, 13px
   and 18px; and `FIGHT!` large — all rendered light-on-dark in the palette
   above.
6. The **license**, stated plainly. I need to embed and redistribute it in a
   web game, so SIL OFL or a permissive equivalent.

## How I'd like you to work

Show me **three distinct directions** first, as specimen images rather than
prose — I will judge them by looking, and I would rather reject two cheap
sketches than receive one polished thing I did not ask for. For each, show the
wordmark and a 9px HUD line side by side, because a direction that only works
at one of those two sizes is not a usable direction.

Then, once I have picked one, produce the full family and the deliverables
above.

If any requirement here is impossible or a bad idea — particularly the
9px-on-dark target, or asking one skeleton to serve both cuts — say so up
front and tell me what you would do instead, rather than accepting the brief
and quietly missing it.
