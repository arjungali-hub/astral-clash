# Astral Clash — what's left, in the order I'd do it

> **Tiers 1 and 4 are done.** Items 1-4 and 13-17 below are kept for the
> reasoning, each marked with what actually happened. Tier 1 landed CI and three
> new checkers; tier 4 landed the colourblind palette, accessible names, a
> contrast checker, gamepad menu navigation, and a measurement that reframed
> localisation. **43 checkers now, 13/13 green on the fast set.**
>
> Two numbers worth carrying forward:
>
> * cyan against pink separates at **102.7** Lab units for normal vision and
>   collapses to **24** under deuteranopia. The replacement pair holds at
>   **126.8**. The problem was real and the fix is measured, not asserted.
> * localisation is **260 strings, 2,263 words** — a translator and an
>   afternoon, not a budgeted project. That is the number item 17 was missing,
>   and it inverts the recommendation.
>
> What remains: **tiers 2, 3 and 5**, and the three checkers that need a machine
> with ~2.5GB free. CI supplies that on the next push.


Where the game actually is, as of Batch 107: **10 playable fighters, 10 arenas,
5 modes** (Classic Versus, Zone Control, Takedown Race, and two co-op modes —
Boss Fight and Survival Waves), two builds sharing one codebase, coin-based
progression with unlocks and per-character upgrades, synthesised audio, a
tutorial, rebindable controls, gamepad support, and 38 automated checkers.

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

### 5. Interpolate the remote fighter
**Size: small. Risk: low. Highest visible payoff on this list.**

The netcode syncs `STATE` packets and lets each client own its own fighter. There
is **no interpolation and no prediction** — the remote fighter snaps to each
packet as it lands. On a good connection that is fine; on a mediocre one it
reads as stutter, and stutter reads as "this game is janky" more than almost
anything else.

Interpolating between the last two states is a contained change to the puppet
path only. Prediction is a much larger job and should not be attempted first.

### 6. Reconnect after a drop
**Size: medium. Risk: medium.**

A dropped connection currently pauses and says so, which is honest and
unsatisfying. A brief grace period with an automatic re-handshake would save
matches that are currently lost to a Wi-Fi blip.

### 7. Something better than room codes
**Size: medium–large. Risk: medium.**

Hosting and sharing a code works and requires a friend and a second channel to
send the code through. A "find a game" queue needs a matchmaking server — the
first piece of infrastructure this game would own. Worth doing only once items
5 and 6 make a match with a stranger pleasant.

### 8. Let phones play online
**Size: medium. Risk: low.**

The online build shows a desktop-only notice on touch devices. The local build
has a complete touch scheme. Those two facts sitting next to each other are hard
to justify: the controls exist, they are just not wired into the build that
would benefit most from a larger player pool.

---

## Tier 3 — Depth

### 9. Progression that survives a browser
**Size: medium. Risk: low.**

Coins, unlocks and upgrades live in `localStorage`. Clear site data and it is
gone; switch device and it never existed. The smallest useful step is **export
and import a save** as a code or file — no server, no accounts, an afternoon.
Accounts are the larger version and imply infrastructure.

### 10. Something to chase
**Size: medium. Risk: low.**

There are no achievements, challenges or dailies. Progression currently ends
when everything is unlocked. Daily challenges ("win a Zone Control match without
using your special") are cheap to author and give the coin economy somewhere to
go after the roster is complete.

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

### 17. Localisation
**Size: large. Risk: low.**

All strings are inline English. Worth doing only if there is an audience asking
for it, but the longer it waits the more strings there are.

---

## Tier 5 — Engineering health

### 18. Drive the last fork to zero
**Size: medium. Risk: low.**

One definition differs with a real body on both sides: `Fighter.readHumanInput`,
eight lines — two people at one keyboard against one person with a mouse. It
could become data (a control-scheme table) rather than code, which would make the
two builds *identical* in every definition.

Genuinely optional. Eight lines with a written reason is not a problem; it is
just the last one.

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

In order, and stopping to reassess after each:

1. **CI** (item 1) — it costs an afternoon and makes every item below it safer.
2. **The three unverified checkers** (item 2) — free once CI exists.
3. **Interpolate the remote fighter** (item 5) — the biggest visible improvement
   per hour on this entire list.
4. **Colourblind support** (item 13) — small, and it is the one item here that
   changes who can play.
5. **Export/import saves** (item 9) — an afternoon, and it stops progress being
   one cleared cache away from gone.

Everything else is real but can wait for one of those to tell you something new.
