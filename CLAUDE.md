# Astral Clash — working rules

## There are two builds, and every change applies to both

    index.html          online: one client drives one fighter, against a peer
    local/index.html    local:  split screen, two players at one keyboard

**Never type the same code into both files.** Write it once and let the sync
carry it:

1. Make the change in `index.html`. If nothing in it reads `bootGame()`'s scope,
   it belongs in `shared/*.js` instead and both builds get it for free.
2. Run `python art/sync_local.py`. It regenerates `local/index.html` and prints a
   line per surface — every one should say `ok`.
3. Run `node tests/bootcheck.js`. Ten seconds, both builds: does each load, and
   does a frame of a real fight run clean?

The pre-commit hook refuses a commit whose local build is stale, whose builds do
not load, or which introduces an undocumented difference. `git commit --no-verify`
skips it; do that rarely and knowingly.

### Why this is a rule and not a preference

The builds drifted for dozens of batches, and the cost was silent bugs, not
untidiness. Fixes that reached one build and not the other:

- the local crush arena rendered untextured — every `attachPhotoSurface` call was
  missing
- the local right gamepad stick was dead from the day it was added: `pollGamepad`
  never returned `lookX`, which the input code already read
- the local press-to-continue prompt read `BINDINGS.attack` on a per-side object,
  so the key the player had bound did nothing
- the online gamepad strafed the *opposite* way to its own keyboard
- the online results screen printed `0-2` whenever p2 won
- `prefers-reduced-motion` was ignored for the result flourish
- the online Glow button read "On" after a reload however it was set

Each was invisible because nothing compared the two files at that particular
level.

## When a difference is genuine

Put it on the matching list in `art/sync_local.py`, **with a reason**. The sync
reports anything that differs without one, and exits non-zero:

| list | keys on |
| --- | --- |
| `INTERFACE` | a top-level JS definition |
| `FIGHTER_INTERFACE` | a method inside `class Fighter` |
| `CSS_INTERFACE` | a selector, and *which declarations* differ |
| `MARKUP_INTERFACE` | an element id |
| `WIRING_INTERFACE` | `getElementById('x').addEventListener(...)`, by id |
| `LISTENER_INTERFACE` | a top-level listener, by target + event |
| `STATEMENT_INTERFACE` | top-level statements, compared as a set |
| `COMMENT_INTERFACE` | a comment sentence, by fuzzy match |
| `HEAD_INTERFACE` | the document head |

The three build facts that are *supposed* to differ are declared at the top of
each file and nowhere else: `AC_ONE_SIDE_PER_CLIENT`, `AC_BASE`, `AC_BLOOM`.
Everything downstream asks them rather than forking.

## Checking that nothing has slipped a key

    python art/coverage.py            every line, by what keeps it in step
    python art/coverage.py --lines    the unkeyed ones, with their region

It reports ~88 unkeyed duplicated lines: 85 are `window.ACDebug` (each build
exports what it has, and a missing export fails a checker loudly rather than the
game quietly) and three are `<!DOCTYPE html>`, `</head>`, `<body>`. **If that
number grows, something new has no key — find it.**

The guards compare things *named or keyed the same*. Code hand-written into both
files under different names is invisible to all of them; that is how
`playerName`/`displayName` and `applySoloControls` became two spellings of one
thing. The rule at the top of this file is what prevents it.

## Tests

`node tests/run.js` runs every checker, one at a time, behind a lockfile — they
each drive headless Chrome software-rendering a 3D scene, and two at once made
this machine unusable. `node tests/run.js smoke localcombatcheck` runs a subset.

`tests/cssparitycheck.js` compares against a local snapshot
(`tests/.css-baseline.json`, git-ignored). After an intended visual change,
re-save it: `node tests/cssparitycheck.js --save`. It samples mid-transition
colours occasionally, so confirm a failure reproduces before chasing it.

## Other standing rules

- Commit and push after every update, without asking. Work on `main`.
- Never write Python through a shell heredoc when it contains `\n`, `\t` or `\b`
  escapes — they get mangled on the way through. Use the Write tool.
- Call the split-screen build **local**, never "legacy" or "archived".
