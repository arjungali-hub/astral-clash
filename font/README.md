# Astral Clash — direction 1c "Telemetry"

Display / wordmark : **Recursive Sans** (variable, CASL 0)  — SIL OFL 1.1
HUD, room codes, numerals : **JetBrains Mono** (variable) — SIL OFL 1.1

Both are OFL 1.1: embed, modify and redistribute inside the game freely.
Keep the OFL text with the files. Rename only if you alter outlines.

---

## 1. Get the binaries (2 min, nothing to buy)

Neither file can travel inside this package, so pull the upstream sources:

    Recursive     https://github.com/arrowtype/recursive/releases   (Recursive_VF_1.085.ttf)
    JetBrains Mono https://github.com/JetBrains/JetBrainsMono/releases (JetBrainsMono[wght].ttf)

Or, if you just want web files immediately and will subset later:

    https://fonts.googleapis.com/css2?family=Recursive:CASL,wght@0,400..800&display=swap
    https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400..700&display=swap

Open either URL in a browser, copy the .woff2 URLs out of the CSS, download them.
**Vendor them into /fonts/ — do not hotlink Google in a P2P match.**

## 2. Bake the HUD file (this is the important step)

`ctx.font` accepts no font-feature-settings and no font-variation-settings.
Tabular figures and the slashed zero must therefore be *defaults inside the file*.
JetBrains Mono already ships both as defaults, so the only work is instancing
the weight and subsetting:

    pip install fonttools brotli

    # HUD cut: pin weight 500, Latin-1 + the symbols the UI uses
    fonttools varLib.instancer JetBrainsMono[wght].ttf wght=500 \
      -o jb-500.ttf
    pyftsubset jb-500.ttf --output-file=fonts/astral-hud.woff2 \
      --flavor=woff2 --layout-features='' \
      --unicodes="U+0020-007E,U+00A0-00FF,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+00B7,U+2026,U+2190,U+2192,U+2039,U+203A,U+00D7,U+00F7,U+00B1,U+2264,U+2265,U+20AC,U+00A3,U+00B0"

    # same at wght=700 -> fonts/astral-hud-bold.woff2

    # Display cut: keep the weight axis, pin CASL 0
    fonttools varLib.instancer Recursive_VF_1.085.ttf CASL=0 MONO=0 slnt=0 CRSV=0 \
      -o rec-sans.ttf
    pyftsubset rec-sans.ttf --output-file=fonts/astral-display.woff2 \
      --flavor=woff2 --flavor-version=... --unicodes="<same set>"

Verify before shipping: render `0O 1lI 5S 2Z 8B` at 9px on #0d0f18 and confirm
the slash is visible and `1` and `8` have identical advances.

## 3. Drop in the files here

- `astral-type.css`  — @font-face + the DOM swap against your current 'Segoe UI' stack
- `hud-font.js`      — canvas load gating, fallback, and the ctx.font size table

## 4. License

Ship `OFL.txt` from each upstream repo in /fonts/. Attribution in a credits
screen is courteous but not required by OFL.
