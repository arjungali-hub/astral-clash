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
> **47 checkers.** What remains: **tiers 2, 3 and 5** minus the items above, and
> the three checkers that need a machine with ~2.5GB free. CI supplies that.


Where the game actually is, as of Batch 107: **10 playable fighters, 10 arenas,
5 modes** (Classic Versus, Zone Control, Takedown Race, and two co-op modes —
Boss Fight and Survival Waves), two builds sharing one codebase, coin-based
progression with unlocks and per-character upgrades, synthesised audio, a
tutorial, rebindable controls, gamepad support, a mobile control scheme for
the online build, Spanish and French, and 47 automated checkers.

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

### 9. Progression that survives a browser — ACCOUNTS
**Size: large. Risk: medium. The biggest remaining item, and queued last.**

Coins, unlocks and upgrades live in `localStorage`. Clear site data and it is
gone; switch device and it never existed.

This entry used to recommend **export/import a save** on the grounds that it
needs no server and takes an afternoon. **Overruled, and rightly:** a save code
is cheap for the person who builds it and a chore for every person who uses it —
you have to know it exists, remember to export, and keep the file somewhere.
Accounts are the thing a player actually wants, and "much easier for the user"
is the correct tiebreaker when the cost is only ours.

So: real accounts. Sign in, progression follows you to any device, and a phone
and a desktop are the same save. Implies infrastructure, which is why it is last
rather than first — and why it should not be started while anything cheaper is
still outstanding.

Notes for whoever picks it up:

- **`localStorage` stays the source of truth offline.** The game must remain
  playable with no connection and no account; the account syncs that store
  rather than replacing it. Anything else makes a flaky connection into a lost
  save, which is worse than the problem being solved.
- **Conflict resolution needs deciding before any code.** Two devices both
  earning coins offline is the normal case, not the edge case.
- It touches `progression`, `addCoins`, every unlock check, and both builds —
  so it belongs in `shared/`, like everything else that is not a build fact.

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

### 11. A balance pass driven by data
**Size: medium, ongoing. Risk: low.**

Ten fighters with distinct specials, balanced by reasoning rather than
observation. A small amount of anonymous telemetry — pick rate, win rate per
matchup — turns balance from argument into measurement. **This needs a privacy
decision first**, and the game's own comments say a peer-to-peer match should not
depend on a third party or tell one who is playing. That principle is worth
keeping; a self-hosted count of "fighter X won" need not break it.

### 12. Replays or spectating
**Size: large. Risk: medium.**

The spectator camera already exists for bot-vs-bot matches. Recording a match as
its input stream and replaying it is a natural extension, but a real project, and
it depends on determinism the netcode does not currently guarantee.

---

## Tier 4 — Accessibility and polish

These are small, and their absence is the kind of thing that quietly excludes
people.

### 13. Colourblind support
**Size: small. Risk: none.**

The game distinguishes sides by **cyan and pink**, and the two co-op rings by
blue and orange. For the most common forms of colourblindness some of those pairs
are much closer than intended. Adding a shape or icon alongside the colour — and
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

### 19. The 563KB single file
**Size: large. Risk: high. Think hard before starting.**

`index.html` is one file containing the whole game. It works, the sync machinery
makes two builds of it safe, and `art/coverage.py` proves nothing drifts. But it
is at a maintainability ceiling: every tool here — the definition scanner, the
CSS parser, the markup differ — exists because there is no module system to lean
on.

Splitting into modules with a small build step would make ordinary tooling work
again. It would also invalidate most of the nine interface lists and the coverage
map, which are the things currently keeping the two builds honest. **Do not start
this without a plan for what replaces those guards**, and not before CI exists to
catch what the change breaks.

### 20. Test suite runtime
**Size: small. Risk: none.**

The full suite is roughly 40 minutes serially, because every checker drives a
headless browser software-rendering a 3D scene, and the runner enforces one at a
time for good reason. On CI, with more memory, some could run in parallel safely.

### 21. Know when it breaks for real players
**Size: small. Risk: low — but a privacy decision.**

There is no error reporting. If the game throws on someone's machine, nobody
finds out. Even a minimal "an error occurred" counter would close that loop. Same
privacy principle as item 11.

---

## What I would actually do next

Items 1-6, 8, 10, 13-17 are done; 18 was looked at and declined.

**What is left is item 9, accounts** — the biggest remaining item, and the one
asked for in place of export/import. Last on purpose: it is the only thing on
this list that adds infrastructure, and everything above it was cheaper.

After that, the open items are the ones that were always going to need a
decision rather than an afternoon: telemetry for balance (11) and error
reporting (21), both of which need a privacy call first; replays (12), which
depends on determinism the netcode does not guarantee; and the 563KB single file
(19), which should not be started without a plan for what replaces the nine
interface lists.

Deliberately NOT next: item 19, the 563KB single file. It is the largest and
riskiest thing on this list and it would invalidate most of the machinery
currently keeping the two builds honest. It needs a plan for what replaces those
guards before a line of it is written.

Two lessons from this round worth keeping:

- **Measure before you judge size.** Item 17 sat deferred as "large" for
  several batches. Counting took twenty minutes and showed it was a day.
- **A keyword search answers a question about vocabulary, not behaviour.**
  Item 5 claimed a feature was missing because the code called it something
  else.
