# Astral Clash — full audit (Oct 31)

Oct 31, 2026 · @Krish Gali

## Summary

67 findings: 3 BROKEN, 32 WRONG, 27 POLISH, and 5 questions where I could not tell bug from choice. Fix these first:

1. **Online hits do almost nothing (#1).** On the victim's machine a landed hit only removes HP: no knockback, no hitstun, no hit flash, no meter for taking damage. The `HIT` handler passes no attacker, so `applyDamage` returns early.
2. **A disconnect that never comes back strands both players (#2).** The pause screen never resolves: over the real network the 15s reconnect countdown restarts forever (over my relay it froze at "1s"), with Resume disabled, because the grace-expiry branch can never run.
3. **The room's fighter grid collides with the fighter detail (#11, #12).** On desktop the grid's right column covers the start of Confirm, and a click there picks a locked fighter. At phone width the detail is drawn over the grid and Back is off-screen. One grid-column fix covers both.
4. **Four translated strings never show (#52).** Markup that wraps across source lines defeats `localiseDOM`'s key match. A one-line whitespace collapse fixes them; #53–55 are strings that have no key at all.

Also worth an early look: collapsed geometry stays solid (#6), dashes climb blocks you cannot walk onto (#5), and a signed-out player's coins appear and then vanish on reload (#9).

## How this was tested

Everything ran against the live site (`astral-clash.vercel.app`, both builds, `?debug=1`) in a headless Chromium in my workspace. I read your repo's code, `CHECKLIST.md` and the Oct 27 review first, and grepped for the reasoning before reporting anything. Your Chrome was not reachable from this session, so nothing touched your browser or your save.

- **Menus:** every screen and state in the brief, at 1400×1000, 1280×800, 1000×700 and 400×800, in EN/ES/FR, both builds. Online was also run as a touch phone at 400×800 and 800×400. Each capture logs layout boxes, overflow, sibling sizes and target sizes from the DOM. Edge states used a 14-character name and a 0-coin balance.
- **Contrast:** measured in pixels, per your rule. Each text element was captured at DPR 2, then the brightest glyph pixel was compared with the most common background pixel. Readings at 1.0–1.16 came from text clipped at scroller edges and were discarded as no reading.
- **Untranslated strings:** ES/FR DOM text identical to the English run's text on the same screen, after forcing `localiseDOM()`.
- **Fights:** software WebGL runs a match at 0.75 fps here, so I switched three.js rendering off for logic (60 fps) and back on only for screenshots. In-match timings are therefore not real-world, and I report none.
- **Coordinates:** confirmed first that `x`/`y` are the min corner of a 40×40 box (`width` = `height` = 40), so the wall clamp is symmetric. A knockback sweep covered all 10 arenas, a 20-unit grid of start points and 8 directions (about 220,000 hits). Knockback never left a fighter in a pillar, inside a platform's side, out of bounds or on tall terrain: no finding there.
- **Online:** two clients joined with your `netFakeConnect` hooks and relayed from Node (the PeerJS server is unreachable from here). That rig drains the HELLO, so name sync between clients was not tested.

**Not reached:** real-GPU feel and audio; the real PeerJS handshake; Supabase (blocked, so no real sign-in or signed-in states); spectating; a screen reader; real touch controls in a match; loading-screen timing; each fighter's special one by one; replays. Network blocks from here: jsDelivr, unpkg, peerjs.com and supabase.co (three.js 0.128.0, PeerJS 1.5.2 and supabase-js 2 were served from npm copies).

**Nov 1, in your Chrome (Claude in Chrome):** the real PeerJS handshake works (join connected in 1.0s), spectating connects and follows the host into the match, and the disconnect loop in #2 reproduced over the real network. Rows #59–67 came from this pass. Real-time feel still could not be judged: a match drew about 1 fps while a blank page in the same tab drew 60, which usually means the screen was asleep or the window covered, so I report no frame-rate finding. Accounts stay untested because I won't create an account or enter a password on the live site. Your saved game settings were backed up first and restored exactly afterwards.

## Findings

Columns follow the brief. Severity: BROKEN = does not work / blocks play, WRONG = works but incorrect, inconsistent or inaccessible, POLISH = correct but could be better, Question = could not tell bug from choice. Pixel values are CSS px; positions at 1400×1000 unless stated.

### Fight and online play

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Online | any landed hit · both roles | A hit only takes HP off the victim. The `HIT` handler calls `me.takeDamage(msg.dmg, null, null, true)`, and `applyDamage` returns straight after the HP change when there is no attacker. Guest hit host for 30: host HP 400→370, x stayed 700, hitstun 0, hit flash 0, meter 0.68→0.75 (passive trickle). The same 30 through the local path: x +8, hitstun 23, flash 10, meter +18. Online there is no knockback, no hitstun, no hit flash and no meter for taking damage. | BROKEN | Measured 1/1 with two clients joined by `netFakeConnect` and relayed; cause read in code | Pass the remote fighter and the hit direction in the `HIT` message, and apply through the same `applyDamage(amount, {attacker, dir})` path the local build uses. |
| 2 | Online | opponent drops and does not return | After the 15s grace window both clients stay on Paused: "Opponent disconnected. Trying to reconnect… 1s. The match is held until then." with Resume disabled. Over real PeerJS in your Chrome (guest tab closed mid-match) it does not freeze; it loops instead: the countdown ran 15→3, then restarted at 15, for 2.5 minutes until I stopped watching, never saying the opponent is gone. Over my relay it froze at "1s" (24s past expiry). Either way the match never ends. Both callers gate on `netInGrace()`, the heartbeat's `if (netInGrace()) { netGraceTick(); return; }` and the loop backstop `if (netInGrace() && …)`, and `netGraceTick`'s expiry branch only runs when `!netInGrace()`, so it can never run. Nothing else reads `graceUntil`. The comment above the backstop describes this exact symptom as fixed. Only Return to Menu gets out. | BROKEN | Reproduced 1/1 over real PeerJS (Claude in Chrome, Nov 1) and 2/2 via `ACDebug.netFakeDrop` (fires the real close handler); code read | Call the tick while a window exists, not while it is live, e.g. `if (net.graceUntil) netGraceTick();`, so the expiry branch can run. |
| 3 | Online | match-end summary | Each client counts only the hits it resolved itself, so the two summaries of one match disagree. Host: "Kaelen (Christophorius): 802 dmg dealt, largest hit 401". Guest, same match: "Kaelen (Player 1): 0 dmg dealt, largest hit 0". Round times differ too (host R2 5.1s, guest R2 28.1s; part of that gap may be my relay). | WRONG | Measured 1/1, two relayed clients | Have the host send its stats in `MATCHEND` and show those on both, or count incoming `HIT`s for the remote side. |
| 4 | Both builds | match stats and the "Deal 400 damage" daily | Overkill counts. `applyDamage` adds the full `amount` to `damageDealt` and `largestHit` even past the target's remaining HP. A forced KO on Lyra (299 HP max) reported "444 dmg dealt, largest hit 349". A 35-point hit on a 5-HP opponent counts as 35 toward the daily. | WRONG | Code read; numbers from forced kills (a real fight overshoots less) | Count `Math.min(amount, hpBefore)`. |
| 5 | Both builds | dash (Shift), and every special that uses `teleportTo` | `teleportTo` checks pillars and platform sides but not `TERRAIN`, and the next frame snaps z up to the ground there. A real dash at the Colosseum edge (60,200, diagonal) took the fighter from z 0 to z 30, grounded on a block that `resolveTallTerrain` refuses to let anyone walk onto (12-unit limit). A teleport sweep finds such spots on 8 of 10 arenas, e.g. Sundered Stair 2,482 start/direction pairs, Colosseum 1,657, Skyward Temple 1,581. | WRONG | Reproduced 1/1 live (Shift press, state read after); sweep of every arena | Run the same `tooTall` test per step inside `teleportTo` when grounded. If dashing up ledges is intended, say so in a comment, because walking is blocked deliberately. |
| 6 | Both builds | Arena Collapse | Fallen geometry stays solid. `syncArenaCollapse` drops and hides a platform, step or ramp once its centre leaves the bounds, but `PLATFORMS`, `TERRAIN` and `OBSTACLES` keep it. Skyreach Spire at 0.52: platform (700,700, h 60) mesh `falling` and `visible:false` at y −182, yet it still covers 190×71 units of live floor. A fighter dropped there landed and stood at z 60 on nothing. 9 of 10 arenas have such overlaps across the collapse steps (Skyreach 14, Sundered Stair 12, Molten Foundry 10). | WRONG | Reproduced 1/1 in a running match; geometry sweep of every arena | Decide by footprint rather than centre, and when a piece falls, take it out of the collision arrays (or clip it to the bounds). |
| 7 | Online | Menu during a fight | The #79 relabel is in ("Menu", "The match is still running…"), but the opponent still gets no sign. The host sat in the Menu, took 5×30 (HP 400→250 on both screens), and the guest saw an ordinary fight. | POLISH | Measured 1/1, relayed clients; grep finds no in-menu message | Send a small state flag and show "Opponent is in the menu" on their HUD. |
| 8 | Both builds | browser Back, mouse back button | Screens are not history entries (URL unchanged from Home to Lobby), and there is no `beforeunload` or `popstate` handler anywhere. Back mid-match leaves the site with no confirmation. Online, the opponent then waits out the grace window and gets stuck (#2). | WRONG | URL checked; code grep | Add `beforeunload` while a match is live; optionally push a history state per screen so Back closes the top modal. |
| 9 | Online | signed out | The design comment in `saveProgression` says a signed-out player earns nothing, so coins must not "appear and then vanish on reload". They do. A signed-out match-end showed "P1 +50 coins · P2 +15 coins" and "Daily: … (+30)", the Home purse rises, and a reload resets it to 0 (`addCoins` 500 → reload → 0; no progression key in storage). | WRONG | Measured 1/1; design comment quoted | When signed out, show "Sign in to keep coins" in place of the award, and do not add to the in-memory purse. |
| 10 | Local | Survival and Boss Fight | Question, not a change request (balance untouched). With P1 standing still from the start, Survival wave 1 took Lyra from 299 to 2 HP in about 8s; Boss Fight took her to 133. | Question | Seen 1/1 at 60fps logic speed; not a measured DPS | Is wave 1 meant to kill an idle player that fast? If not, look at spawn distance or first-wave damage. |

### Room and fighter select

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | Online room | fighter preview · 1400×1000, 1280×800, 1000×700, all languages | The grid's right column runs 40px over the detail panel. The grid is 238px wide but its columns resolve to 130.75 + 149.875px plus the gap. Cards span x 423–573 at 1400 while `#p1-detail` starts at 533. Confirm reads "rm (Left Click)", and a click on its left edge hits a locked fighter card (`elementFromPoint` returns `fighter-btn roster-locked`). Stats labels and the start of the description are also covered. | WRONG | DOM rects + screenshot, 3/3 sizes after a 3s settle | Give the grid `grid-template-columns: repeat(2, minmax(0, 1fr))` and let card titles ellipsize, so the columns can't exceed the track. |
| 12 | Online room | fighter preview · 400×800 and 800×400 touch | At phone width the detail panel is drawn on top of the grid. At 400×800 `#p1-detail` is 1,074px wide (x 51→1125): Back sits wholly off-screen (x 590–1125) and Confirm half off. ES runs to 1,447px, FR to 1,281px. In 800×400 touch landscape the description and stats overlap the Lyra card. | BROKEN | DOM rects + screenshots, 3 languages, touch emulation | Below \~700px, open the detail as a full-width sheet over the grid with Confirm/Back pinned at the bottom. |
| 13 | Online room | touch | A phone shows mouse instructions: slot status "Left Click confirm / Right Click back" and picker title "(Left Click confirm / Right Click back)". | WRONG | Screenshot, 800×400 touch | Use touch wording ("Tap Confirm") when `IS_TOUCH_DEVICE`. |
| 14 | Local | select screen at boot · 1400×1000 | #1 is fixed online only. At boot `#game-container` has no `menu-roomy` class and is 654px tall (online: `menu-roomy`, 964px). The frame sits 175px from top and bottom while the fighter grids scroll inside it. Opening and closing Settings does not change it. The CSS rule exists in local; `showScreen('select')` never runs at boot, so the class is never added. | WRONG | DOM, 1/1 + code | Call `showScreen('select')` (or add the class) during local boot. |
| 15 | Online room | room bar | The status pill is stretched to 44px (the row height) with 5px padding and no vertical centring, so "HOSTING" sits at the top of a tall oval. Leave Room is 98.8×50 with 11.84px text. | POLISH | DOM + screenshot | `align-self: center` on the pill; 13px text on Leave Room. |
| 16 | Room grid | locked cards | Locked cards still swap the number-key badge for the price (badges "1","2","3", then none). #53 is still open. | POLISH | DOM | Show the key and the price. |
| 17 | Room | detail actions | Confirm 139px vs Back 141px. #48 is still open. | POLISH | DOM | `flex: 1 1 0` on both. |
| 18 | Online room | slot and setup labels | Painted contrast below 4.5:1. Slot role "Player 2 · opponent" / "(name) · Host" (#64748b on #111622) is 3.80:1 at 11.2px. The guest's Match Setup labels Mode / Arena / Sandbox are 3.69–3.76:1 at 10.9px. | WRONG | Pixels: DPR 2 capture, brightest glyph pixel vs painted background | Lighten to #8a99ad or brighter. |
| 19 | Online room | Mode / Arena / Sandbox buttons; Settings "Switch to Local Version" | Purple #a855f7 text is 4.00–4.10:1 at 12.2px on the setup buttons and 4.20:1 at 12.5px on the build switch. | WRONG | Pixels, as above | Use #c084fc for purple text. |
| 20 | Both builds | Draven's number badge | The name passes thanks to its `brightness(1.45)` filter, but the "3"/"C" key badge uses the same grey #6b7280 without it: 3.95:1 at 12.2px. | WRONG | Pixels, as above | Apply the filter (or a lighter tint) to the badge too. |
| 21 | Local | Mode select | "SELECTED" tag (#a855f7 on #1a1430) is 4.47:1 at 10.2px. | WRONG | Pixels, as above | Same purple fix; 11px minimum. |
| 22 | Online room | cheat/sandbox toast | The unlock-everything toast says "Sandbox on — everything unlocked, bot matches available" in the online build, which has no bots, and it overlaps the Match Setup panel at 1280×800. | POLISH | Screenshot (debug unlock path) | Drop "bot matches available" when `AC_ONE_SIDE_PER_CLIENT`; anchor the toast clear of panels. |

### Home and Armory

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | Home | 1400×1000 | Vertical gaps down the card: Play→note 24, note→name 26, name→coins 22, coins→challenges 34, challenges→buttons 24. Play is 47px tall, the three buttons under it 38px. #24 is partly open. | POLISH | DOM | A flex column with one `gap` (24px). |
| 24 | Home | "YOUR NAME" label | #6c7d95 on #1a2135 = 3.81:1 at 11.2px. | WRONG | Pixels, as above | Lighten to #8a99ad. |
| 25 | Home | name field | Focused by Tab it shows no outline; buttons get the 3px ring. #7 is partly open. | POLISH | Computed style on real Tab focus | Same `:focus-visible` ring as buttons. |
| 26 | Armory | locked cards · 1400×1000 | Details floats mid-card at a different x on every locked card (679, 681, 704, 693, 695), while unlocked cards put it right-aligned beside the status. | POLISH | Screenshot | Put Details in the same right-hand group on every card. |
| 27 | Armory | all sizes including 800×400 touch | Buttons are 21px tall: upgrade "150" 44×21, Unlock 117×21, Details/Hide 57–68×21, Double Jump "1000 coins" 76×21. #28 is still open on touch. | WRONG | DOM, every run | Minimum 36px tall (44px on touch). |
| 28 | Armory | expanded detail | The description is about 17px, larger than the fighter's own name subtitle, while the ability text under it is about 10px. The name and title repeat inside the panel under a plain blue square swatch. | POLISH | Screenshot | Description 13px, abilities 12px; drop the repeated name and swatch inside the Armory card. |
| 29 | Armory | prices | Double Jump says "1000 coins"; fighters say "Unlock — 300 coins". | POLISH | DOM | One pattern ("Unlock — 1,000 coins"). |
| 30 | Armory | ES, FR · every viewport | Upgrade labels are clipped: FR "Attaque principale" and ES "Velocidad" (`scrollWidth > clientWidth`). | WRONG | DOM, 8/8 runs | Let the label column size to content, or wrap. |

### How to Play, Settings, Account, Lobby

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 31 | How to Play | 1400×1000 | Cards no longer stretch (#74 half-fixed), but rows still share a height: a 152px hole under Objective (120px card in a 262px row). The 13th card sits alone on the last row. The panel is 1,350px tall in a 960px frame, so Got it (now full width, #75 fixed) is at y 1331 and needs a scroll. | POLISH | DOM + screenshot | CSS columns (masonry) or two columns; pin Got it. |
| 32 | How to Play | online · Controls card | Says "Esc pauses, and opens Rebind Keys and Settings." Online, Esc opens a Menu while the match keeps running, and that Menu now says so. | WRONG | Text read from DOM | Online: "Esc opens the menu — the match keeps running." |
| 33 | How to Play | vs Account | How to Play: "Your coins, unlocks and upgrades are yours, saved on your own machine". Account: "…live on your account, not on this machine". Online saves nothing locally (#9). | WRONG | Text read from DOM; code | Rewrite the How to Play line to match the account model. |
| 34 | How to Play | terms | "upgrades to Health, Damage, Special charge rate and Speed". The Armory says Attack, not Damage. (Charge vs Special is the deliberate pair and is fine.) | POLISH | Text read | "Attack". |
| 35 | Modals | 1400×1000 | Settings, Account and Rebind panels pin to the top (≈y 30–60) of a 960px frame, with about 600px empty below. When one stacks on another, the Settings panel behind stays visible and peeks out below the shorter Account or Audio panel. | POLISH | Screenshot | Centre modals vertically; dim or hide the panel underneath. |
| 36 | Local | Audio, Settings | Online sliders are now 32px tall (#61 fixed), but the local build's are 179×16. The sandbox checkbox in local Settings is 13×13. | WRONG | DOM, 9/9 local runs | Port the slider height to local; 24px minimum checkbox. |
| 37 | Settings and Pause | button heights | The ← Back buttons are 50.7px against 48px primary buttons (Account, Lobby, Audio); Pause has Resume 48, Rebind/Settings 50, Return to Menu 51; "Switch to Local Version" 45 vs 44px rows. #6 is still open. | POLISH | DOM | Fix the button height instead of letting borders and the arrow glyph set it. |
| 38 | Account | Create account | Placeholders are clipped in the 142px content box: "what other players see" needs 166px, "for password resets only" 179px, "at least 8 characters" 151px. | WRONG | Measured (`measureText` with the input's font) | Labels above full-width inputs, or hints below the fields. |
| 39 | Account | signed out | Under Sign in, "Your progress lives on your account, not on this machine." repeats the intro two lines up, and it is untrue while signed out. | WRONG | Text read | Drop it, or "Sign in to save coins and unlocks." |
| 40 | Account | Forgot password | Still two back controls stacked: "← Back to sign in" (300×22 link) and "← Back" (50.7px). Forgot password itself is a 22px-tall target. #71/#72 are still open. | POLISH | DOM | One back control; 32px links. |
| 41 | Account | FR | The sign-in tabs wrap to 58px (EN 44). "Envoyer le lien de réinitialisation" wraps to a 68px button (EN 48). | POLISH | DOM | Shorter FR labels ("Connexion", "Envoyer le lien"). |
| 42 | Lobby | "or" divider | #73839a = 4.15:1 at 11.2px. | WRONG | Pixels, as above | Lighten. |

### Pause, HUD, match end

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 43 | Pause | local · 1400×1000, 1280×800, 1000×700 | The pause panel is 677px tall inside a 650px overlay (`scrollHeight` 757). At 1400×1000 Return to Menu sits at y 795–845 and the frame ends at 825: 20px cut, and it needs a scroll. Same at all three sizes. | WRONG | DOM + screenshot | Tighten the controls list (two columns), or let the pause overlay take the window like menus. |
| 44 | In-match frame | both builds | Question. The match frame is capped at 1170×650, so a 1400×1000 window gives the game 55% of its area (1280×800: 75%). The CSS comment says the cap was kept so "nothing moves on a desktop-sized window", but it also says the HUD now scales uniformly. Is 650 still needed? | Question | DOM | Consider `min(96vw, 1600px)` × `min(96vh, 900px)`. |
| 45 | HUD | local split · right half | Player 2's name runs under the centred plates. "Kaelen (Christophorius)" (14-character name) slides under the arena-name plate, and the wider "Arena closing — next 38s" plate covers it completely. On Skyreach Spire even "Kaelen (Player 2)" was covered by the closing plate. The left half is fine. | WRONG | Screenshots, 2 arenas, both palettes | Right-align P2's name against its bar's right edge, or move the plates below the bars. |
| 46 | HUD | Zone Control and Takedown Race · 900×600 (after a resize) | The zone tracks and the KO tally text are drawn over the "Special 13% / DASH" row in both halves and are unreadable. | WRONG | Seen in one screenshot per mode; not measured | Give the mode HUD its own row under the meters. |
| 47 | HUD | co-op modes | The boss bar ("Karrigos 4991 / 4991") and the "Wave 1 · 2 of 2 left" banner are centred on the whole canvas, so in split screen they straddle the divider and run into Player 2's half. | POLISH | Screenshot 900×600 | Draw them once per view. |
| 48 | HUD | special meter | The label is "Special 3%" in sentence case, then "SPECIAL READY" in capitals when full. | POLISH | Screenshot | One case. |
| 49 | Online | match end | Still "P1 +50 coins · P2 +15 coins" by slot, not name. #84 is partly open. | POLISH | DOM | Use names, or show only your own award. |

### Keyboard and accessibility

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | Every modal | keyboard | Enter on Settings leaves focus on the Settings button behind the modal (`activeElement` not inside `#settings-screen`). Tab walks the modal's 11 controls and its ×, then leaves to BODY and the Home controls underneath while the modal stays open. There is no focus trap. | WRONG | Real Tab presses; `activeElement` read | Move focus to the first control on open, trap Tab inside, and return focus to the opener on close. |
| 51 | Modals | Escape | Once Tab has carried focus out of an open modal into the name field behind it, Escape (pressed 4 times) closes nothing; Account and Settings stay open. | WRONG | Real key presses, 4/4 | Handle Escape for modals before the text-field guard, or fix the trap above. |

### Languages

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 52 | ES, FR | Home note, Lobby intro, Lobby "Watching…" note, Account intro | These four have translations in `i18n.js` but stay English. The markup wraps them across source lines, so the DOM text node holds newline-and-indent runs; `localiseDOM` trims but does not collapse whitespace, so the key never matches. `langcheck` probably normalises whitespace and so misses this. | WRONG | DOM text compared with the table; root cause confirmed for all four | Collapse internal whitespace to single spaces before the lookup in `localiseDOM`. |
| 53 | ES, FR | Home, Room, Lobby, Account | No keys at all: "· 3 of 10 fighters", placeholder "unnamed", "Both of you still need to pick a fighter.", "Choosing…", slot roles "Player 2 · opponent" / "Player 1 · opponent · Host" / "· Host", "(Left Click confirm / Right Click back)", guest labels Mode / Arena / Sandbox, "Locked — N coins in the Armory. Key N once unlocked.", "Enter your username and we will email a link…". | WRONG | DOM text identical to EN at 4 viewports | Add keys; route the built strings through `t()`. |
| 54 | ES, FR | Armory | English: "Unlock — N coins" (7 cards), every fighter title ("— Tempo Duelist" and so on; the same titles are translated on the select grid), and in FR "Charge", which is keyed but still shows in English. | WRONG | DOM text identical to EN | Translate the shop card builder's strings. |
| 55 | ES, FR | How to Play, Rebind, Audio, Settings, local | English: the Controls lines ("W/S Forward/Back, A/D Strafe…", the gamepad line, "pauses, and opens Rebind Keys…"); online rebind key names Space / Shift / Forward; local rebind Forward / Left / Right / Down / Look Up / Look Down; Audio "SFX"; HUD Text "Normal"; FR "Standard"; local Mode "SELECTED"; local daily "○ Player 1 / ○ Player 2". | WRONG | DOM text identical to EN | Add keys. |
| 56 | ES, FR | Arena select | Question: all ten arena names stay English ("The Colosseum Ring", "Twin Ramparts"…) while fighter titles are translated. Proper nouns, or missing? | Question | DOM | Decide once and note it in the i18n file. |

### Phone and code

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 57 | Online | portrait phone | Question: the "Turn your phone sideways" overlay (`#touch-rotate`) intercepts every tap on every screen, including the Armory, Settings and Account, not just the match. | Question | Touch emulation 400×800: clicks intercepted by `#touch-rotate` | Let menus work in portrait and gate only the match? |
| 58 | Code | comments | Stale comments: several say `MAX_WALK_STEP_UP` is 30 ("only a rise up to MAX\_WALK\_STEP\_UP (30)") while the constant is 12. "Ambient per-map pad: two detuned oscillators…" still sits above `WALL_HEIGHT` though the pad was removed. | POLISH | Code read | Update the comments. |

### Found in your Chrome (Nov 1)

Real PeerJS between tabs, your Intel Iris Xe GPU, your 1280×585 window at 1.5×. The last row comes from a headless pass at that window size.

| # | Area | Where | What | Severity | How established | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| 59 | Online | guest closes the tab mid-match | No goodbye is sent on tab close (no `pagehide`/`beforeunload` handler sends `BYE`). For about 13s the host's pause screen says "Christophorius left the game tab. Waiting for them to come back…" about someone who has closed the game. Then the silence timeout starts the endless reconnect loop (#2). | WRONG | Real PeerJS, 1/1 | Send `BYE` from `pagehide`; on `BYE` mid-match, end it with "Opponent left". |
| 60 | Online | two players with the same name | Both players named "Christophorius" (two tabs share storage; two real people can share a name too). The slots read "Christophorius" and "Christophorius · Host", and the away-pause says "Christophorius left the game tab" without saying which one. In a mirror match the HUD label is "Kaelen (Christophorius)" for both sides (from `playerLabel`). | POLISH | Real PeerJS, slot text read; HUD label inferred from code | Add the side number when the two names match. |
| 61 | Online | host with a spectator | With a watcher connected (`net.watchers.length` 1), the host's lobby still says only "Waiting for an opponent... — Send them the room code", and the room never mentions a watcher. | POLISH | Real PeerJS, DOM text | Show "1 watching" in the room bar. |
| 62 | Online | spectator view · Twin Ramparts | The spectator gets "Click to capture the mouse" though there is nothing to control. The intro names ("Kaelen VS Lyra") are white over the pale floor and almost invisible. From the overhead camera the two central platforms are blown out to flat white. | POLISH | Screenshot, your Chrome | Hide the capture hint for watchers; put a dark plate behind the intro text; check bloom on that camera. |
| 63 | Online | spectator in a background tab | Question: a watcher whose tab sat in the background for under a minute dropped with "Disconnected — Connection timed out" while the host waited in the room. In front, it stayed connected for 40s. Probably Chrome's background-timer throttling, so it could hit anyone who watches while doing something else. | Question | Real PeerJS, 1 drop, 1 clean run | Longer timeout for watchers, or reconnect silently. |
| 64 | Both builds | first match, loading → intro | #85 still looks open: local, the state turned INTRO at 6.63s while the loading screen stayed up until 8.71s; online, INTRO at 9.02s, loading gone at 10.98s. Caveat: your browser was only drawing about 1 fps in a match (see How this was tested), so the overlap length is unreliable; that it overlaps at all is consistent with the Oct 27 reading. | POLISH | Measured in your Chrome, state polled every 50ms | Start the intro clock when the loading screen hides. |
| 65 | Both builds | intro | "GET READY" is green on the Colosseum grass and purple on Twin Ramparts' pale floor, both low contrast with no plate. The first-person weapon arm draws over the bottom letterbox bar during the intro. | POLISH | Screenshots, your Chrome | A dark plate behind the intro text; render the letterbox above the viewmodel. |
| 66 | Online | status text | Still "Waiting for an opponent..." (three dots, #10), "Paused - Christophorius left the game tab" (hyphen as a dash), and "Connected — Watching - waiting for the match" (em dash and hyphen in one line). | POLISH | DOM text | … and — throughout. |
| 67 | Local | Rebind · 1280×585 and 1280×800 | The key chips don't line up in a column: each sits right after its label, so their x varies from 530 to 568px. Labels mix cases ("Turn left", "Look Up", "Look Down"). Each player's section header is the bare name, so a 14-character name becomes the heading. | POLISH | DOM + screenshot | A two-column grid (label, key); sentence case; "Player 1 — name" headers. |

## Key screenshots

Four captures from the live build (1× CSS pixels unless noted). Everything else in the table is a measurement, not a picture.

**#11** Online room at 1400×1000, Kaelen previewed: the grid's right column covers the start of Confirm ("rm (Left Click)") and the stat labels.

&#91;image: #11 room grid over the fighter detail\]

**#12** The same screen at 400×800: the detail is drawn over the cards and runs off the right edge; Back is off-screen.

&#91;image: #12 room at phone width\]

**#43** Local pause at 1400×1000: Return to Menu is cut by the bottom of the 650px frame.

&#91;image: #43 pause panel clipped\]

**#45** Split-screen HUD, colour-blind palette, enlarged 2×. Top: Player 1's half, fine. Bottom: Player 2's half, where "Kaelen (Christophorius)" disappears under the arena and Arena-closing plates.

&#91;image: #45 HUD plates over Player 2's name\]

## The Questions, answered

Each of these is also answered in the code, beside the thing it is about,
because that is where it will be read. The last round left two decisions
recorded only in test files and nobody reading the game found them.

| # | Answer | Where |
| --- | --- | --- |
| 10 | **Yes, by construction**, and the audit's own two numbers show why: wave 1 is **two** attackers (`2 + floor((n-1)/3)`) and Boss Fight is one, so two weaker things out-damaging one tougher thing against a target that never blocks, moves or breaks line of sight is the shape of the mode. Whether eight seconds is too fast for a first impression is a balance question and is left alone; if that answer ever becomes yes, the levers are the `2 +` and `spawnNextWave`'s `dmgMult` base, in that order. What *would* be a bug is minions arriving close, which `farthestSpawnFromPlayers()` exists to prevent. | `shared/common.js`, above `waveEnemyCount` |
| 44 | **Keep 650, and not for the reason this comment suggested.** Not the HUD: `hudUnitScale()` is `min(W/VIRTUAL_W, H/VIRTUAL_H)`, so every `y` in `drawHUD` is in units that scale with the canvas and none is tied to 650. It is **the camera** — the FOV is fixed and the aspect follows the viewport, so a taller frame shows *more arena*. The cap is what guarantees two players on two machines see the same amount of a fight they are shot at from off-screen in. `min(96vh, 900px)` hands that to whoever has the taller window. It is also why the menus got `menu-roomy` instead of a bigger frame: a menu has no camera, so it can have the window. | `#game-container`, both builds |
| 56 | **Not translated, deliberately.** The ten arena names are proper nouns of invented places — the arena's name, not a description of it — so they read the same in every language, like a map name anywhere else. Fighter *titles* are translated, because "Tempo Duelist" describes a role. | `shared/i18n.js`, above `const I18N` |
| 57 | **A bug.** Portrait is unplayable for a *fight*, and the overlay covered every screen — and being a full-screen flex panel, it intercepted every tap on all of them, so the Armory, Settings and Account were unreachable on a phone held upright. None of them wants a landscape view; a column of buttons reads better in portrait than in an 844×390 letterbox. Now gated on `inLiveMatch()`, and checked per frame so it appears when a match starts in portrait rather than only when the phone turns. | `shared/touch.js`, `syncTouchOrientation` |
| 63 | **A bug, for a client the check was not designed for.** 15s is tuned for a player whose opponent has stopped moving behind a dead channel, where every second is a second of frozen fight. Nothing waits on a spectator, and a backgrounded tab has its timers throttled. Watchers get four times the budget — as a multiple of `net.timeoutMs`, not a constant, because `netcheck` lowers that field to force a drop and a literal would have made a watcher the one client that ignored it. | `netHeartbeat`, the silence timeout |

## Oct 27 review: re-checked

These were re-measured on the live build and are fixed, so they are not in the table: #8 arena cards are buttons in the Tab order, #12 `<html lang>` follows the language, #15 a language change reopens Settings with focus on the select, #23 Play lines up with the other rows, #31 Details/Hide both 68px with `aria-expanded`, #37 Join is disabled until a code is typed, #60 the Music slider is gone, #61 online sliders are 32px, #62 the colour-blind low-HP flash is white, #69 Strafe left/right online, #70 Account reopens on Sign in, #75 Got it is full width, #79 the online Escape panel is titled Menu with a warning, #84 "0 specials used", #86 the first Confirm after loading worked (1/1), #89 round pips use each side's colour, #94 the round banner has a backing plate, #95 a named host's HUD labels the unnamed guest "Player 2".

Still open and folded into the table above: #1 (local, #14), #6 (#37), #7 (#25), #13 (#52–55), #24 (#23), #28 (#27), #48 (#17), #53 (#16), #71/#72 (#40), #74 (#31), #84 (#49).
