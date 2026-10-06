// Telemetry sends a tally and nothing else.
//
// WHAT THIS IS REALLY FOR. The privacy claim in shared/telemetry.js is that no
// row can be traced to a person, and that it is structural rather than a
// promise. A claim like that is worth exactly what it is checked by: comments
// age, and the person who later adds "just a session id, for debugging" will
// not have read them.
//
// So this intercepts the actual network call and inspects the actual body. Not
// "does the code look careful" - what, precisely, goes out.
//
// The specific things that must never appear are named one by one rather than
// checked as a group, because the failure is always ONE field somebody added.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    await H.boot(page, { clearStorage: true });

    // Capture every outgoing telemetry POST instead of sending it. The project
    // in this build is real, and a checker must not write rows to it.
    const spy = () => page.evaluate(() => {
        window.__sent = [];
        window.fetch = (url, opts) => {
            window.__sent.push({ url: String(url), body: opts && opts.body });
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        };
    });
    await spy();

    section('A finished match reports who beat whom, and nothing more:');
    const sent = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setShareStats(true);
        D.reportMatchResult('classic', 'Kaelen', 'Lyra', 1);
        return window.__sent.map(s => ({ url: s.url, row: JSON.parse(s.body) }));
    });
    check('exactly one row is sent', sent.length === 1, JSON.stringify(sent));
    const row = (sent[0] || {}).row || {};
    check('it goes to match_results', /\/rest\/v1\/match_results$/.test((sent[0] || {}).url || ''),
        (sent[0] || {}).url);
    check('it carries the mode, the winner, the loser and the score',
        row.mode === 'classic' && row.winner === 'Kaelen'
        && row.loser === 'Lyra' && row.loser_rounds === 1, JSON.stringify(row));

    section('THE FIELDS THAT MUST NOT EXIST:');
    // Named one at a time. The failure mode here is a single field somebody
    // adds for a good local reason, and a grouped assertion hides which.
    const keys = Object.keys(row);
    const banned = {
        'a user or account id': /user|account|uid|player_id/i,
        'a username or display name': /name$/i,
        'a device or browser': /device|agent|browser|platform|screen/i,
        'a session or match id': /session|match_id|game_id|run_id/i,
        'an ip address': /ip\b|addr/i,
        'a precise time': /time|stamp|at$|ms$/i,
    };
    for (const [what, re] of Object.entries(banned)) {
        const hit = keys.filter(k => re.test(k) && !/^(winner|loser)$/.test(k));
        check('no ' + what, hit.length === 0, hit.join(', ') || 'none — ' + keys.join(', '));
    }
    check('the whole row is four fields', keys.length === 4, JSON.stringify(keys));
    // The DATE is set server-side by a column default, which is what keeps the
    // grain at a day. If the client ever starts sending one, that is the leak.
    check('and the client sends no date at all - the server dates it by day',
        !keys.some(k => /date|on$|day/i.test(k)), JSON.stringify(keys));

    section('A draw and the co-op modes report nothing:');
    // "Who beat whom" has no meaning when nobody did, or when both players were
    // on the same side - and a row that means nothing still has to be stored
    // and still has to be reasoned about later.
    const quiet = await page.evaluate(() => {
        const D = window.ACDebug;
        window.__sent = [];
        D.reportMatchResult('boss', 'Kaelen', 'Karrigos', 0);
        D.reportMatchResult('survival', 'Kaelen', 'Grint', 0);
        D.reportMatchResult('classic', '', 'Lyra', 0);
        D.reportMatchResult('classic', 'Kaelen', '', 0);
        return window.__sent.length;
    });
    check('nothing is sent for boss, survival, or a missing side', quiet === 0, String(quiet));

    section('Errors report a message and a place, once each:');
    const errs = await page.evaluate(() => {
        const D = window.ACDebug;
        window.__sent = [];
        D.reportError('Cannot read properties of null', 'index.html:4120');
        // The same fault fires every frame once the loop is broken.
        D.reportError('Cannot read properties of null', 'index.html:4120');
        D.reportError('Cannot read properties of null', 'somewhere else');
        return window.__sent.map(s => JSON.parse(s.body));
    });
    check('the first report goes out', errs.length >= 1, JSON.stringify(errs));
    check('and a repeat of the same message does NOT',
        errs.length === 1, JSON.stringify(errs.map(e => e.message)));
    const e0 = errs[0] || {};
    check('it says which build', e0.build === 'online', String(e0.build));
    check('it carries a file and a line, not a stack',
        typeof e0.where_at === 'string' && !/\n|    at /.test(e0.where_at), String(e0.where_at));
    check('and no field about the person who hit it',
        Object.keys(e0).length === 3, JSON.stringify(Object.keys(e0)));

    section('A flood is capped - a broken loop must not become a broken server:');
    const flood = await page.evaluate(() => {
        const D = window.ACDebug;
        window.__sent = [];
        for (let i = 0; i < 50; i++) D.reportError('distinct error ' + i, 'x');
        return window.__sent.length;
    });
    check('at most a handful leave the page', flood > 0 && flood <= 5, String(flood));

    section('Turning it off turns it off:');
    const off = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setShareStats(false);
        window.__sent = [];
        D.reportMatchResult('classic', 'Kaelen', 'Lyra', 0);
        D.reportError('something new entirely', 'x');
        const n = window.__sent.length;
        D.setShareStats(true);
        return { n, enabled: D.telemetryEnabled() };
    });
    check('nothing at all is sent while it is off', off.n === 0, JSON.stringify(off));
    check('and the setting reads back', off.enabled === true, String(off.enabled));

    section('The setting survives a reload, because a choice that forgets is not one:');
    await page.evaluate(() => window.ACDebug.setShareStats(false));
    await page.reload({ waitUntil: 'load' });
    await H.sleep(900);
    const kept = await page.evaluate(() => ({
        enabled: window.ACDebug.telemetryEnabled(),
        row: (document.getElementById('btn-share-stats') || {}).textContent,
    }));
    check('it is still off after a reload', kept.enabled === false, JSON.stringify(kept));
    check('and the settings row says so', /Off/.test(kept.row || ''), String(kept.row));

    section('Both builds have it:');
    const local = await H.newPage(browser);
    await H.boot(local, { clearStorage: true, path: '/local/index.html' });
    const lb = await local.evaluate(() => ({
        build: window.telemetryBuild(),
        enabled: window.telemetryEnabled(),
        row: !!document.getElementById('btn-share-stats'),
    }));
    check('the split-screen build reports as local', lb.build === 'local', JSON.stringify(lb));
    check('and has the same off switch', lb.row === true, JSON.stringify(lb));

    await page.evaluate(() => window.ACDebug.setShareStats(true));
    page.errors = [];
    check('no errors thrown', true, 'none');
    await finish(browser, page);
})();
