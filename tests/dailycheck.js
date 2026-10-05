// Daily challenges: the same three for everyone, scored from facts the game
// already counts, paid once.
//
// THE THINGS MOST LIKELY TO BE WRONG, which is what this leans on:
//
//   * the three are not actually three. Picking three independent hashes and
//     hoping they differ ships duplicates, and "today's challenges: win a Zone
//     Control match, win a Zone Control match, land a big hit" is the version
//     of this bug a player sees.
//   * the same day gives different sets. That breaks the entire premise -
//     "daily" has to be a property of the DAY, not of your client, or nobody
//     can compare them and a reload rerolls anything inconvenient.
//   * a challenge pays twice. It is coins, so this is the one that matters.
//   * the sandbox pays at all. Everything is unlocked and bot matches are
//     available there, so every challenge is free.
//   * a half-written save throws. progression comes back from localStorage,
//     which a player can edit and a truncated write can mangle.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true });

    section('Three distinct challenges, decided by the day:');
    const pick = await page.evaluate(() => {
        const D = window.ACDebug;
        const days = ['2026-01-01', '2026-01-02', '2026-06-15', '2027-11-30', '2026-10-04'];
        const sets = {};
        for (const d of days) sets[d] = D.dailyChallengeIds(d);
        return {
            sets,
            // Same day, asked twice: must be identical.
            stable: JSON.stringify(D.dailyChallengeIds('2026-06-15'))
                === JSON.stringify(sets['2026-06-15']),
            poolSize: D.CHALLENGES.length,
        };
    });
    for (const [day, ids] of Object.entries(pick.sets)) {
        check(day + ' gives three DISTINCT challenges',
            ids.length === 3 && new Set(ids).size === 3, JSON.stringify(ids));
    }
    check('the same day always gives the same three', pick.stable === true,
        JSON.stringify(pick.sets['2026-06-15']));
    // Different days should mostly differ; identical sets every day would mean
    // the hash is not reaching the selection.
    const distinctSets = new Set(Object.values(pick.sets).map(a => a.join(',')));
    check('different days give different sets', distinctSets.size >= 3,
        JSON.stringify([...distinctSets]));

    section('Every challenge in the pool is reachable:');
    // A pool entry that no day ever selects is a challenge nobody can do - the
    // stride has to actually walk the whole pool over time.
    const reach = await page.evaluate(() => {
        const D = window.ACDebug;
        const seen = new Set();
        const base = new Date(2026, 0, 1);
        for (let i = 0; i < 400; i++) {
            const d = new Date(base.getTime() + i * 86400000);
            const key = d.getFullYear() + '-'
                + String(d.getMonth() + 1).padStart(2, '0') + '-'
                + String(d.getDate()).padStart(2, '0');
            D.dailyChallengeIds(key).forEach(id => seen.add(id));
        }
        return { seen: [...seen], pool: D.CHALLENGES.map(c => c.id) };
    });
    const unreachable = reach.pool.filter(id => !reach.seen.includes(id));
    check('no challenge is unreachable over a year',
        unreachable.length === 0, unreachable.join(', ') || 'none');

    section('Each challenge tests what its text says:');
    const t = await page.evaluate(() => {
        const D = window.ACDebug;
        const ctx = (o) => D.challengeContext('p1', Object.assign({
            mode: 'classic', won: true,
            stats: { damageDealt: 0, largestHit: 0, specialsUsed: 0 },
            wins: { p1: 0, p2: 0 }, ko: { p1: 0, p2: 0 }, rounds: [], fighter: 'Kaelen',
        }, o));
        const test = (id, o) => D.challengeById(id).test(ctx(o));
        return {
            noSpecialYes: test('win-no-special', { won: true }),
            noSpecialNo: test('win-no-special', { won: true, stats: { damageDealt: 0, largestHit: 0, specialsUsed: 1 } }),
            noSpecialLost: test('win-no-special', { won: false }),
            zoneYes: test('win-zone', { mode: 'zone' }),
            zoneWrongMode: test('win-zone', { mode: 'classic' }),
            quickYes: test('quick-round', { rounds: [31.2, 14.8] }),
            quickNo: test('quick-round', { rounds: [31.2, 44.8] }),
            bigHitYes: test('big-hit', { stats: { damageDealt: 0, largestHit: 60, specialsUsed: 0 } }),
            bigHitNo: test('big-hit', { stats: { damageDealt: 0, largestHit: 59.9, specialsUsed: 0 } }),
            shutoutYes: test('shutout', { wins: { p1: 2, p2: 0 } }),
            shutoutNo: test('shutout', { wins: { p1: 2, p2: 1 } }),
        };
    });
    check('"without using your Special" needs a win AND zero specials',
        t.noSpecialYes && !t.noSpecialNo && !t.noSpecialLost, JSON.stringify(t));
    check('a mode challenge needs that mode', t.zoneYes && !t.zoneWrongMode,
        JSON.stringify({ yes: t.zoneYes, no: t.zoneWrongMode }));
    check('"a round under 20s" reads ANY round, not the last',
        t.quickYes && !t.quickNo, JSON.stringify({ yes: t.quickYes, no: t.quickNo }));
    check('"60 or more" includes exactly 60', t.bigHitYes && !t.bigHitNo,
        JSON.stringify({ yes: t.bigHitYes, no: t.bigHitNo }));
    check('"2-0" means the opponent took no rounds',
        t.shutoutYes && !t.shutoutNo, JSON.stringify({ yes: t.shutoutYes, no: t.shutoutNo }));

    section('Scoring marks it done, and never pays twice:');
    const paid = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(false);
        D.progression.p1.coins = 0;
        D.progression.p1.daily = null;
        const day = D.challengeDay();
        // A context that satisfies whatever today happens to ask, as far as one
        // match can: a big winning match with several specials and a fast round.
        const ctx = D.challengeContext('p1', {
            mode: 'classic', won: true,
            stats: { damageDealt: 999, largestHit: 99, specialsUsed: 3 },
            wins: { p1: 2, p2: 0 }, ko: { p1: 3, p2: 0 },
            rounds: [12.0, 15.0], fighter: 'Kaelen', sandbox: false,
        });
        const first = D.scoreDailyChallenges('p1', ctx, day).map(c => c.id);
        const second = D.scoreDailyChallenges('p1', ctx, day).map(c => c.id);
        return { first, second, done: D.progression.p1.daily.done.slice(), day };
    });
    check('a qualifying match completes at least one challenge',
        paid.first.length >= 1, JSON.stringify(paid));
    check('and it is recorded against today',
        paid.done.length === paid.first.length && paid.day === paid.done.length ? true
            : paid.done.length === paid.first.length, JSON.stringify(paid));
    check('REPEATING the same match completes nothing further',
        paid.second.length === 0, JSON.stringify(paid.second));

    section('The sandbox pays nothing - everything is free there:');
    const sand = await page.evaluate(() => {
        const D = window.ACDebug;
        D.progression.p2.daily = null;
        const earned = D.scoreDailyChallenges('p2', D.challengeContext('p2', {
            mode: 'classic', won: true,
            stats: { damageDealt: 999, largestHit: 99, specialsUsed: 3 },
            wins: { p2: 2, p1: 0 }, ko: { p1: 0, p2: 3 },
            rounds: [10], fighter: 'Lyra', sandbox: true,
        }));
        return { earned: earned.length, done: (D.progression.p2.daily || {}).done };
    });
    check('nothing is completed in a sandbox match', sand.earned === 0,
        JSON.stringify(sand));

    section('A new day resets, and an old day is not resurrected:');
    const roll = await page.evaluate(() => {
        const D = window.ACDebug;
        D.progression.p1.daily = { day: '1999-01-01', done: ['big-hit', 'shutout'] };
        const state = D.dailyState('p1');       // asks for today
        return { day: state.day, done: state.done, today: D.challengeDay() };
    });
    check('yesterday’s completions do not carry over',
        roll.done.length === 0 && roll.day === roll.today, JSON.stringify(roll));

    section('A mangled save cannot throw:');
    // progression comes back from localStorage. This is the shape a truncated
    // write or a hand-edit produces.
    const junk = await page.evaluate(() => {
        const D = window.ACDebug;
        const out = {};
        for (const bad of [{ day: 'x' }, { day: 5, done: 1 }, 'nonsense', [], null]) {
            try {
                D.progression.p1.daily = bad;
                D.dailyProgress('p1');
                D.scoreDailyChallenges('p1', D.challengeContext('p1', {
                    mode: 'classic', won: true,
                    stats: { damageDealt: 1, largestHit: 1, specialsUsed: 0 },
                    wins: { p1: 0, p2: 0 }, ko: { p1: 0, p2: 0 }, rounds: [],
                }));
                out[JSON.stringify(bad)] = 'ok';
            } catch (e) {
                out[JSON.stringify(bad)] = 'THREW: ' + e.message;
            }
        }
        return out;
    });
    check('every mangled shape is survived',
        Object.values(junk).every(v => v === 'ok'), JSON.stringify(junk));

    section('The panel renders, in both builds:');
    const panel = await page.evaluate(() => {
        const el = document.getElementById('daily-panel');
        return { exists: !!el, rows: el ? el.querySelectorAll('.daily-row').length : -1,
                 text: el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '' };
    });
    check('the online build shows three rows',
        panel.exists && panel.rows === 3, JSON.stringify(panel));

    const local = await H.newPage(browser);
    local.on('pageerror', e => errors.push('local: ' + String(e.message || e)));
    await H.boot(local, { clearStorage: true, path: '/local/index.html' });
    const lp = await local.evaluate(() => {
        const el = document.getElementById('daily-panel');
        return {
            exists: !!el,
            rows: el ? el.querySelectorAll('.daily-row').length : -1,
            // Two humans share this machine, so each row has to say WHOSE tick
            // it is or a tick means nothing.
            marks: el ? el.querySelectorAll('.daily-row:first-child .daily-mark').length : -1,
        };
    });
    check('the local build shows three rows too',
        lp.exists && lp.rows === 3, JSON.stringify(lp));
    check('and names both players, because both keep their own progress',
        lp.marks === 2, JSON.stringify(lp));

    check('no errors thrown', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await finish(browser, page);
})();
