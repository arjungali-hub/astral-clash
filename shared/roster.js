// Astral Clash - the data BOTH builds share.
//
// Loaded as a plain script by index.html (the online build) and by
// legacy/local-splitscreen.html (the archived local build), before either of
// them defines bootGame(). Classic scripts share one global scope, so every
// `const` here is visible inside both games with no import and no call-site
// change - which is the whole point: this file exists so a balance or roster
// change happens ONCE.
//
// Before this, art/port_to_legacy.py copied these tables from index.html into
// the archived build by anchor after every batch, and the recurring bug report
// was the obvious one: "most of the changes seem to have not landed in the
// legacy version". Anything in here cannot drift, because there is only one of
// it.
//
// RULES FOR THIS FILE
//   1. DATA AND PURE FUNCTIONS ONLY. No DOM, no THREE, no audio, no netcode -
//      it is loaded before either game and must not care which one it is in.
//   2. Neither build may re-declare these names. A `const` inside bootGame()
//      shadows the global and turns this file into dead weight that still
//      looks authoritative.
//   3. If a value differs between the two builds, it does not belong here.
//      The renderer, input model, HUD layout and netcode are genuinely
//      different and stay forked - see the Batch 25 note in port_to_legacy.py.

// WHERE THE ASSETS ARE, resolved from where THIS FILE is.
//
// The two builds sit at different depths - index.html at the repo root,
// legacy/local-splitscreen.html one directory down - so every asset path used
// to be written twice and rewritten by the port script. A script knows its own
// URL, and assets/ is a sibling of shared/, so one absolute base serves both
// and neither build needs to be told anything.
//
// It also removes an accident. The archived build's `../assets/x` is written
// for its own directory, but /local is a Vercel REWRITE: the document URL is
// `/local`, so that path climbs above the root and only works because browsers
// clamp it. An absolute base is correct at every path a rewrite can invent.
const AC_ASSET_BASE = (function () {
    var self = document.currentScript && document.currentScript.src;
    // No currentScript means this was not loaded as a normal script tag (an
    // eval, a bundler, a test harness): fall back to a root-relative path,
    // which is right for the online build and the served archive alike.
    if (!self) return '/assets/';
    return new URL('../assets/', self).href;
})();

// Three starters spanning the three archetypes a new player needs to feel
// out the game: a balanced melee duelist, a ranged caster, and a tank.
const STARTER_CHARS = ['Kaelen', 'Lyra', 'Draven'];
// Unlock prices, tiered loosely by how strong/complex a kit is rather than
// flat, so the cheap unlocks are also the easier ones to pick up.
const UNLOCK_COST = { Ignis: 300, Nyx: 400, Aurelia: 450, Seraphine: 500, Gorgonok: 600, Thorne: 700, Voss: 750 };
const UPGRADE_TRAITS = ['hp', 'dmg', 'special', 'speed'];
// Batch 24: `dmg` boosts the MAIN ATTACK only — specials read their damage
// from character data and are deliberately not multiplied by it — and
// `special` buys meter charge RATE, not special damage. Once the stat panel
// started listing "Main Attack" and "Special" as separate damage numbers,
// labels reading "Damage" and "Special" here implied they scaled those two
// rows. They don't, so they now say what they actually buy.
const UPGRADE_TRAIT_LABELS = { hp: 'Health', dmg: 'Attack', special: 'Charge', speed: 'Speed' };
const UPGRADE_COST = [150, 300, 500]; // cost of buying level 1 / 2 / 3
const MAX_UPGRADE_LEVEL = 3;
// +5% per level (+15% maxed). Deliberately modest: a fully-upgraded starter
// should still never eclipse a stock top-tier pick, so upgrades feel like
// progress without turning the roster into a pay-to-win ladder.
const UPGRADE_STAT_BONUS = 0.05;
const DOUBLE_JUMP_COST = 1000; // applies to all of that player's fighters; priced above any single unlock as a capstone
// Batch 21: the winner takes the bigger purse. A loss still pays something so a
// player on a losing streak keeps inching toward their next unlock rather than
// being hard-stuck with nothing to show for the matches they played.
const COIN_AWARDS = {
    classicWin: 50, classicLoss: 15, classicDraw: 30,
    zoneWin: 50, zoneLoss: 15,
    timeattackWin: 50, timeattackLoss: 15,
    bossWin: 150, bossLoss: 20,
    survivalPerWave: 40
};

// Co-op-only combatants, kept OUT of CHARACTERS so buildGrid (which iterates
// CHARACTERS unconditionally) can never turn one into a pickable fighter.
// Populated by Batch 17; declared here because the Fighter constructor reads it.
const BOSS_MAP = {};

const DEG = Math.PI / 180;

// Batch 4 balance pass: old numbers gave a 1.5-2.9s time-to-kill at 100%
// uptime (see checklist for the math). HP raised ~4x and damage roughly
// halved, on top of the Batch 3b frame-data windows already cutting raw
// DPS 25-35% on their own, targeted a ~20-40s TTK worst case at the time.
// Basic-attack damage was later multiplied 5x on top of that (see
// CHECKLIST.md) as a deliberate, explicit request — TTK is now much
// shorter by design, working together with the arena-collapse mechanic
// below to force a decisive fight instead of stalling.
// meterRateMult scales special-meter gain from both dealing and taking
// damage (see METER_DEALT_RATE/METER_TAKEN_RATE) — this is the "per-
// character rate multiplier in config instead of a name-check" the brief
// asked for; Gorgonok's old hardcoded passive-charge special case is gone,
// replaced by a high meterRateMult so he still charges fastest passively.
// Batch 24: every entry now also carries `atkName`/`atkDesc` (the BASIC attack
// was previously undocumented anywhere in the UI — the select screen described
// only the special, so half of what you actually do in a match was invisible
// before you bought the character) and the special's damage as DATA
// (`specialDmg` × `specialHits`, plus `specialDot` for damage-over-time and
// `specialKind:'shield'` for the one special that deals none).
//
// Those damage numbers are read by doSpecial itself, not just by the UI. They
// used to be literals buried in each switch case, so a shop that displayed them
// would have been a second copy free to drift out of sync with the real hit.
// One source of truth, consumed by both.
// Batch 38: the three RANGED fighters carry 100 less HP than they did.
//
// Lyra 360->260, Seraphine 380->280, Aurelia 340->240 - the ones whose atkType
// is shard/orb/bolt, which is the same test `isRanged` uses. A ranged fighter
// already wins the neutral game: it deals damage across the whole arena while a
// melee fighter has to cross it first, and the arena is wide enough that
// closing the gap costs real health. Paying for that with a shorter health bar
// is the standard trade, and it makes the melee roster's one advantage - being
// able to end an exchange once it starts - actually decisive.
//
// Reasoned, NOT playtested. The three were within 40 HP of the melee median
// before this, which is what made them safe picks rather than fragile ones.
const CHARACTERS = [
    { name: 'Kaelen', title: 'Tempo Duelist', color: '#3b82f6', speed: 3.4, hp: 400, meterRateMult: 1,
      atkType: 'slash', dmg: 35, range: 70, halfAngle: 55 * DEG, cooldown: 16,
      atkName: 'Rhythm Slash',
      atkDesc: 'A quick sword arc through a wide cone in front of him. Short reach, but it recovers fast enough to throw out on reaction and keep throwing.',
      special: 'dash', specialName: 'Blade Dash', specialDesc: 'Dash through the enemy, cutting them on the pass and ending behind them.',
      specialDmg: 90,
      desc: 'A balanced duelist with no bad matchup and no free win either. He wants to live at the edge of his own reach, trading slashes and using the dash to cross the gap or escape a corner.' },
    { name: 'Lyra', title: 'Shardwing Sylph', color: '#a855f7', speed: 3, hp: 260, meterRateMult: 1,
      atkType: 'shard', dmg: 30, range: 260, halfAngle: 15 * DEG, cooldown: 16,
      atkName: 'Glass Shard',
      atkDesc: 'Fires a single fast shard in a straight line. Long range, but it is a real projectile — it can miss, and it can be sidestepped or blocked by cover.',
      special: 'volley', specialName: 'Prism Volley', specialDesc: 'Spray a wide 5-shard fan to wall off space.',
      specialDmg: 24, specialHits: 5,
      desc: 'Fragile and deadly at range. She loses any melee exchange she is dragged into, so the whole game is keeping the gap open — the volley is as much a wall as it is damage.' },
    { name: 'Gorgonok', title: 'Tectonic Brute', color: '#f97316', speed: 1.9, hp: 520, meterRateMult: 1,
      atkType: 'punch', dmg: 70, range: 75, halfAngle: 45 * DEG, cooldown: 30,
      atkName: 'Forge Hammerfist',
      atkDesc: 'The hardest-hitting basic on the roster, and by far the most committal — a long wind-up and a long recovery. Two of these end most fights; two whiffs end yours.',
      special: 'shockwave', specialName: 'Seismic Slam', specialDesc: 'A ground slam that launches the enemy away and stuns them.',
      specialDmg: 95,
      desc: 'The largest health pool in the game, on the slowest fighter in it. He cannot chase anyone, so he wins by making the space directly in front of him unaffordable to stand in — and the slam clears that space again whenever someone gets comfortable.' },
    { name: 'Voss', title: 'Flicker Cutthroat', color: '#14b8a6', speed: 4.1, hp: 320, meterRateMult: 1,
      atkType: 'dagger', dmg: 25, range: 45, halfAngle: 65 * DEG, cooldown: 9,
      atkName: 'Quickstab',
      atkDesc: 'The fastest basic in the game — a near-instant dagger poke with almost no recovery. The reach is the shortest in the game, so you have to be genuinely on top of someone.',
      special: 'flurry', specialName: 'Shadow Flurry', specialDesc: 'Blink onto the enemy and stab rapidly, briefly invulnerable.',
      specialDmg: 19, specialHits: 4,
      desc: 'A blazing-fast glass cannon with the thinnest health of any melee fighter. He wins by never being where the last swing was — and the flurry is invulnerable, so it doubles as a way to run straight through an incoming attack.' },
    { name: 'Draven', title: 'Bastion Knight', color: '#6b7280', speed: 2.2, hp: 440, meterRateMult: 1.8,
      atkType: 'hammer', dmg: 50, range: 60, halfAngle: 40 * DEG, cooldown: 20,
      atkName: 'Ironclad Smash',
      atkDesc: 'A heavy hammer swing through a narrow cone. Slow to start and slow to recover, so a whiff is a real punish — but it hits hard enough to be worth the risk.',
      special: 'groundbreak', specialName: 'Ground Breaker', specialDesc: 'A short-range overhead smash that hard-stuns (knocks down).',
      specialDmg: 70,
      desc: 'Armoured but not immovable, and he builds special meter far faster than anyone else — so the knockdown comes around often. Use it to reset a fight you are losing, not just for the damage.' },
    { name: 'Seraphine', title: 'Haloed Aegis', color: '#eab308', speed: 2.6, hp: 280, meterRateMult: 0.8,
      atkType: 'orb', dmg: 25, range: 260, halfAngle: 15 * DEG, cooldown: 16,
      atkName: 'Astral Orb',
      atkDesc: 'Lobs a slow-building orb of light down a long, narrow line. Low damage per shot — it is chip damage meant to be applied constantly from a safe distance.',
      special: 'ward', specialName: 'Astral Ward', specialDesc: 'Raise a strong shield that halves incoming damage for several seconds.',
      specialDmg: 0, specialKind: 'shield',
      desc: 'The only fighter whose special deals no damage at all. She survives instead of trading: the ward halves everything for over three seconds, which is long enough to walk through a special that would have killed her. Her meter builds slowest, so spend it deliberately.' },
    { name: 'Nyx', title: 'Cowled Harvester', color: '#7c3aed', speed: 3.2, hp: 380, meterRateMult: 1,
      atkType: 'scythe', dmg: 34, range: 95, halfAngle: 60 * DEG, cooldown: 19,
      atkName: 'Umbral Reap',
      atkDesc: 'A long scythe sweep through a wide cone — more reach than any other melee basic except Thorne, and wide enough that a sidestep alone will not clear it.',
      special: 'reap', specialName: "Death's Embrace", specialDesc: 'Yank the enemy in, cut them, and root them in place.',
      specialDmg: 70,
      desc: 'Long reach that drags foes into the blade. The special pulls a runaway opponent from well outside her range and roots them there, which turns a fleeing ranged fighter into a free follow-up.' },
    { name: 'Ignis', title: 'Cinder Pugilist', color: '#dc2626', speed: 3.7, hp: 380, meterRateMult: 1.1,
      atkType: 'punch', dmg: 22, range: 55, halfAngle: 50 * DEG, cooldown: 9,
      atkName: 'Ember Jab',
      atkDesc: 'A rapid flurry jab with a very short cooldown. The least damage per hit on the roster, but you land far more of them than anyone else does.',
      special: 'inferno', specialName: 'Inferno Burst', specialDesc: 'Erupt in flame, leaving the enemy burning over time.',
      specialDmg: 45, specialDot: 66,
      desc: 'A relentless pressure fighter, fast on his feet and faster with his fists. The burst itself is modest — the burn afterwards is the real payload, and it keeps ticking while you keep jabbing.' },
    { name: 'Aurelia', title: 'Stormcrown Valkyrie', color: '#22d3ee', speed: 3.0, hp: 240, meterRateMult: 1,
      atkType: 'bolt', dmg: 28, range: 300, halfAngle: 12 * DEG, cooldown: 15,
      atkName: 'Storm Bolt',
      atkDesc: 'The longest-range basic in the game: a fast bolt down a very tight line. It demands real aim — the cone is the narrowest on the roster and it is still a dodgeable projectile.',
      special: 'thunder', specialName: 'Thunderstrike', specialDesc: 'Call a bolt down directly onto the enemy — cannot be sidestepped.',
      specialDmg: 90,
      desc: 'A ranged stormcaller who outranges everyone. Her special is the exception to everything else she does: it lands on the target directly rather than travelling, so it cannot be dodged or blocked by cover.' },
    { name: 'Thorne', title: 'Antlered Reaver', color: '#4ade80', speed: 2.8, hp: 420, meterRateMult: 1,
      atkType: 'whip', dmg: 30, range: 115, halfAngle: 32 * DEG, cooldown: 20,
      atkName: 'Thornwhip',
      atkDesc: 'The longest melee reach in the game, but through a narrow cone — it is a line, not a sweep, so it needs to be aimed rather than swung in someone\'s general direction.',
      special: 'bramble', specialName: 'Bramble Lash', specialDesc: 'A wide thorn-arc that ensnares (roots) the enemy in place.',
      specialDmg: 60,
      desc: 'A space-controller with the longest melee reach on the roster. He fights from a distance most characters consider safe, and the root buys him more than a second of free hits from exactly there.' }
];
// Batch 22: present the roster in PRICE order — the three free starters first,
// then unlocks cheapest-to-priciest — so the grid reads as a progression ladder
// instead of an arbitrary sequence with locked cards scattered through it.
//
// Sorted in place rather than at render time on purpose: the select-screen
// hotkeys are POSITIONAL (`P1_KEYS[i]` pairs with `CHARACTERS[i]`, and the
// keyboard handler resolves a key back via `P1_KEYS.indexOf(k)`), so reordering
// the array reorders the hotkeys to match automatically and keeps the two in
// step. A display-only sort would have silently desynced card labels from the
// keys that actually select them. Everything else that touches characters is
// name-keyed (CHAR_MAP, FRAME_DATA, MESH_BUILDERS, SFX_TYPE_BY_CHAR), so it's
// unaffected. Array#sort is stable, so equal-priced entries keep their
// hand-authored relative order.
CHARACTERS.sort((a, b) => (UNLOCK_COST[a.name] || 0) - (UNLOCK_COST[b.name] || 0));

const CHAR_MAP = Object.fromEntries(CHARACTERS.map(c => [c.name, c]));

// --- Batch 17: Karrigos, the Granite Colossus (co-op boss).
// Same config shape as a CHARACTERS entry, so the Fighter constructor reads it
// without special-casing — but stored in BOSS_MAP (declared far earlier, since
// the constructor needs it) specifically so it is NOT in CHARACTERS, which
// buildGrid iterates unconditionally to build the pickable roster.
//
// Base HP here is a normal-ish number; spawnBossForFight multiplies it by
// BOSS_HP_BASE_MULT and the difficulty tier, so the real pool is thousands.
// Reach is long (it's huge) and damage is high per hit, but every swing is
// slow and telegraphed — see FRAME_DATA.Karrigos.
// --- Batch 23: Survival-only enemies.
// Purpose-built minions rather than reskinned roster fighters, on request: a
// wave of "Thornes" reads as a mirror match gone wrong, whereas these are
// obviously *other things* — and because they're only ever AI-controlled they
// can be lopsided (very fast and fragile, or slow and shielded) in ways a
// player-pickable character couldn't fairly be.
//
// They live in BOSS_MAP alongside Karrigos for the same load-bearing reason:
// anything in CHARACTERS becomes a pickable fighter on the select screen.
// Each is individually much weaker than a roster fighter — several at once is
// the threat, not any one of them.
Object.assign(BOSS_MAP, {
    Grint: {
        name: 'Grint', title: 'Scrap Gremlin', color: '#84cc16',
        speed: 4.4, hp: 130, meterRateMult: 0.5,   // fastest thing in the game, dies to a stiff breeze
        atkType: 'dagger', dmg: 16, range: 52, halfAngle: 45 * DEG, cooldown: 14,
        special: 'dash', specialName: 'Skitter', specialDesc: 'Darts through its target.',
        specialDmg: 30,   // was silently dealing Kaelen's 90 — see Batch 24
        desc: 'Tiny, frantic, and never alone.',
    },
    Slagling: {
        name: 'Slagling', title: 'Ashen Mortar', color: '#fb923c',
        speed: 2.4, hp: 150, meterRateMult: 0.6,   // ranged chip damage; forces you to close
        atkType: 'shard', dmg: 14, range: 240, halfAngle: 16 * DEG, cooldown: 30,
        special: 'volley', specialName: 'Cinder Spray', specialDesc: 'Spits a fan of molten shards.',
        specialDmg: 12,   // was silently dealing Lyra's 24 per shard, x5
        desc: 'Hangs back and lobs fire. Punish it for existing.',
    },
    Hollowkin: {
        name: 'Hollowkin', title: 'Gaunt Wraith', color: '#64748b',
        speed: 2.0, hp: 260, meterRateMult: 0.7,   // the anvil of a wave: soaks hits, hits back hard
        atkType: 'punch', dmg: 26, range: 62, halfAngle: 42 * DEG, cooldown: 26,
        special: 'shockwave', specialName: 'Collapse', specialDesc: 'A short shockwave that shoves you off.',
        specialDmg: 34,   // was silently dealing Gorgonok's 70
        desc: 'Slow, heavy, and unbothered by your first few hits.',
    },
    Karrigos: {
        // Very dark, desaturated stone. This has to be MUCH darker than it looks
        // in isolation: the arenas are brightly lit (sun + hemisphere + ambient)
        // and the renderer uses filmic tone mapping at exposure 1.1, so a mid-grey
        // albedo like #6b6259 rendered as pale beige plastic. The existing dark
        // trim (#3f2a20) is what actually reads as "dark" under that lighting, so
        // the body is pitched to match it.
        name: 'Karrigos', title: 'Granite Colossus', color: '#3a352f',
        speed: 1.5,            // ponderous — you can always outrun it, which is the point
        hp: 620, meterRateMult: 3.4, // high meter rate: its big attacks come around on a rhythm rather than needing to "earn" them
        atkType: 'hammer',     // reuses the existing heavy-burst effect + impact sound
        dmg: 58, range: 108, halfAngle: 62 * DEG, cooldown: 34,
        special: 'titan',      // cycles Ground Slam -> Charge -> Ember Nova (see doSpecial)
        specialName: 'Titan\'s Wrath',
        specialDesc: 'Cycles between a shockwave Ground Slam, a telegraphed Charge, and an Ember Nova spread.',
        desc: 'A mountain that learned to move. Slow, enormous, and utterly unbothered.',
    },
});

// Batch 3b: every attack/special is startup -> active -> recovery,
// not an instant hit. Startup is the visible tell an opponent reacts to;
// active is the (usually short) hitbox window; recovery is the whiff-
// punish window. All values are frames-at-60fps-equivalent (dt-scaled),
// tunable in one place. Fast characters (Voss) get short numbers across
// the board; heavy ones (Gorgonok, Draven) get long, genuinely committal
// numbers, especially on recovery.
const FRAME_DATA = {
    Kaelen:    { basic: { startup: 6,  active: 4, recovery: 11 }, special: { startup: 8,  active: 6, recovery: 14 } },
    Lyra:      { basic: { startup: 8,  active: 2, recovery: 10 }, special: { startup: 10, active: 2, recovery: 16 } },
    Gorgonok:  { basic: { startup: 16, active: 6, recovery: 24 }, special: { startup: 20, active: 8, recovery: 28 } },
    Voss:      { basic: { startup: 3,  active: 3, recovery: 14 }, special: { startup: 5,  active: 4, recovery: 9  } },
    Draven:    { basic: { startup: 10, active: 5, recovery: 16 }, special: { startup: 14, active: 6, recovery: 20 } },
    Seraphine: { basic: { startup: 9,  active: 2, recovery: 11 }, special: { startup: 8,  active: 2, recovery: 12 } },
    Nyx:       { basic: { startup: 9,  active: 5, recovery: 15 }, special: { startup: 12, active: 6, recovery: 18 } },
    Ignis:     { basic: { startup: 4,  active: 6, recovery: 10 }, special: { startup: 10, active: 5, recovery: 16 } },
    Aurelia:   { basic: { startup: 9,  active: 2, recovery: 12 }, special: { startup: 14, active: 3, recovery: 18 } },
    Thorne:    { basic: { startup: 11, active: 4, recovery: 17 }, special: { startup: 13, active: 6, recovery: 19 } },
    // Batch 17: Karrigos. Startups are far longer than anything on the roster
    // (Gorgonok, the slowest fighter, is 16/20) — that IS the boss design: every
    // attack has a big readable wind-up you're meant to see coming and punish,
    // and a long recovery that rewards you for spacing rather than trading.
    // Difficulty tiers shorten these via `telegraphMult`, not by editing this.
    Karrigos:  { basic: { startup: 26, active: 8, recovery: 34 }, special: { startup: 38, active: 10, recovery: 42 } },
    // Batch 23: Survival minions. Short windows across the board — they're meant
    // to feel like pressure rather than like duels, and a long tell on something
    // that dies in two hits would just read as it standing still.
    Grint:     { basic: { startup: 4,  active: 3, recovery: 9  }, special: { startup: 6,  active: 4, recovery: 12 } },
    Slagling:  { basic: { startup: 10, active: 2, recovery: 14 }, special: { startup: 14, active: 3, recovery: 20 } },
    Hollowkin: { basic: { startup: 13, active: 5, recovery: 20 }, special: { startup: 18, active: 6, recovery: 26 } }
};
// Basic-attack cycle (max of S+A+R and cooldown) x current dmg gives the
// worst-case (100% uptime, no misses) raw DPS — recomputed against the
// post-5x damage numbers, so this now matches the CHARACTERS data above it:
//   Kaelen   35dmg / 21f(0.35s)  = 100 dps -> ~4.0s TTK vs 400 HP
//   Lyra     30dmg / 20f(0.33s)  =  90 dps -> ~4.0s TTK vs 360 HP
//   Gorgonok 70dmg / 46f(0.77s)  =  91 dps -> ~5.7s TTK vs 520 HP
//   Voss     25dmg / 20f(0.33s)  =  75 dps -> ~4.3s TTK vs 320 HP
//   Draven   50dmg / 31f(0.52s)  =  97 dps -> ~4.6s TTK vs 440 HP
//   Seraphine 25dmg / 22f(0.37s) =  68 dps -> ~5.6s TTK vs 380 HP
// Real fights aren't 100% uptime — spacing, whiffs, dodge i-frames and
// hitstun stretch this to roughly a 5-15s band. That's why Arena Collapse
// was retuned to first-crush ~56s (see its constants block): it only ever
// bites a genuinely stalled round. Reasoned, not playtested.

const RIG_TARGET_HEIGHT = 50;

const CHAR_MODEL_URLS = {
    // Batch 35: the whole roster, generated with Hyper3D Rodin and rigged by
    // art/pipeline.py (see art/generate_chars.py and art/build_headless.py).
    // These are fetched ON DEMAND, not at boot - fourteen models is ~29 MB
    // and a match needs two of them. See ensureCharModel.
    Kaelen: AC_ASSET_BASE + 'chars/kaelen.glb',
    Lyra: AC_ASSET_BASE + 'chars/lyra.glb',
    Gorgonok: AC_ASSET_BASE + 'chars/gorgonok.glb',
    Voss: AC_ASSET_BASE + 'chars/voss.glb',
    Draven: AC_ASSET_BASE + 'chars/draven.glb',
    Seraphine: AC_ASSET_BASE + 'chars/seraphine.glb',
    Nyx: AC_ASSET_BASE + 'chars/nyx.glb',
    Ignis: AC_ASSET_BASE + 'chars/ignis.glb',
    Aurelia: AC_ASSET_BASE + 'chars/aurelia.glb',
    Thorne: AC_ASSET_BASE + 'chars/thorne.glb',
    Grint: AC_ASSET_BASE + 'chars/grint.glb',
    Slagling: AC_ASSET_BASE + 'chars/slagling.glb',
    Hollowkin: AC_ASSET_BASE + 'chars/hollowkin.glb',
    Karrigos: AC_ASSET_BASE + 'chars/karrigos.glb',
};

const RIG_HEIGHT_MULT = {
    Karrigos: 1.5,
    Grint: 0.72,
    Slagling: 0.86,
    Hollowkin: 1.08,
};
function rigHeightFor(name) { return RIG_TARGET_HEIGHT * (RIG_HEIGHT_MULT[name] || 1); }
