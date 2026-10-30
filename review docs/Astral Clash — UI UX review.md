# Astral Clash — UI/UX review

Oct 27, 2026 · @Krish Gali

## How this was tested

96 findings across both builds: 3 BROKEN, 32 WRONG, 61 POLISH. Fix #86, #87 and #79 first: the first Confirm click on a fighter often does nothing, changing the language from the pause menu ends the match, and pausing online leaves you defenceless. After those, the biggest problems are a fixed 650px menu frame that forces scrolling at every size, untranslated Spanish/French strings, a Music slider wired to nothing, and phone-width overflow on Home and the Armory.

**Screenshots are now in.** Each section ends with a Screenshots block: annotated crops keyed to the entry numbers (red/orange boxes and labels are mine, not the game's). Day 2 also turned up new findings, #86–#95, including two BROKEN ones: Confirm/Back go dead after "Loading fighter" (#86), and changing the language from the pause menu ends the match (#87).

- **Day 1 (Oct 27):** your Chrome, minimized, so everything was measured from the live page (boxes, computed styles, contrast) without screenshots.
- **Day 2 (Oct 28):** a headless Chromium in my workspace at exact viewports (1400×1000, 1000×700, 640×530, 400×800; crisp 2× captures). Every Day 1 number was re-measured; the few that moved by a pixel or two are corrected in place.
- **Network workarounds:** the workspace blocks the game's CDNs, so the headless browser got three.js 0.128.0, PeerJS 1.5.2 and supabase-js 2 from the npm registry instead (same versions). The PeerJS server is blocked too, so the online room joins two pages through the game's own `ACDebug.netFakeConnect` hook with their messages relayed. The room UI is the real one.
- **Matches:** software rendering is too slow for a networked match (it times out after 15s), so in-match screens come from full local matches and a solo match in the online build. Durations from these runs are not real-world.
- **Languages:** English, Spanish, French on every screen and viewport (local build skipped at phone width, since it is desktop-only).
- **Debug unlock:** `ACDebug` only exists with `?debug=1` in the URL; the console line in the brief does nothing without it.
- **Your save:** Day 1's match awarded coins and a daily challenge in your Chrome; I restored that localStorage afterwards. Day 2 ran in throwaway headless profiles and touched nothing of yours.

Severity counts are mine and loose; columns are Where (build · viewport · language, only when it is limited to one), What, Severity, Fix. All pixel values are CSS px.

## Across all screens

The menu frame never grows past 650px tall, so most screens scroll even at 1400×1000; close buttons, panel widths and heading sizes all vary screen to screen.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Menu frame (`#ui-overlay`) | Both · 1400×1000, 1000×700 | Frame is 1170×650 / 960×650 regardless of viewport, leaving 350px / 50px unused, yet content scrolls inside it: Armory 1,402px, Tutorial 1344px, character select 855px, Settings 678px, match-end 688px, lobby while hosting 699px. | WRONG | Size the menu overlay to the viewport height; keep the 16:9 box only for the game canvas. |
| 2 | Back / close control | Both | Seven patterns: Settings and Rebind = 30×30 × only; Audio = "Back to Settings" (no ×, no arrow); Account = "← Back" (no ×); Armory/Lobby/Mode = full-width "← Back" at the bottom; Tutorial = × plus a 220px "Got it!"; match-end = "Back to the Room". | WRONG | One rule: × top-right on every modal plus a full-width Back at the bottom; same label everywhere. |
| 3 | Panel widths | Both · 1400×1000 | Sibling panels: Settings 320, Audio 340, Account 350, Rebind 350, Pause 399, Match-end 399, Lobby 460, Home 479, Mode 560, Tutorial 760, Arena 1000. Inner padding 24px everywhere except Armory (26/22/40) and local select (14). | POLISH | Two widths (narrow modal, wide grid) and one padding token. |
| 4 | Panel headings | Both | Sizes: Armory 30.4, Arena 24, Lobby/Mode 20.8, Settings/Account/Rebind/Audio/Pause 18.7, Tutorial 17.6, Match Setup 16px. Case: "Choose Your Arena" vs "Choose your fighter"; "ROOM CODE" vs "Room code". | POLISH | One h3 size; pick sentence case. |
| 5 | Modal heading top space | Both · Settings, Account, Rebind, Audio, Pause | h3 has an 18.7px top margin on top of 24px padding: 43px above the heading vs 32px below the last button. | POLISH | Drop the h3 top margin in modals. |
| 6 | Same-class buttons, different heights | Both | `.btn-back` with "←" is 51–53px (the arrow glyph sets the line height), without it 50px (lobby: Disconnect 50 vs ← Back 51, stacked). Filled cyan buttons are 48.7px, outlined `.btn-secondary` 50px (Pause: Settings vs its three neighbours; Lobby: Watch Instead vs Join). | POLISH | Fix the button height (or line-height) instead of letting the glyph and border set it. |
| 7 | Focus ring | Both | Buttons get a 3px yellow ring; the language select a 2px cyan one; name and account inputs only change border colour; room-code inputs use the browser default. | POLISH | One ring style for every focusable control. |
| 8 | Arena cards | Both | Map cards are `div`s with tabIndex −1, no role, empty `alt`: Tab skips the whole arena grid, so a keyboard user can only pick Random. | WRONG | Make each card a `button` with the arena name as its label. |
| 9 | On/Off labels | Both | "Bot: OFF" (local) vs "Sandbox: Off", "Mute Off", "Glow On". | POLISH | One casing. |
| 10 | Ellipses | Both | Three dots in "Waiting for an opponent...", "Round 2 starting...", "Choosing..."; the … character in "Waiting for your opponent to lock in…". | POLISH | Use … throughout. |
| 11 | Attack terminology | Both | "Attack" (rebind, upgrade row), "Main Attack" (stats), "Atk" (pause reminder), "Basic" (tutorial "Basic vs. Special"); upgrade row says "Charge" where stats say "Special". | WRONG | Pick Attack/Special and use them everywhere. |
| 12 | Page language | Both · ES, FR | `<html lang>` stays "en" after switching language, so screen readers read Spanish/French with English pronunciation. | POLISH | Set `document.documentElement.lang` on change. |

### Screenshots

**#1** The Armory at 1400×1000: the frame stays 650px tall while 350px of the window goes unused.

&#91;image: #1 fixed menu frame\]

**#2** Four close patterns on four sibling modals.

&#91;image: #2 close controls\]

**#3** Seven sibling panels at the same scale, seven widths (Armory and Tutorial also cut off by the frame).

&#91;image: #3 panel widths\]

**#4** The same h3 role at six sizes.

&#91;image: #4 headings\]

**#5** Space above the modal heading vs below the last item.

&#91;image: #5 heading space\]

**#6** Same `.btn-back` class, different heights.

&#91;image: #6 Disconnect vs Back\]

**#7** Three focus styles, captured with real Tab presses.

&#91;image: #7 focus rings\]

**#8** One Tab from Random Arena goes straight to Back, skipping every arena card.

&#91;image: #8 arena cards not focusable\]

\#9–#12 are wording and markup issues; there's nothing extra to see in a crop.

## Language (Spanish, French)

About 15 visible strings never translate, and picking a language throws you out of Settings.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 13 | Untranslated strings | Online · ES, FR | Stay English: Home note "One of you hosts and shares a room code…", name placeholder "unnamed", "· 3 of 10 fighters", Lobby intro and "Watching uses the same room code…" note, Account intro "Your coins, unlocks and upgrades live on your account…", select slot roles "Player 1 · you" / "Player 2 · opponent · Host", Match Setup labels Mode / Arena / Sandbox, "Not connected. Leave the room…", "Paused", and the Settings/Audio values Standard, Colorblind, Open, On/Off, Master, Music. | WRONG | Route these through i18n.js. |
| 14 | Untranslated strings | Local · ES, FR | Stay English: "○ Player 1" / "○ Player 2" in the daily panel, "Paused", Colorblind, Open, Master, Music. | WRONG | Same. |
| 15 | Language select | Both | Changing the language reloads the whole page: setLang() in i18n.js ends with location.reload() (confirmed: one navigation fires on change). So Settings closes, you land on Home, and anything in progress is lost (see #87 for mid-match). | WRONG | Re-localise in place, or at least reopen Settings after the reload with focus on the select. |
| 16 | Settings → Rebind Keys | Both · FR, all viewports | "Rebind Keys" wraps to two lines: 71px tall vs 50px for Audio Settings directly below. | WRONG | Shorter French label or let the button grow both siblings equally. |
| 17 | Settings → Player Colors | Online · 400×800 · FR | Wraps: 51px vs 41px for the other option rows. | POLISH | Same as 16. |
| 18 | Fighter cards, row 3 | Local all sizes, online 400×800 · ES, FR | Two cards wrap their title: 101–103px vs 88–89px for every other card, so one grid row is taller than the rest. | POLISH | Clamp titles to one line with an ellipsis, or fix card height. |
| 19 | Single-word last lines | Both | Orphans: Account note ends on "there." (all languages), Home note on "machines." (400px), ES rebind hint on "intercambian.", several How to Play paragraphs at 640/400px, toast "…bot matches available" on "available". | POLISH | `text-wrap: pretty` on paragraph text. |

### Screenshots

**#13** Home in Spanish and French (1400×1000). Note also the Spanish challenge wrapping to the orphan "compañero" (#19).

&#91;image: #13 Home untranslated\]

**#13** Settings, Audio and Account in Spanish.

&#91;image: #13 more untranslated\]

**#16** Settings in French: Rebind Keys wraps to two lines (71px) above a 50px Audio Settings.

&#91;image: #16 French settings\]

**#14** Local build in Spanish: the daily challenges' player labels stay English.

&#91;image: #14 local daily panel\]

**#17** French at 400×800: Player Colors wraps.

&#91;image: #17 French phone\]

**#18** Spanish fighter cards: two cards in one row grow to 103px vs 89px.

&#91;image: #18 Spanish cards\]

## Home / main menu (online)

At phone width the home card is wider than the screen and its left edge is cut off.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 20 | Home card | 400×800 | Card is 416px wide in a 384px frame: home screen starts at x = −19, card border at −9 (off-screen and not scrollable to), and the frame scrolls sideways 27px. | WRONG | `max-width: 100%` on the card and drop its fixed 368px content width. |
| 21 | Unlock count | Debug unlock on | Home still says "· 3 of 10 fighters" while the Armory lists all 10 as Unlocked/Max; online character select shows 7 locked with prices and base stats (Kaelen 400 HP vs 460 +3 in the Armory). | WRONG | If sandbox is off for online play, say so in the Armory instead of showing everything unlocked. |
| 22 | Today's challenges → Armory row | 1400×1000 | Last challenge line ends 2px above the Armory row, where the other gaps on the card are 10–14px. | WRONG | Give the daily panel a 12px bottom margin. |
| 23 | Play button | All viewports | Sits 4px right of every other row (left 489 vs 485) and overhangs the content edge by 4px on the right, from its `margin: 6px 4px 0`. | POLISH | `margin: 6px 0 0`. |
| 24 | Vertical rhythm | 1400×1000 | Gaps down the card: 12 (Play → note), 14 (note → name), 10 (name → coins), 12 (coins → challenges), 2 (challenges → buttons). | POLISH | One 12px gap token (a flex column with `gap`). |
| 25 | Text contrast | All | "· 3 of 10 fighters" is 4.1:1 at 11.8px; the "unnamed" placeholder (rgb 71,85,105) is about 2.5:1. | POLISH | Lighten both to at least 4.5:1. |
| 26 | Daily challenge rows | 1400×1000 | 11.5px text, 16px rows with an uneven 4px then 5px gap between them. | POLISH | 13px text, 8px row gap. |

### Screenshots

**#20** Phone width: the card runs past both edges of the 400px viewport.

&#91;image: #20 Home card overflowing at 400px\]

**#21** "3 of 10 fighters" with sandbox unlock on.

&#91;image: #21 unlock count\]

**#22** 2px between the last challenge and the button row (green: a normal 10px gap for comparison).

&#91;image: #22 challenges to buttons gap\]

**#23** Play sits 4px right of the content edge.

&#91;image: #23 Play button offset\]

**#24** Gaps down the card.

&#91;image: #24 vertical rhythm\]

**#25** Low-contrast roster count and placeholder.

&#91;image: #25 contrast\]

**#26** Daily challenge rows.

&#91;image: #26 daily rows\]

## Armory (shop)

The only Back button is 1,280px down a scrolling list, and the expanded detail card butts straight into the upgrade rows.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 27 | ← Back | Online · 1400×1000 | The only visible way out is a full-width Back about 1,280px down the list, under all 11 cards. Esc works but nothing says so. | WRONG | Pin a Back/× in the header. |
| 28 | Phone layout | Online · 400×800 | The Armory section has 41.3px side margins, so card content is only 253px wide in a 400px viewport; Max/Owned buttons are 44×22 and Details 58×20, well under a comfortable touch size. | WRONG | Remove the side margin below 640px; 36px minimum button height on touch. |
| 29 | Expanded detail → upgrade rows | 1400×1000 | Detail panel ends at y 697 and the upgrade rows start at 697: 0px gap (the panel has a top margin only). | WRONG | 10px bottom margin on `.shop-detail`. |
| 30 | Card header "Details" button | 1400×1000 | Header is `space-between` with three children, so Details floats mid-card at x 718 in a 957px row, attached to neither the name nor the status. | POLISH | Put Details next to the name, or group it with the status on the right. |
| 31 | Details ↔ Hide | All | Label swap changes the button width 58 → 43px and shifts it 8px; no `aria-expanded`. | POLISH | Fixed min-width; set `aria-expanded`. |
| 32 | "Owned" vs "Unlocked" | All | Double Jump shows a grey disabled button reading "Owned"; fighters show green text reading "Unlocked". Same meaning, different word, element and colour; also makes the Double Jump header 22px vs 20px and the card 84 vs 85px. | POLISH | One status chip for both. |
| 33 | Stat bars | 1400×1000 | Bars end at different x because the value text varies: Health bar 828px vs 833px for the others. Stat text is 9.6px. | POLISH | Fixed-width value column; 11px minimum. |
| 34 | Detail card vs select-screen version | Both | Same component, different styling: inner padding 9/11 vs the card's 15/18; description 11.5px here vs 10.9px on character select; ability margins 7/0/6 vs 0/0/6. | POLISH | Share one stylesheet block. |
| 35 | Disabled Max / Owned | All | Text contrast 3.2:1 at 10.6px; readable only up close. | POLISH | Lighter grey text, keep the dimmed background. |
| 36 | Upgrade rows | 1400×1000 | Each of the four columns is 224px but label + pips + button use about 150px, leaving a 71px dead gap before the next column. | POLISH | Right-align the button within its column, or narrow the grid. |

### Screenshots

**#27** Top of the Armory: no Back or × anywhere in the header…

&#91;image: #27 Armory header\]

…the only Back is after all 11 cards.

&#91;image: #27 Armory back at bottom\]

**#29** Expanded detail panel touching the upgrade rows.

&#91;image: #29 detail gap\]

**#30** Details floating mid-row.

&#91;image: #30 Details placement\]

**#31** Hide is narrower than Details, so the button shifts.

&#91;image: #31 Details/Hide\]

**#32** Owned vs Unlocked.

&#91;image: #32 Owned vs Unlocked\]

**#33** Stat bars ending at different x.

&#91;image: #33 stat bars\]

**#35 / #36** Low-contrast disabled Max buttons and the dead space after each.

&#91;image: #35 #36 upgrade rows\]

**#28** Armory at 400×800: small upgrade and Details buttons, and the title wraps to an orphan "Duelist".

&#91;image: #28 Armory phone\]

## Play Online lobby (host and join)

An empty room code is reported as a connection problem, and hosting pushes Back out of the frame.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 37 | Join with empty code | Online | Clicking Join Game with no code shows a red "Connection problem — Enter a room code first" in the status box above Host Game; the code field itself gets no error state. It is a validation message, not a connection problem. | WRONG | Disable Join until a code is typed, or show the hint under the field. |
| 38 | Panel while hosting | Online · 1400×1000 | Panel grows to 699px; ← Back sits at y 823–876 while the frame ends at 825, so it needs a scroll. | WRONG | Covered by #1; or tuck Disconnect and Back side by side. |
| 39 | Join Game / Watch Instead | Online | Watch Instead is 50px vs Join Game 49px; gap code field → Join is 8px, Join → Watch is 15px. | POLISH | Same height, one gap. |
| 40 | Copy button and room code label | Online | Copy text is 9.9px on a 47×26 button; "Room code" label 10.6px. | POLISH | 12px text, 32px button. |
| 41 | Intro copy | Online | "One of you hosts and shares the room code…" repeats the Home note almost word for word ("a" vs "the" room code). | POLISH | Keep it in one place, with identical wording. |

### Screenshots

**#37** Join with no code.

&#91;image: #37 empty code\]

**#39** Uneven gaps between the code field, Join and Watch.

&#91;image: #39 join/watch gaps\]

**#40** Tiny Copy button while hosting.

&#91;image: #40 code row\]

**#41** The whole lobby, for the repeated intro copy.

&#91;image: #41 lobby\]

\#38 (Back pushed below the frame while hosting) is the #6 screenshot above.

## Room bar and character select

Confirm and Back stop working after the "Loading fighter" state (#86, both builds); the online slot shows "-- confirm / -- back"; and in the local build the fighter detail opens below the fold.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 86 | Fighter detail → Confirm / Back buttons | Both builds (same code at online line 8052, local 7982) | The first time you preview a fighter whose model isn't loaded yet, the buttons switch to "Loading fighter" for a moment. busy() saves the buttons' innerHTML and writes it back afterwards, which recreates them without their click listeners. Clicking Confirm or Back then does nothing at all; the slot keeps saying "-- confirm / -- back". Re-clicking the same fighter card (model now cached, no loading state) gives working buttons. This is why my first Confirm failed yesterday too. | BROKEN | Don't restore innerHTML in busy(): overlay the spinner and toggle visibility, or rebind listeners (event delegation on the detail panel) after restore. |
| 42 | Your slot status | Online | After previewing a fighter the slot reads "-- confirm / -- back": `pickKeyHint()` passes the mouse bindings to `keyLabel()`, which returns "--". The buttons below correctly say "Confirm (Left Click)". | WRONG | Teach `keyLabel()` mouse buttons. |
| 43 | Fighter detail placement | Local · 1400×1000 | Detail renders under the grid (y 1040–1324), so Confirm/Back are off-screen until you scroll; online puts it beside the grid. | WRONG | Side-by-side as online, or open it as an overlay on the grid. |
| 44 | Fighter name colours | Both | Draven's name (unlocked) is rgb(107,114,128), 3.8:1, dimmer than the locked fighters' rgb(148,163,184), so an owned fighter reads as locked. Local: Ignis 3.8:1, Nyx 3.2:1. | WRONG | Lighten accent-coloured names to 4.5:1. |
| 45 | Grid reflow on selection | Online · 1400×1000 | Previewing a fighter shrinks the grid from 2×264px to 2×116px columns and grows the picker 464 → 566px; row 1 jumps to 101px because "Shardwing Sylph" wraps. | WRONG | Reserve the detail column from the start so nothing reflows. |
| 46 | Settings button (local) | Local · 1400×1000 | 86×33 button at y 1063, below the fold; you must scroll the frame to find it. | WRONG | Move it to the top bar next to Mode / How to Play. |
| 47 | Mode and How to Play buttons | Local | Side by side but 31px vs 33px tall, tops at y 282 vs 280, padding 7/18 vs 8/22, text 12.8 vs 13.1px. | POLISH | Same class for both. |
| 48 | Confirm / Back pair | Both | Confirm 139px vs Back 141px online, 166 vs 168px local. | POLISH | `flex: 1` on both. |
| 49 | Back label changes | Online | "Back (Right Click)" becomes "Change Fighter (Right Click)" after confirming; same action. | POLISH | One label. |
| 50 | Change Fighter buttons | Local | P1's sits at y 1313, P2's at 1301, because the two descriptions differ in length. | POLISH | Pin actions to the panel bottom. |
| 51 | Room bar | Online | Copy overhangs the code chip by 1px; status pill 25px tall vs chip 26px, tops at y 201 vs 200. | POLISH | Same height, align-items center. |
| 52 | Slot copy | Online | You: "No fighter yet / Pick a fighter below". Opponent: "Choosing... / Choosing their fighter" (says the same thing twice). | POLISH | "No fighter yet / Choosing…" for both. |
| 53 | Locked cards | Online | Locked cards replace the number-key badge with the price, so keys 4–0 have no visible hint. | POLISH | Show both. |
| 54 | Start Match | Both | Primary action is 147px (online) / 142px (local), centred under 236px-wide Mode/Arena/Sandbox buttons; smaller than the secondary actions. | POLISH | Full width. |
| 55 | Leave Room | Online | Uses `.btn-back` (53px elsewhere) at 98×27 with 11.8px text. | POLISH | Own small-button class; 32px min height. |
| 56 | Name field (local) | Local | No label (online Home says "YOUR NAME"); placeholder "Player 1" disappears once typed. | POLISH | Visible label. |
| 57 | Coins row (local) | Local | "COINS" label at the left edge and the amount at the right; Home centres them. | POLISH | Match Home. |

### Screenshots

**#86** After the loading state ends the buttons look normal, but clicking Confirm does nothing.

&#91;image: #86 dead Confirm button\]

**#42** Mouse bindings print as "--".

&#91;image: #42 key hint\]

**#44** Draven (owned) is dimmer than the locked fighters.

&#91;image: #44 Draven name\]

**#45** The grid reflows when a fighter is previewed (both shots at 1400×1000; note the frame also cuts the grid off at the bottom).

&#91;image: #45 grid reflow\]

**#48** Confirm and Back are different widths.

&#91;image: #48 confirm/back\]

**#49** Back becomes "Change Fighter" after confirming.

&#91;image: #49 change fighter\]

**#51** Room bar pill vs chip.

&#91;image: #51 room bar\]

**#52** Opponent slot repeats itself.

&#91;image: #52 slots\]

**#53** Locked cards show a price instead of their number key.

&#91;image: #53 locked cards\]

**#54** Start Match narrower than the setup buttons above it.

&#91;image: #54 start match\]

**#55** Leave Room.

&#91;image: #55 leave room\]

**#43 / #46** Local build at 1400×1000: the frame cuts the fighter grid off; the fighter detail (with Confirm) and the Settings button are both further down and need a scroll.

&#91;image: #43 #46 local below the fold\]

**#47** Mode and How to Play buttons side by side at different heights.

&#91;image: #47 mode/how to play\]

**#50** P1's Change Fighter sits 11px lower than P2's.

&#91;image: #50 change fighter\]

**#56 / #57** Local name field with no label; coins split to opposite edges.

&#91;image: #56 #57 local name and coins\]

## Game mode and arena select

Both screens lay out cleanly at every size tested; the issues are keyboard access (#8) and wording.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 58 | Arena Back label | Both | "← Back to the room" (online) vs "← Back to Fighters" (local): different case for the same pattern. Match-end says "Back to the Room" with a capital R and no arrow. | POLISH | "← Back to room" / "← Back to fighters". |
| 59 | Mode / Arena widths | Online · 1400×1000 | Mode panel 560px, Arena panel 1000px, both opened from the same Match Setup box. | POLISH | See #3. |

## Settings, rebind, audio, colour-blind palette

The Language row no longer overflows in any language or viewport, but the Music slider controls nothing and the audio sliders are 7px tall.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 60 | Audio → Music slider | Both | Nothing is routed to `musicGain`: every sound goes through `sfxGain`, so the Music slider has no effect. Left over from removing the drone. | WRONG | Remove the row, or bring back music. |
| 61 | Audio sliders | Both, worst at 400×800 | The range inputs are 7px tall (170×7 hit area), the 16px thumb is taller than its 15px row, and rows are 8px apart. | WRONG | 32px-tall rows with the input filling the height. |
| 62 | Colour-blind palette, P2 low HP | Both · Colorblind | P2 becomes orange #E69F00 and the low-HP warning flashes the bar between that and red #ef4444, a pair that red-green colour-blind players can't tell apart, so the warning effectively vanishes. Confirmed on screen in a local match (frames below). | WRONG | Flash to white or pulse the bar's brightness instead. |
| 63 | Colour-blind palette, P1 | Both · Colorblind | P1 becomes #0072B2, about 3.7:1 against the dark UI, and it colours the overhead name sprites and HP bar. From the code; not seen on screen. | POLISH | Lighter blue (e.g. #56B4E9) for text uses. |
| 64 | Language row | Both · all viewports and languages | Fixed: the select's right edge lines up with the other value pills at every size. But the row is 45px vs 41px for its neighbours, with 6px margins, so the gaps around it are 14px vs 7–8px elsewhere. | POLISH | Same height and margins as the other rows. |
| 65 | Row styles | Both | One list mixes 41px option rows (13.1px text) with 50px Rebind/Audio buttons (17.3px text). | POLISH | Make Rebind/Audio option rows with a › chevron. |
| 66 | Online vs local Settings | Both | Different order (local puts Rebind first and Audio after Language), local has an "Unlock everything (sandbox)" checkbox online doesn't, and the build switch reads "Switch to Local Version" vs "Back to Online Version". | POLISH | Same order; "Switch to online/local version". |
| 67 | Account row, long name | Online · signed in | With "Maximiliana Wolfeschlegel" the value pill ends at x 827 vs 815 for every other pill, eating the row's right padding. | POLISH | `max-width` + ellipsis on `.opt-state`. |
| 68 | × close button | Settings, Rebind, Tutorial | 30×30px. | POLISH | 40×40 hit area. |
| 69 | Rebind labels | Both | "Strafe L" / "Strafe R" abbreviations; see #11 for Attack. | POLISH | "Strafe left" / "Strafe right". |

### Screenshots

**#60 / #61** Audio panel: 7px-tall sliders; the Music slider controls nothing.

&#91;image: #60 #61 audio\]

**#64** Gaps between Settings rows: 8px everywhere except around Language (14px).

&#91;image: #64 settings gaps\]

**#67** A long signed-in name pushes its pill past the others.

&#91;image: #67 long name\]

**#69** Rebind labels.

&#91;image: #69 rebind\]

**#62** Colour-blind palette, Player 2 under 25% HP: the bar alternates orange #E69F00 and red #ef4444, roughly every 260ms.

&#91;image: #62 colour-blind low HP flash\]

**#66** Online vs local Settings: different order, different extra rows, different build-switch wording.

&#91;image: #66 settings online vs local\]

## Account panel

Back now returns to Settings as it should (Esc does too), but the panel remembers the last sub-mode.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 70 | Reopening Account | Online · signed out | If you leave from Forgot password, reopening Account lands on Forgot password again instead of Sign in. | WRONG | Reset to Sign in on open. |
| 71 | Forgot password mode | Online | Two different back controls stacked: a 23px text link "← Back to signing in" and the 53px "← Back" button; an empty status line still reserves 16px between them. | POLISH | One "← Back to sign in" link; hide the empty status. |
| 72 | Links and tabs | Online | "Forgot password" is a 21px-tall target (the back link 23px); Sign in / Create account tabs have no `role="tab"` / `aria-selected`. | POLISH | 32px links; tab roles. |
| 73 | Signed-in name | Online · signed in | The display name is concatenated into `innerHTML` unescaped (`accountPanelHTML`). Not a layout issue, but a name containing markup would render as markup. | WRONG | Escape or use `textContent`. |

Signed-in was checked by temporarily faking the account state with a 25-character display name; I didn't create an account on the live site. The panel itself laid out cleanly (no overflow).

### Screenshots

**#70** Reopening Account after leaving from Forgot password.

&#91;image: #70 reopen\]

**#71** Two back controls in Forgot password.

&#91;image: #71 forgot\]

**#72** Small Forgot password target.

&#91;image: #72 links\]

Signed in (faked state, 25-character display name): lays out cleanly.

&#91;image: signed in\]

## How to Play

The card grid leaves one card alone on the last row and stretches short cards to the tallest one.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 74 | Card grid | Online · 1400×1000 | 13 cards in 3 columns leaves "Coins & Unlocks" alone on the last row; cards stretch to row height, so "Objective" fills 94px of a 261px card. Local has 12 cards and no orphan. | POLISH | `align-items: start`, or a 2-column / masonry layout. |
| 75 | "Got it!" | Both | 220px wide and left-aligned, where every other panel's main action is full width. | POLISH | Full width. |
| 76 | Card headings | Both | Mixed styles: "Basic vs. Special", "Looking for co-op?", "Movement & Jumping". | POLISH | Plain noun phrases throughout. |

### Screenshots

**#74** First six cards: up to 153px of empty card below the text.

&#91;image: #74 tutorial grid\]

**#75** Got it! is 220px and left-aligned; the last card sits alone.

&#91;image: #75 got it\]

## Loading, pause, HUD, round-end, match-end

No background hum is possible in the current code: every oscillator is stopped within 1.5s and no buffer loops. The online match-end title is the worst layout here.

| # | Element | Where | What is wrong | Sev | Fix |
| --- | --- | --- | --- | --- | --- |
| 87 | Pause → Settings → Language | Both builds, mid-match (tested in local) | Settings opened from the pause menu is the same modal, Language included. Changing the language mid-match reloads the page (#15) with no warning: the match is gone and you're back at fighter select. Online, that also drops your opponent. The same panel offers "Back to Online Version" / "Switch to Local Version", which also leave the page, and the sandbox checkbox (local). | BROKEN | Hide or disable Language, the build switch and sandbox while a match is live, or ask "This will end the match" first. |
| 77 | Match-end title | Online · 1400×1000 | Title is 44.8px in a 350px column, so "Kaelen (Player 1) Wins Classic Versus! (2-0)" wraps to 4 lines (206px) and the screen grows to 688px in a 650px frame. Since the title now includes the display name, a real 14-character name ("Christophorius", the field's maximum) puts "(Christophorius)" on a line of its own that still runs about 30px past the panel's right edge. Local renders the same title at 18.7px. | WRONG | \~26px, put the mode and score on their own smaller line, `overflow-wrap: anywhere`. |
| 78 | HUD text size | Both · high-DPI (1.5×) screens | The HUD canvas is drawn at device resolution (1755px for 1170 CSS px) but fonts are not scaled, so "Special 4%" at 11px is about 7px on screen and "Esc for controls / pause" (#64748b, 13px) about 9px. | WRONG | Scale HUD fonts by `devicePixelRatio`. |
| 79 | Pause, online | Online | Esc puts your client in PAUSED and shows "Paused" while the opponent's client keeps running (FIGHT). Tested in your Chrome with two clients: while the host sat on "Paused", the guest hit them 10 times and their HP fell 400 → 150 on both screens. The arena-collapse timer kept running, and the guest got no sign the host was in a menu. Pressing Esc online leaves you standing still and defenceless under a screen that says "Paused". | BROKEN | Title it "Menu" online and say the match continues. |
| 80 | Round result, mirror match | Both | With no names set and both on Kaelen, the round banner reads "Round 1: Kaelen wins!"; the HUD names are "Kaelen (Player 1)" / "Kaelen (Player 2)". | POLISH | Lead with Player 1/2 (or the display name) in the banner. |
| 81 | Match-end title animation | Both | `resultGrow` animates `letter-spacing`, so the title re-wraps during its 620ms entrance. | POLISH | Animate transform and opacity only. |
| 82 | Pause buttons | Both | Return to Menu is the same filled cyan as Resume and Rebind Keys; Settings is the only outlined one. | POLISH | Resume filled, the rest outlined, Return to Menu last and quieter. |
| 83 | Pause controls reminder | Local | Wraps to 4 lines with groups split across lines ("Look" / "Up/Down"); "/ Jump" and ". Dash" read as punctuation; "Fwd", "Atk/Spc" abbreviations. | POLISH | A two-column key/action table per player. |
| 84 | Match summary copy | Both | "0 special(s) used"; online shows "P1 +50 coins · P2 +15 coins" instead of names; local uses straight quotes in "unlock everything" while the rest of the UI uses curly ones. | POLISH | Proper plurals, names, curly quotes. |
| 85 | Loading screen timing | Both | Re-measured in your Chrome at full speed (online, two clients, browser cache already warm). First match: the loading screen is up 4.9s, and the INTRO countdown starts underneath it: the host loses the first 1.0s of the countdown, the guest 0.8s. Rematch: 3.3s, overlap 0.1s. The artwork itself is fine; it's the hidden start of the countdown that matters. | POLISH | Start the INTRO clock when the loading screen hides, not when the state changes. |
| 89 | HUD → round-win pips | Local split-screen (online full-screen not checked) | Pips are drawn at the centre of each view ±20px, y 58, but the 420px HP bar runs right up to that point, so a pair of pips sits on the top edge of the HP bar in both halves. Won pips are always #00f3ff cyan, so Player 2's rounds show in Player 1's colour (and ignore the colour-blind palette). | WRONG | Anchor pips to each player's bar (below the name, right of it); fill with sideColor(side). |
| 90 | HUD → small text | Both builds, bright arenas (seen on The Colosseum Ring) | "Special 0%" (#94a3b8, 11px) over pale sky and "Esc for controls / pause" (#64748b, 13px) over the grass floor have no backing plate and are close to unreadable. | WRONG | Put the whole HUD block on a translucent dark plate (the arena name already has one), or add a 1–2px dark text stroke. |
| 91 | Loading screen → artwork | Both builds | The tableau (left/right 14%, top 9%) fades on the left but has hard, visible top and right edges, so it reads as a picture pasted into the frame. The tip text and the LOADING mark sit over its bottom-right corner, and "ARENA // …" sits outside it bottom-left, so the three text blocks don't share an edge. | POLISH | Feather all four edges (mask-image gradient), and put the arena label and the tip on one baseline. |
| 92 | Match-end → summary lines | Local · 1400×1000 | Both fighter lines wrap so that "used" sits alone on the next line; the two lines run together with no gap between fighters. | POLISH | A small two-row stat table (dmg / largest hit / specials) instead of a sentence. |
| 93 | Match-end → actions | Local (online's last button is outlined) | Rematch (Same Arena), Rematch (New Arena), Save Replay and Play Again are four identical filled cyan buttons, so nothing says which is the main action. "Play Again" actually leaves to fighter select, which is what both Rematch buttons sound like they skip. | POLISH | One filled Rematch; the rest outlined; rename Play Again to "Change fighters". |
| 94 | Round-end banner | Local split-screen, bright arena | "Round 2 starting..." (#94a3b8, 13px) under the banner is unreadable over the arena walls. The banner has no backing, and the crosshair and the debug text pass through it. | POLISH | Dark band behind banner + subline; hide the crosshair during ROUND\_END. |
| 95 | Opponent label when unnamed | Online | playerLabel() returns "Player 1" for any unnamed side when the other side has a name. With a named host and an unnamed guest, the guest (who is in the Player 2 slot, pink bar, "PLAYER 2" in the room) is labelled "Kaelen (Player 1)" on the HUD and in the match summary, next to the host who is Player 1. | WRONG | Fall back to the side's own number ("Player 2"), or "Opponent". |
| 96 | Low-HP heartbeat sound | Both builds, whenever either fighter is under 25% HP | sfxHeartbeatTick plays a 55Hz sine for 0.18s every 45 frames (\~0.75s). Krish confirmed by ear that it sounds like a drone, so the "no hum" requirement isn't met while anyone is low on health. | WRONG | Raise it to a 90–120Hz double thump (lub-dub) with a sharp attack and a clear gap, or drop the sound and keep the visual warning. |

### Screenshots

**#89** Round pips sitting on the HP bars, both halves of the split screen.

&#91;image: #89 round pips\]

**#90** HUD text on a bright arena.

&#91;image: #90 HUD contrast\]

**#78** The whole split-screen HUD as a 1.5× screen draws it (full frame, for context).

&#91;image: #78 HUD full\]

**#82 / #83** Local pause: four filled buttons including Return to Menu; the controls reminder breaks groups across lines.

&#91;image: #82 #83 pause\]

**#87** Settings opened from the pause menu, mid-match: Language (and the build switch) are right there.

&#91;image: #87 pause settings\]

**#91** Loading screen artwork.

&#91;image: #91 loading art\]

**#80 / #94** Round banner on a bright arena (both halves of the split screen).

&#91;image: #80 #94 round banner\]

**#92 / #93** Local match-end: orphaned "used" and four identical buttons.

&#91;image: #92 #93 match end local\]

**#77** Online match-end with a real 14-character name: the title runs past the panel edge and the panel is cut off by the frame.

&#91;image: #77 online match end\]

**#95** Online HUD: the unnamed opponent in the pink Player 2 bar is labelled "Player 1". (Also visible: #90's unreadable "Special 0%" under each bar.)

&#91;image: #95 online HUD names\]

**#79** Same moment on both clients: the host on the Paused screen, and the guest's view of the host standing idle at 150/400 HP with the collapse timer still counting.

&#91;image: #79 online pause\]

**#81** The title's entrance animation, frozen at four points: it wraps to 3 lines, then 4, and words move between lines as the letter-spacing settles, pushing the buttons down.

&#91;image: #81 title animation\]

**Hum check:** I couldn't listen (audio stays suspended without a real click), so I checked it two ways. In the code, all 18 `synthTone` calls are short and always call `stop()`, noise buffers never loop, and nothing feeds the music bus. At runtime, I hooked every oscillator and buffer started during a match: none were left running or looping. Second run (today), logging every synthTone/synthNoise call during a local match: 5s idle produced no sounds at all; forcing attacks produced a 220Hz 0.09s wind-up, then on the landed hit a 338Hz 0.12s tone plus a 0.08s noise burst (HP 440 → 405), so per-hit sounds are there. One thing that could read as a hum: sfxHeartbeatTick plays a 55Hz sine for 0.18s every 45 frames (\~0.75s at 60fps) whenever either fighter is under 25% HP. It is a pulse, not a continuous tone, but at 55Hz on small speakers it can sound like a low drone. The headless browser ran too slowly to hear it at the real rate, so that part is from the code.

## Coverage

Ticked items are done (the last few on day 2 in your Chrome, where WebRTC wouldn't connect between two tabs, so the two clients were linked with the game's debug hook instead). What's left is for a human.

- [x] Cropped screenshots: every visual entry has one; #9–#12, #73 and #85 are wording, code or timing, and #19, #34, #56, #65, #68, #76 and #84 are visible in neighbouring shots
- [x] Loading screen artwork (#91)
- [x] Round-end banner (#80, #94)
- [x] Colour-blind palette on screen (#62)
- [x] Match-end title animation (#81)
- [x] Per-hit sounds and idle silence (hum check)
- [x] Real on-screen time of the loading screen (#85): 4.9s first match, 3.3s rematch, measured in your Chrome
- [x] Whether you keep taking damage behind the online pause menu (#79): yes, 400 → 150 HP while "Paused"
- [x] The low-HP heartbeat by ear: Krish says it sounds like a drone (now #96)
- [ ] Hover and pressed states by eye
- [ ] Touch controls at phone width: Krish is testing these on a real device
- [ ] Signed in with a real account (I faked the signed-in state rather than create one)
