# Astral Clash — full audit brief

Paste this into Claude Cowork. It asks for two things in one pass: **every bug
you can find**, and **a UI/UX report thorough enough that nobody later says
"this screen should be redesigned."**

---

## The game

A first-person arena fighter, two builds from one codebase:

| | |
| --- | --- |
| **Online** | `https://astral-clash.vercel.app/` — one player per machine, P2P over PeerJS, joined with a room code |
| **Local** | `https://astral-clash.vercel.app/local` — split screen, two players at one keyboard |

Append **`?debug=1`** to either URL for `window.ACDebug`, which exposes the
fighters, game state and most of the functions. Without it `ACDebug` is
`undefined`. `?acdebug=1` and `?dev=1` do nothing.

Ten fighters, ten arenas, several modes (Classic Versus, Zone Control, Takedown
Race, two co-op modes). Coins, per-fighter upgrades, daily challenges, accounts,
replays, spectating. Three languages: English, Spanish, French.

---

## What I want

1. **Bugs.** Anything that is wrong, in anything you can reach. Not just
   crashes — wrong numbers, wrong labels, state that survives when it should
   not, things that work once and not twice.
2. **UI and UX notes, exhaustively.** The bar is: *a margin being 4px off, or a
   button being 2px taller than the one beside it, is worth reporting.* So is
   anything that is merely confusing, inconsistent, or ugly. I would rather
   read sixty small things than six big ones.

Assume I will fix all of it. Do not filter by "is this worth mentioning".

---

## HOW TO MEASURE — read this before testing anything

A previous audit of this game produced 95 findings. **Five of them were wrong**,
and they cost more time than fifty of the easy ones. Every single one failed the
same way: *something was measured correctly, and the number did not mean what
the reporter thought.* Avoid these.

### 1. Check what a value actually represents before comparing it

The last audit reported "platform tops are solid 20px past their west edges" and
"the wall clamp is asymmetric by 40px", both reproduced 3-of-3, both wrong.
`fighter.x` is the **min corner of the fighter's box, not its centre.** Every
anomaly measured was exactly `width/2 = 20` or `width = 40`.

> **Before reporting any coordinate finding, confirm what the coordinate is.**
> Set a known value, read back what the game draws, and check they agree.

### 2. Computed style is not what is painted

It reported a fighter's name at 3.8:1 contrast, read from
`getComputedStyle(el).color`. That rule carries `filter: brightness(1.45)`,
added for exactly that reason. **A filter is a paint effect and never appears in
computed style.** Measured in pixels, the same text is 7.4:1.

> **For contrast, sample the rendered pixels.** Screenshot the element, take the
> brightest pixel of the glyph, and compute the ratio against the painted
> background. Say in the report which method you used.
>
> The same applies to `opacity`, `transform`, `mask-image` and anything drawn to
> a `<canvas>` — the HUD is a canvas and its text does not exist in the DOM at all.

### 3. A screenshot of a clipped or off-screen element is not a measurement

An element below the fold clips to blank background, and the brightest pixel in
blank background is the background — which reads as a catastrophic 1.0:1 and
looks exactly like a real failure. **Scroll it into view, and treat "I could not
read this" as "no reading" rather than as a result.**

### 4. Check whether the thing you are reporting is deliberate

Two findings last time described decisions, not defects:

- The upgrade row says **Charge** where the stats panel says **Special**. That
  reads as an inconsistency and is not: the upgrade buys *meter rate*, the stats
  row shows the special's *damage*. Two quantities, two names. A checker exists
  specifically to stop them being merged.
- A button reads **Back** before you confirm and **Change Fighter** after. Same
  button, two labels — because it does two different things.

> **This codebase comments its reasoning heavily.** Before calling something
> wrong, grep for the thing you are about to report. If there is a comment
> explaining it, quote it and say why you still think it is wrong — that is a
> much more useful finding than one that does not know the argument exists.

### 5. Say how confident you are, and why

Mark each finding with how you established it: *measured in pixels*, *read from
the DOM*, *reproduced N of N by hand*, *inferred from the code*. If you could not
reproduce something reliably, say so rather than rounding up to a bug.

---

## What to cover

Work through all of it. Note what you could not reach and why.

**Every screen, at 1400×1000, 1280×800, 1000×700 and 400×800:** Home, character
select (both builds — they differ), the Armory, How to Play, Settings, Audio,
Rebind Keys, Account (signed out, signing in, signed up, forgot-password), the
online lobby, the room, Mode select, Arena select, the loading screen, the HUD
mid-fight, the pause screen, round-end, match-end.

**Every state of each one.** Empty, full, longest-possible name (the field caps
at 14), zero coins, everything unlocked, locked, mid-animation, error states.
A name of 14 characters and a 0-coin balance break more layouts than anything.

**The fight itself.** All ten fighters, all ten arenas, all modes. Knockback into
every wall and corner, onto and off every platform, during the arena collapse.
Attacks, specials, dashes, double jumps, the low-health state, KOs, draws, round
transitions, rematches. Mirror matches especially — two players on one fighter
exposes anything that identifies by character rather than by side.

**Online specifically.** Two browser windows. Host and join, both orders. One
side backing out, reconnecting, closing the tab, going to another tab mid-fight.
Spectating. What each client shows when the other does something.

**Accessibility.** Keyboard only, start to finish, both builds — can you play
without a mouse, and can you always see where focus is. Colour-blind palette on.
Screen reader if you can. Touch on a phone for the online build.

**All three languages.** Switch to Spanish and French and walk the same screens.
Untranslated strings and overflowing buttons both show up here.

**The things nobody tests.** Reload mid-match. Browser back button. Two tabs of
the same build. Clear localStorage and start fresh. Open a modal, then another
on top, then Escape repeatedly. Resize the window mid-fight.

---

## Report format

A numbered table, exactly like this — it maps straight onto fixing:

| # | Area | Where | What | Severity | How established | Suggested fix |

- **Severity:** `BROKEN` (does not work / loses progress / blocks play),
  `WRONG` (works but is incorrect, inconsistent or inaccessible), `POLISH`
  (correct but could be better).
- **Where:** build, screen, viewport, and language if it matters.
- **What:** the specific numbers. "41.3px side margins leaving card content
  253px wide in a 400px viewport" beats "margins look too big".
- **How established:** per the measurement section above.

Open with a one-paragraph summary: how many findings, split by severity, and
which three or four you would fix first.

Screenshots for anything visual. Frame numbers or a clip for anything that only
appears in motion.

---

## Already known — do not re-report

- **Matchmaking** does not exist. Room codes are the only way to connect. This
  is deliberate and deferred.
- **The local build's fighter detail renders below the grid**, so Confirm and
  Back need a scroll. Known; needs the select screen reshaped, not restyled.
- **A pale-pink untextured quad fills the lower view on Twin Ramparts.** Known
  and reproducible; cause not yet identified. More detail is welcome, a repeat
  report is not.
- **Email for password resets** goes through a default Supabase template and is
  rate-limited. Not a bug.
- The **95-finding review in this folder** has been worked through. Check it
  before reporting something — but do report anything that is still wrong,
  including anything that was supposedly fixed and is not.

---

## Ground rules

- **Do not change game balance.** Report anything that looks unbalanced; change
  nothing.
- **Report, do not fix.** I want the findings, not a pull request.
- If something is ambiguous — you cannot tell whether it is a bug or a choice —
  report it as a question rather than guessing. Those are often the best items.
