// Does the pause screen tell the truth, and does Settings refuse to reload a
// live match?
//
//   node art/pauseprobe.js
//
// Finding #79: online, Escape suspends nothing but your own view. The peer's
// client stays in FIGHT and keeps swinging - reported with numbers, 400 HP to
// 150 while the screen said "Paused". The fix is a label, so the only honest
// check of it is to read the label in both states.
//
// Finding #87: Settings offers Language and the build switch during a match,
// and both reload the page, which ends it. The fix disables them and says why.
//
// Both are asserted on the ONLINE build, the only one where either applies:
// split-screen has no peer to keep fighting and no network to lose. Neither
// needs a new ACDebug export - the panel is opened by clicking the button a
// player clicks, and the three predicates involved (netActive, netInGrace,
// matchInProgress) are top-level functions in shared/common.js and therefore
// globals, which is what makes a peer-less check of peer behaviour possible.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1100, height: 800 });
    await H.boot(page, { clearStorage: true });

    const out = await page.evaluate(() => {
        const D = window.ACDebug;
        const read = () => ({
            title: (document.getElementById('pause-title') || {}).textContent,
            note: (document.getElementById('pause-online-note') || {}).style.display,
            resume: (document.getElementById('btn-resume') || {}).textContent,
        });
        const IDS = ['sel-lang', 'btn-local-build', 'btn-online-build', 'chk-unlock-all'];
        const openSettings = () => {
            document.getElementById('btn-open-settings').click();
            const present = IDS.filter((i) => document.getElementById(i));
            const state = {
                open: document.getElementById('settings-screen').style.display,
                checked: present,
                enabled: present.filter((i) => !document.getElementById(i).disabled),
                note: (document.getElementById('settings-match-note') || {}).style.display,
            };
            const x = document.querySelector('#settings-screen .modal-x');
            if (x) x.click();
            return state;
        };

        // ---- in the menu: nothing is running ----------------------------
        D.refreshPauseUI();
        const offline = read();
        const menuSettings = openSettings();

        // ---- a live networked match -------------------------------------
        const real = {
            active: window.netActive,
            grace: window.netInGrace,
            inMatch: window.matchInProgress,
        };
        window.netActive = () => true;
        window.netInGrace = () => false;
        window.matchInProgress = () => true;
        D.refreshPauseUI();
        const online = read();
        const liveSettings = openSettings();
        window.netActive = real.active;
        window.netInGrace = real.grace;
        window.matchInProgress = real.inMatch;
        D.refreshPauseUI();
        const after = read();

        return { offline, online, after, menuSettings, liveSettings };
    });

    console.log(JSON.stringify(out, null, 2));

    const fails = [];
    if (out.offline.title !== 'Paused') fails.push('menu title is not "Paused"');
    if (out.offline.note !== 'none') fails.push('the "match runs on" note shows offline');
    if (out.offline.resume !== 'Resume (Esc)') fails.push('offline Resume is relabelled');

    if (out.online.title !== 'Menu') fails.push('#79: online title is still "' + out.online.title + '"');
    if (out.online.note === 'none') fails.push('#79: no note that the match runs on');
    if (!/Back to the Fight/.test(String(out.online.resume))) {
        fails.push('#79: Resume still claims to resume, reads "' + out.online.resume + '"');
    }

    // The label has to go BACK, or the pause screen lies the other way round
    // once the match is over.
    if (out.after.title !== 'Paused') fails.push('#79: the title does not revert');

    if (out.menuSettings.open !== 'flex') fails.push('Settings did not open from the menu');
    if (out.menuSettings.enabled.length !== out.menuSettings.checked.length) {
        fails.push('#87: disabled in the menu: ' + out.menuSettings.checked
            .filter((i) => !out.menuSettings.enabled.includes(i)).join(', '));
    }
    if (out.menuSettings.note !== 'none') fails.push('#87: the match note shows in the menu');
    if (out.liveSettings.enabled.length) {
        fails.push('#87: still enabled mid-match: ' + out.liveSettings.enabled.join(', '));
    }
    if (out.liveSettings.note === 'none') fails.push('#87: no reason beside the disabled controls');

    console.log('');
    if (fails.length) {
        for (const f of fails) console.log('FAIL: ' + f);
        await browser.close();
        process.exit(1);
    }
    console.log('CONFIRMED: #79 the pause screen names what it is and reverts; '
        + '#87 Settings will not reload a live match.');
    await browser.close();
    process.exit(0);
})();
