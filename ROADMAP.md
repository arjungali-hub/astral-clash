# Astral Clash — what's left, in the order I'd do it

> **Tiers 1 and 4 are done, and so are items 8 and 17.** Everything below is
> kept for the reasoning, each marked with what actually happened.
>
> * **Item 5 was wrong, and the error was mine.** It claimed "no interpolation
>   and no prediction". The game has eased the remote fighter for a long time;
>   I grepped for `interpolat`, `prediction` and `rollback`, got nothing, and
>   concluded the behaviour was absent. The code calls it easing. Writing
>   `tests/netsmoothcheck.js` to prove the existing behaviour then found a real
>   bug under it — see below.
> * **Item 17 (localisation) is done.** Spanish and French, keyed on the English
>   source string. The measurement that unblocked it: **260 strings, 2,263
>   words** — a translator and an afternoon, not a budgeted project.
> * **Item 8 (phones online) is done**, and the two builds were backwards.
>   Online, which gives one player the whole screen, refused to run on a phone;
>   local, which splits that screen between two people, had a full touch scheme
>   behind a notice a script click went straight through.
> * cyan against pink separates at **102.7** Lab units for normal vision and
>   collapses to **24** under deuteranopia. The replacement pair holds at
>   **126.8**. Measured, not asserted.
>
> **48 checkers.** What remains: **tiers 2, 3 and 5** minus the items above, and
> the three checkers that need a machine with ~2.5GB free. CI supplies that.


Where the game actually is, as of Batch 107: **10 playable fighters, 10 arenas,
5 modes** (Classic Versus, Zone Control, Takedown Race, and two co-op modes —
Boss Fight and Survival Waves), two builds sharing one codebase, coin-based
progression with unlocks and per-character upgrades, synthesised audio, a
tutorial, rebindable controls, gamepad support, a mobile control scheme for
the online build, Spanish and French, and 48 automated checkers.

That is a complete game. What follows is what stands between it and *finished*.

Each item says **why it matters**, roughly **how big** it is, and what it
**risks**. Ordered by leverage, not by appeal.

---

## Tier 1 — Close the confidence gap

These are cheap and they make everything after them safer. Nothing below this
tier is as valuable per hour spent.

### 1. Continuous integration
**Size: small. Risk: none.**

38 checkers exist and they run when someone remembers. A GitHub Actions workflow
running `node tests/run.js` on every push turns "I think this still works" into a
fact, and a green tick on the commit.

It also **permanently solves item 2**: a CI runner has 7–16GB free, where this
machine has had under 1GB all week.

Worth splitting into two jobs — the fast checkers (under 60s) on every push, the
slow ones nightly — so a push gets an answer in three minutes rather than forty.

### 2. Verify the three unverified checkers
**Size: trivial once CI exists. Risk: none.**

`netcheck` (online multiplayer), `leakcheck` (ten rematches, no growth) and
`framerateccheck` (30fps against uncapped) are written, committed, and have never
completed a run. They need ~2.5GB free. `netcheck` gets seven assertions in
before a browser dies.

Nothing in them is known to be broken. Nothing in them is known to work either,
and online multiplayer is the part with no other coverage.

### 3. Decide what "the bot plays a competent match" means
**Size: medium. Risk: low.**

The last item on the original brief that no assertion can settle, because
"competent" is a judgement. Make it measurable: the bot at each difficulty
should win *some* defined fraction against a scripted baseline opponent, and
never lose to one that stands still. Then it is a checker rather than a vibe.

### 4. A knockback sweep
**Size: small. Risk: none.**

`teleportcheck` covers knockback only insofar as both route through the same
displacement path. That is an argument, not a test.

---

## Tier 2 — The online experience

The single biggest gap between this and a game people play with strangers.

### 5. ~~Interpolate the remote fighter~~ — DONE, and the entry was wrong
**What this actually was: a research error that turned into a real bug fix.**

This said there was "no interpolation and no prediction". There has been easing
on the puppet path for a long time — `netApplyRemote` eases toward the buffered
state, snaps past `NET_SNAP_DIST` so a genuine dash teleport stays instant, and
sets facing outright on purpose, because easing a direction makes aim read as
laggy in exactly the moment you are judging where someone points.

I concluded it was absent by grepping for `interpolat`, `prediction` and
`rollback` and getting nothing. The code calls it easing. **The lesson is about
the method, not the result:** a keyword search over a codebase that names things
its own way answers a question about vocabulary, not behaviour.

Writing the test to prove the existing behaviour then found a genuine bug:

    const k = Math.min(1, NET_LERP * dt);          // wrong away from 60fps

`0.35 * dt` reaches 1.0 at dt = 2.857 — about 21fps — so below that the easing
was a plain snap, every frame, with the clamp making it look deliberate. Now
`1 - (1 - NET_LERP)^dt`: the same smoothing applied dt times, identical at
dt = 1 so the tuned 60fps feel is untouched, and asymptotic everywhere else.

**Prediction is still not done**, is a much larger job, and should not be
attempted until someone reports stutter that this does not cover.

### 6. ~~Reconnect after a drop~~ — DONE
**Size: medium. Risk: medium — and the risk was where it was expected.**

A 15-second grace window. The match pauses with a countdown instead of ending,
the joiner redials every 1.8s, the host keeps its peer alive and accepts, and a
channel that re-opens inside the window resumes the match rather than sending
both players back to the roster.

**Keeping the peer alive is the whole trick.** The host's peer id *is* the room
code, so the old path — `netTeardown` destroys the peer — destroyed the code
too, which is why "just reconnect" was never as simple as it sounded. The
signalling layer already did exactly this for its own drops
(`peer.on('disconnected')` calls `peer.reconnect()` with the same id, so the
code survives); this is the same idea one layer down.

**The hazard, and it is a real one.** `netActive()` is now deliberately TRUE for
the whole grace window. PeerJS flips `conn.open` to false the instant a channel
closes, and dozens of guards hang off `netActive()` — including `isNetPuppet()`,
which decides whether the opponent is driven by the wire or by this machine. A
grace window that let `netActive()` go false would, for those seconds, tell the
game there was no opponent: the puppet stops being a puppet and one client
starts driving BOTH fighters. `reconnectcheck` asserts that directly rather than
inferring it.

A `RESYNC` packet carries what nothing else ever re-states — round, round wins,
the Zone Control and Takedown Race tallies, both HP bars and both meters. Not
positions: a `STATE` packet arrives within a frame or two and the easing takes
it from there, whereas a position from several seconds ago would be a visible
jump backwards. It arrives over the wire, so every field is range-checked — a
`NaN` in an HP bar is a fighter that can never be knocked out.

Two things found by writing the test, both real:

* `netFakeConnect` built a connection whose `on()` was a no-op and then
  *inlined* what `netBindConnection`'s open handler does — so eighteen netcode
  checkers were exercising a copy of the production path rather than the path,
  and the reconnect path could not be tested at all, since its whole trigger is
  an open firing during a grace window. It also set no `net.peer`.
* After the window expired the pause screen kept offering "Trying to
  reconnect… 15s" forever. `onNetLost()` only repaints that screen on its
  FIGHT/INTRO/DEATH branch, and a grace window has already paused the match.

### 7. Something better than room codes
**Size: medium–large. Risk: medium.**

Hosting and sharing a code works and requires a friend and a second channel to
send the code through. A "find a game" queue needs a matchmaking server — the
first piece of infrastructure this game would own. Worth doing only once items
5 and 6 make a match with a stranger pleasant.

### 8. ~~Let phones play online~~ — DONE
**Size: medium. Risk: low.**

"Those two facts sitting next to each other are hard to justify" was right, and
understated it: the local build's touch scheme was not merely in the wrong
build, it was *unreachable* — `#desktop-only` covered the screen while the whole
scheme sat live behind it. The old `mobilecheck` asserted both "local refuses on
a phone" and "local build on a phone: single-player vs bot" in the same run.

What it was NOT was a wiring job. The retired scheme drove turn RATE from a
joystick's absolute deflection, which makes aiming an integration problem — you
steer toward a target and then steer back to stop. `shared/touch.js` is a
rewrite on the model every mobile shooter uses: a floating left stick, relative
drag-to-look on the right, tap-to-fire, and the action buttons under the right
thumb's arc. Local gets none of it, by the user's call and on the evidence —
split screen on a phone was played and reported as "really bad and hard to
play".

---

## Tier 3 — Depth

### 9. ~~Progression that survives a browser~~ — ACCOUNTS, built
**Size: large. One step left, and it is not a code step — see below.**

Sign in with an emailed link; coins, unlocks, upgrades and today's challenges
follow you to any other device. **Everything is written except the Supabase
project itself**, which needs someone with the account to create it — see
"Finishing accounts" at the bottom of this file.

Three decisions worth keeping.

**localStorage is still the truth.** This is a sync target bolted onto the side
of the existing save, never a replacement. Every write goes to localStorage
first and unconditionally, so a missing project, a blocked CDN, a dead network
or a player who never signs in all behave exactly as before. Anything else turns
a flaky connection into a lost save, which is worse than the problem being
solved.

**Conflicts are ASKED, never guessed.** Two devices both earning coins offline
is the normal case, and both obvious answers lose data. Last-write-wins quietly
discards the newer save the moment the older device is opened second.
Merge-by-maximum refunds coins that were spent — play on A, never open B, and
the merge hands back the 500 you spent while you keep what you bought. So when
two real saves disagree the player is shown both, **with their coin totals,
fighter counts and dates on them**, because "cloud or local?" is unanswerable
without those. Everything else (no cloud save, no local save, they already
agree) is decided without asking, because nothing can be lost.

**Accounts are online-only**, gated on `AC_ONE_SIDE_PER_CLIENT` — the same flag
that decides touch controls, and for the same underlying reason: how many people
share this screen. The local build is two people at one keyboard sharing a
single `progression` object with a p1 and a p2 side; "whose account is this" has
no good answer there, and a sign-out would take both saves. Nothing is lost by
it: the builds share one progression store, so a split-screen player signs in
once on the online build.

Found by `accountcheck`, and all real:

* a pending conflict was outranked by "signed in" on the settings row, so it
  read a reassuring **On** at exactly the moment the player had a decision to
  make about which of their saves survives;
* `accountSignIn` checked availability before the address, so a typo'd email
  came back as "unavailable" — sending somebody to check their wifi over a
  missing `@`;
* the panel asked "is this configured" before anything else, which made every
  state behind it unreachable.

### 10. ~~Something to chase~~ — DONE
**Size: medium. Risk: low.**

Three daily challenges, drawn from a pool of ten, **seeded from the date**. That
is the decision worth recording: "three at random when you open the game" is
cheaper and worse, because it makes the challenge a property of your client
rather than of the day — nobody can compare them, and a reload rerolls anything
inconvenient. Hashing the date gives every player the same three without a
server knowing who anybody is, which is the principle the netcode already holds
to.

**No challenge adds a counter.** Every predicate reads the match summary
`endMatch()` already builds for its own results screen — damage dealt, largest
hit, specials used, round times, the mode, the score. A counter added for a
challenge is a counter nothing else validates.

Three implementation notes, each caught by a guard rather than by review:

* `addCoins` lives inside `bootGame()`, so the module cannot pay anything. It
  returns what was *earned* and the build pays — which is the better split
  anyway. The sync's shared-scope guard refused to write the build until it
  moved.
* The first version scored both sides into one list and paid in a second loop,
  by which point nothing knew whose challenge was whose: **both players' rewards
  would have gone to Player 1.** Now scored and paid one side at a time.
* The markup porter could not carry the panel, and was right not to — it anchors
  on the preceding sibling's id, and the online home card does not exist in the
  local build, which opens straight into the picker. The container is a
  documented difference; the contents come from `dailyPanelHTML()` in both.

### 11. ~~A balance pass driven by data~~ — DONE
**Size: medium. The privacy call was the whole of it.**

Ten fighters balanced by reasoning rather than observation. Now each finished
match reports one row: *"on this date, Kaelen beat Lyra in Classic, 2-0"*.
Add them up and `balance_by_fighter` says who is winning too often.

**The privacy design is structural, not a promise.** There is no column for a
player, an account, a device, a session, or a time finer than a date - so there
is nowhere to put one. A rule saying "do not log the user id" lasts exactly as
long as the next person who has not read it; a schema with no such column lasts.

Specifically absent, and each asserted by name in `telemetrycheck`:

* no user, account or username
* no device, browser or screen - nothing fingerprintable
* **no session or match id.** This is the one that would be easy to add and
  tempting. The instant two rows can be linked as "the same person", a sequence
  of matches becomes a profile.
* **no timestamp.** The date is a `DATE` column defaulted server-side, so the
  client never sends one at all and the finest grain available is a day. A time
  to the second is very nearly a unique identifier once combined with anything.

Write-only for everyone: anyone may `INSERT`, nobody may `SELECT`. The game must
be able to report without an account, and nobody holding the public key may read
back what others reported.

Draws and the two co-op modes report nothing - "who beat whom" has no meaning
when nobody did, or when both players were on the same side.

Off switch in Settings, defaulting on. The data carries nothing about a person,
which is a good argument that a switch is unnecessary and no argument at all for
refusing to offer one.

### 12. Replays or spectating
**Size: large. Risk: medium.**

The spectator camera already exists for bot-vs-bot matches. Recording a match as
its input stream and replaying it is a natural extension, but a real project, and
it depends on determinism the netcode does not currently guarantee.

---

## Tier 4 — Accessibility and polish

These are small, and their absence is the kind of thing that quietly excludes
people.

### 13. Colorblind support
**Size: small. Risk: none.**

The game distinguishes sides by **cyan and pink**, and the two co-op rings by
blue and orange. For the most common forms of colorblindness some of those pairs
are much closer than intended. Adding a shape or icon alongside the color — and
a palette option — is a contained change with a real audience.

### 14. A screen-reader pass
**Size: small–medium. Risk: none.**

Four ARIA attributes in the whole build. `keyboardcheck` proves every control is
reachable and escapable by keyboard, which is the hard half. Labelling what those
controls *are* is the easy half and is not done.

### 15. Contrast audit
**Size: small. Risk: none.**

Muted greys on dark blue are used heavily for secondary text. Some of it is
likely below WCAG AA. Worth measuring rather than guessing.

### 16. Gamepad in the menus
**Size: small. Risk: low.**

A gamepad plays the game but does not appear to navigate the menus, so a
controller player still reaches for the mouse to pick a fighter.

### 17. ~~Localisation~~ — DONE (Spanish and French)
**Size: judged "large" on a guess. It was one day.**

"Worth doing only if there is an audience asking for it, but the longer it waits
the more strings there are" — and it never said how many. `art/strings.py` was
written to answer exactly that before committing to anything: **260 strings,
2,263 words.** That number inverted the recommendation on its own.

`shared/i18n.js` keys on the English source string rather than invented ids, so
one DOM pass localises all 134 markup strings with no markup edits and a missing
entry falls back to English. Two tiers, because prose and labels need different
granularity: text nodes matched exactly, and the tutorial's 13 paragraphs keyed
on their whole collapsed `textContent` and translated as HTML — those wrap
phrases in `<b>`, so their text nodes are fragments, and no language keeps
English's word order.

Adding a language is now a table in one file. The cost of the design is that a
mistyped key is invisible, which is what `tests/langcheck.js` is for.

---

## Tier 5 — Engineering health

### 18. Drive the last fork to zero — LOOKED AT, AND DECLINED
**Size: small. Risk: low. Reward: negative.**

One definition differs with a real body on both sides: `Fighter.readHumanInput`.
The entry said eight lines; the local body is 36, because the split-keyboard
scheme is a scheme, not a variation — left/right TURN there, because two people
at one keyboard cannot both have the mouse, where online they STRAFE and the
mouse aims.

Unifying it means putting all 36 of those lines into the online build, where
`soloScheme()` is always true and they could never run. **That trades a
documented, understood, stable fork for dead code in a shipped build**, and dead
code is the thing every guard in this repo exists to stop accumulating.

The entry already said "genuinely optional. Eight lines with a written reason is
not a problem; it is just the last one." That was right, and the answer is to
leave it. Zero is a satisfying number, not a good reason.

### 19. The 563KB single file — KEEPING IT, AND MAPPING IT INSTEAD
**Size: large. Risk: high. Decided: do not split.**

`index.html` is one file holding the whole game. The case for splitting is real:
every tool in `art/` - the definition scanner, the CSS parser, the markup
differ - exists *because* there is no module system to lean on, and with real
modules ordinary tooling would do that work for free.

The case against is stronger, and it is not sentiment. **Those same tools are
the only thing keeping the two builds honest.** The nine interface lists, the
coverage map and every drift guard assume each build is one file they can read
end to end. Splitting retires the safety net and the reason for the safety net
on the same day, and the gap between is exactly where the bug class it prevents
lives - the online build fixed and the local build not, silently, for batches.

**The complaint underneath "split it" is "I cannot find anything", and that is
answerable on its own.** So:

* `docs/MAP.md` lists every top-level definition in every file, with the first
  line of its comment. Generated by `python art/outline.py --write`, because a
  hand-written index of 11,000 lines is wrong within a week and worse than
  nothing once it is.
* anchors are TEXT, not line numbers. `function netApplyRemote` is findable
  forever; a line number is stale after the next edit.
* six section banners were added where the file had none - one stretch ran for
  over 150 definitions without a landmark, which is the same as having none.

Revisit only if the current shape starts genuinely obstructing a change. "It is
a big file" is aesthetics; "I cannot change this safely" would be a reason, and
that is not where it is.

### 20. ~~Test suite runtime~~ — DONE
**Size: small. Risk: none.**

The suite ran one checker at a time behind a lockfile. That is right on the
development machine - two software-rendered 3D scenes at once made it unusable,
which is why the lock exists - and wrong on a runner with four cores and 16GB,
where serialisation bought nothing but an hour.

`node tests/run.js --jobs N` now runs N at a time, defaulting to **1** so the
machine this was written on is unaffected. CI passes `--jobs 3`.

Three things were already true and made it safe: each checker is its own
process, each starts its own server on an OS-assigned port, and each launches
its own browser. **One thing was not** - `cleanup.js` kills every headless
Chrome whose command line mentions swiftshader, which in parallel is a
sibling's browser as readily as a leftover. The sweep moves to the end when
more than one job is in flight.

Combined with the three-way shard, the slow job went from "57 minutes and
cancelled with five checkers never run" to comfortably inside its budget.

### 21. ~~Know when it breaks for real players~~ — DONE
**Size: small. Same privacy decision as 11, same answer.**

Nothing reported a crash, so a fault on somebody's machine was a tab they
closed. Now `window.onerror` and `unhandledrejection` send a message, a file and
a line, and which build - into the same aggregate-only table design as 11.

Three details that matter more than they look:

* **the same fault fires every frame** once the loop is broken, so a message is
  reported once per page load and at most five distinct ones go out. A broken
  loop must not become a broken server.
* **a file and a line, not a stack.** A stack names the functions a player
  happened to be inside, which is more about their session than is needed to
  recognise a bug.
* **`unhandledrejection` as well as `error`.** The rejected promise nobody
  caught is the one that normally goes unnoticed - it prints to a console
  nobody is reading and breaks nothing visible.

`errors_by_message` groups them, so "is this happening to lots of people"
is one query.

---

## What is left

**Item 7, matchmaking** - deferred deliberately, not forgotten. A "find a game"
queue needs a small always-on server, and more importantly it needs a
POPULATION: with two people waiting it pairs them, with one it leaves them
staring at a spinner, which is worse than a room code that always works. The
signal to build it is players asking for it.

**Item 12, replays** - depends on determinism the netcode does not guarantee.
A real project, and the one item here that is genuinely blocked rather than
merely unscheduled.

**Item 18** was looked at and declined: unifying the last forked definition
means putting 36 lines of split-keyboard scheme into the online build where
they could never run.

Everything else on this list is done.
