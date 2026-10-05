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

`AC_ONE_SIDE_PER_CLIENT` is the one that carries real behaviour. It is the
answer to "does one player get the whole screen", and therefore also to:

- **does this build play on a phone.** Online does, through `shared/touch.js`;
  local does not and shows `#desktop-only`. One line in shared code decides it —
  `if (IS_TOUCH_DEVICE && !AC_ONE_SIDE_PER_CLIENT) showDesktopOnlyNotice()` —
  rather than a fork.

## The shared modules

`SHARED_MODULES` in `art/sync_local.py` is the single source of truth, in load
order. Adding one is a one-line change there plus a `<script>` tag in
`index.html`; everything else derives from it — the tags in both builds, the
`block()` fallback, and the haystack every porter searches to decide whether a
build *wants* a given id, selector or statement.

    roster.js animation.js      pure data and timing; may load before three.js
    props.js characters.js      build THREE objects at load time
    common.js                   the game
    i18n.js                     English/Spanish/French
    touch.js                    the mobile control scheme (online only)

That list was five hardcoded `io.open` calls and six hand-written five-tuples
until `i18n.js` was added to the tag order, loaded in both builds, and the
markup porter *still* could not see that it wanted `#btn-lang` — because the
haystack it searched was one of those tuples. The Language row reached the
online build and nowhere else, which is precisely what the porters exist to
prevent.

### Localisation

`shared/i18n.js` keys on **the English source string itself**, not invented ids.
One `localiseDOM()` pass localises the whole of the markup with no markup edits,
a missing entry falls back to English rather than showing a key, and the pass is
idempotent by construction (translated text no longer matches an English key),
which is what makes it safe to call from the frame loop.

The cost of that choice: **a mistyped key is invisible.** It does not throw, the
string simply stays English. `tests/langcheck.js` exists for exactly this — it
collects every prose key from the live DOM and fails on any table entry that
matches nothing. Run it after touching any user-visible string.

    python art/strings.py                 how many strings exist, by where they live
    python art/strings.py --out FILE      a catalogue for a translator

## Checking that nothing has slipped a key

    python art/coverage.py            every line, by what keeps it in step
    python art/coverage.py --lines    the unkeyed ones, with their region

It reports **170 unkeyed duplicated lines**, and the breakdown is the part that
matters, because one of those three numbers is *supposed* to move:

| | | |
| --- | --- | --- |
| `code` | 92 | almost all `window.ACDebug` |
| `comment` | 66 | prose beside code that is itself keyed |
| `brace` | 12 | `}` / `});` on their own line |

`comment` and `brace` are structural and should sit still. **`code` grows by one
line for every `ACDebug` export added**, and that is correct: each build exports
what it has, so the lists are deliberately not compared, and a missing export
fails a checker loudly instead of the game failing quietly.

So the rule is not "this number must not grow". It is: **if `code` grows by more
than the exports you just added, something new has no key — find it.** Measure
it the honest way rather than trusting the figure above, which has already gone
stale once (it read 88 for several batches while the real number was 91):

    git worktree add /tmp/ac-base HEAD~1
    (cd /tmp/ac-base && python art/coverage.py)
    git worktree remove /tmp/ac-base --force

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

## CI

`.github/workflows/ci.yml`, three jobs: `guards` (no browser, seconds), `fast`
(sub-minute checkers, gates the push), `slow` (the heavy ones, nobody waits).

**It had never passed once** between being added and the fix below. Two causes,
neither of them a bug in the game, and both of the same shape — *a file the
checkers need is git-ignored, so it does not exist on a fresh checkout*:

- `tests/.css-baseline.json`. `cssparitycheck` compared against it and called
  `check(false)` when it was absent, so the slow job failed on every run by
  design. A missing baseline is a FIRST RUN, not a regression: it now seeds one,
  says plainly that it compared nothing, and passes. CI caches the file on a
  rolling key so the next run genuinely diffs against the last.
- `tests/screenshots/`. `page.screenshot({path})` into a missing directory
  throws ENOENT. The harness creates it on launch.

The lesson generalises: **anything in `.gitignore` that a checker reads must
either be created on demand or restored by CI.** A red tick that is always red
reports exactly as much as no tick at all.

## Other standing rules

- Commit and push after every update, without asking. Work on `main`.
- Never write Python through a shell heredoc when it contains `\n`, `\t` or `\b`
  escapes — they get mangled on the way through. Use the Write tool.
- Call the split-screen build **local**, never "legacy" or "archived".
