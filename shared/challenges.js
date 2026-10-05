// Three daily challenges, the same three for everybody, with no server.
//
// WHY THIS EXISTS. Progression ends when everything is unlocked. After that a
// match pays coins into a purse with nothing left to buy, which is the point at
// which a game stops asking anything of you. Challenges give the economy
// somewhere to go and give a session a reason to be today's session.
//
// WHY THE DAY DECIDES THEM. "Daily" could have meant "three at random when you
// open the game", which is cheaper and worse: it makes the challenge a property
// of your client rather than of the day, so nobody can compare them, and a
// reload rerolls anything inconvenient. Seeding from the DATE gives every
// player the same three without a server knowing who anybody is - which is the
// same principle the netcode already holds to, that a peer-to-peer match should
// not depend on a third party or tell one who is playing.
//
// WHAT A CHALLENGE MAY ASK. Only things the game already counts. Every test
// below reads the match summary that endMatch() already builds for its own
// results screen - damage dealt, largest hit, specials used, round times, the
// mode, the score. Nothing here adds a counter, because a counter added for a
// challenge is a counter nothing else validates.

const CHALLENGE_KEY = 'astralClashDaily';

// Three is a session, not a chore. Enough that one being unsuited to your
// fighter does not empty the day, few enough to finish in a sitting.
const DAILY_COUNT = 3;

// Local midnight, not UTC: "today" should mean the player's today. The cost is
// that two players in different time zones briefly see different sets, which
// matters far less than a challenge that rolls over in the afternoon.
function challengeDay(now) {
    const d = now || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
}

// FNV-1a. Any stable hash would do; what matters is that it is written here
// rather than borrowed from a date library, so the same string gives the same
// three challenges in every build, every browser and every future version.
function challengeHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// The pool. `test(c)` receives one match's facts and answers yes or no.
//
//   c.mode        'classic' | 'zone' | 'timeattack' | 'boss' | 'survival'
//   c.won         did THIS side win
//   c.stats       { damageDealt, largestHit, specialsUsed }
//   c.wins        { p1, p2 } round wins
//   c.ko          { p1, p2 } takedowns
//   c.side        'p1' | 'p2'
//   c.foe         the other side's key
//   c.rounds      [seconds, ...] one per round played
//   c.fighter     the character name this side used
//
// Every entry is winnable by every fighter. A challenge that a slow fighter
// cannot complete is a challenge that punishes a roster choice made before it
// was known, which is the thing daily objectives most often get wrong.
const CHALLENGES = [
    {
        id: 'win-no-special',
        text: 'Win a match without using your Special',
        coins: 40,
        test: (c) => c.won && c.stats.specialsUsed === 0,
    },
    {
        id: 'win-zone',
        text: 'Win a Zone Control match',
        coins: 30,
        test: (c) => c.won && c.mode === 'zone',
    },
    {
        id: 'win-race',
        text: 'Win a Takedown Race',
        coins: 30,
        test: (c) => c.won && c.mode === 'timeattack',
    },
    {
        id: 'quick-round',
        text: 'Win a round in under 20 seconds',
        coins: 30,
        // Any round, not the match: a fast round inside a loss still counts,
        // because the thing being asked for is the round.
        test: (c) => c.rounds.some(s => s > 0 && s < 20),
    },
    {
        id: 'big-hit',
        text: 'Land a single hit for 60 damage or more',
        coins: 25,
        test: (c) => c.stats.largestHit >= 60,
    },
    {
        id: 'shutout',
        text: 'Win a Classic match 2-0',
        coins: 45,
        test: (c) => c.won && c.mode === 'classic'
            && c.wins[c.side] >= 2 && c.wins[c.foe] === 0,
    },
    {
        id: 'heavy-match',
        text: 'Deal 400 damage in a single match',
        coins: 30,
        test: (c) => c.stats.damageDealt >= 400,
    },
    {
        id: 'three-specials',
        text: 'Use your Special three times in one match',
        coins: 25,
        test: (c) => c.stats.specialsUsed >= 3,
    },
    {
        id: 'coop-wave',
        text: 'Clear a Survival Waves run with a teammate',
        coins: 40,
        test: (c) => c.mode === 'survival' && c.won,
    },
    {
        id: 'comeback',
        text: 'Win a match after losing the first round',
        coins: 50,
        // Three rounds played and a win means the first one was dropped: a
        // best-of-three that reaches round three cannot have been 2-0.
        test: (c) => c.won && c.mode === 'classic' && c.rounds.length >= 3,
    },
];

// Today's three, by id.
//
// Drawn WITHOUT replacement from a pool that is walked by a stride coprime with
// its length, so the three are always distinct and the set rotates properly
// instead of favouring whatever the modulus likes. Picking three independent
// hashes and hoping they differ is the version of this that ships duplicates.
function dailyChallengeIds(day) {
    const d = day || challengeDay();
    const h = challengeHash(d);
    const n = CHALLENGES.length;
    const start = h % n;
    // 7 and 10 share no factors; if the pool ever changes size, any stride
    // coprime with n works and 1 always is.
    let stride = 7 % n;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    if (gcd(stride, n) !== 1) stride = 1;
    const out = [];
    for (let i = 0; i < DAILY_COUNT && i < n; i++) {
        out.push(CHALLENGES[(start + i * stride) % n].id);
    }
    return out;
}

function challengeById(id) { return CHALLENGES.find(c => c.id === id) || null; }

function dailyChallenges(day) {
    return dailyChallengeIds(day).map(challengeById).filter(Boolean);
}

// Per-side record of what today's three are and which are done.
//
// Rolled over lazily rather than on a timer: the only moment it matters is when
// something reads or writes it, and a player who leaves the tab open overnight
// should get the new day's set when they next finish a match, not a stale one.
function dailyState(side, day) {
    const d = day || challengeDay();
    const p = progression[side];
    if (!p) return { day: d, done: [] };
    if (!p.daily || p.daily.day !== d) p.daily = { day: d, done: [] };
    if (!Array.isArray(p.daily.done)) p.daily.done = [];
    return p.daily;
}

function challengeDone(side, id, day) {
    return dailyState(side, day).done.indexOf(id) >= 0;
}

// Score one side's match against today's three.
//
// Returns the challenges newly completed. The CALLER pays them, for two
// reasons: addCoins lives inside bootGame() and a shared module cannot see in
// (the sync refused to write the build until this moved, which is the guard
// doing its job), and it is the better split anyway - this decides what was
// earned, the build decides what earning means. The caller also has to SAY SO:
// a reward that arrives silently is one nobody can learn from, and learning
// what the game wanted is most of the point of a daily objective.
function scoreDailyChallenges(side, ctx, day) {
    // Nothing is earned in the sandbox, for the same reason no coins are: every
    // fighter is unlocked and bot matches are available, so any challenge is
    // free. matchIsSandbox lives in the build, so the caller passes the answer.
    if (!ctx || ctx.sandbox) return [];
    const state = dailyState(side, day);
    const earned = [];
    for (const ch of dailyChallenges(day)) {
        if (state.done.indexOf(ch.id) >= 0) continue;
        let ok = false;
        // A thrown predicate must not cost a player their match summary.
        try { ok = !!ch.test(ctx); } catch (e) { ok = false; }
        if (!ok) continue;
        state.done.push(ch.id);
        earned.push(ch);
    }
    if (earned.length) saveProgression();
    return earned;
}

// The facts one side's match produced, in the shape test() expects. Built from
// what endMatch already has, so nothing new is counted anywhere.
function challengeContext(side, o) {
    const foe = side === 'p1' ? 'p2' : 'p1';
    return {
        side, foe,
        mode: o.mode,
        won: !!o.won,
        stats: o.stats || { damageDealt: 0, largestHit: 0, specialsUsed: 0 },
        wins: o.wins || { p1: 0, p2: 0 },
        ko: o.ko || { p1: 0, p2: 0 },
        rounds: Array.isArray(o.rounds) ? o.rounds : [],
        fighter: o.fighter || '',
        sandbox: !!o.sandbox,
    };
}

// How today is going, for the panel that shows it.
function dailyProgress(side, day) {
    const list = dailyChallenges(day);
    const state = dailyState(side, day);
    return list.map(ch => ({
        id: ch.id,
        text: ch.text,
        coins: ch.coins,
        done: state.done.indexOf(ch.id) >= 0,
    }));
}

// Which sides this machine shows progress for. Online a client owns exactly one
// purse, so it is the one it drives; locally both players keep their own
// progression on the same machine, so both are shown and each needs a name
// against it or a tick means nothing.
function dailySidesShown() {
    return AC_ONE_SIDE_PER_CLIENT ? [LOCAL_SIDE] : ['p1', 'p2'];
}

// Today's three, as markup for the home screen.
//
// Built as a string here rather than as elements in the build, because then it
// is written once and both builds render the same panel - the alternative is
// the thing CLAUDE.md's first rule exists to stop.
function dailyPanelHTML() {
    const sides = dailySidesShown();
    const named = sides.length > 1;
    const rows = dailyChallenges().map(ch => {
        const marks = sides.map(side => {
            const done = challengeDone(side, ch.id);
            const who = named ? displayName(side) : '';
            return '<span class="daily-mark' + (done ? ' done' : '') + '">'
                + (done ? '\u2713' : '\u25cb') + (who ? ' ' + who : '') + '</span>';
        }).join('');
        const all = sides.every(side => challengeDone(side, ch.id));
        return '<li class="daily-row' + (all ? ' done' : '') + '">'
            + '<span class="daily-text">' + ch.text + '</span>'
            + '<span class="daily-coins">+' + ch.coins + '</span>'
            + marks + '</li>';
    }).join('');
    return '<h4>Today\u2019s Challenges</h4><ul class="daily-list">' + rows + '</ul>';
}

function refreshDailyUI() {
    const el = document.getElementById('daily-panel');
    if (!el) return;
    el.innerHTML = dailyPanelHTML();
}
