// Do both builds LOAD? Thirty seconds, no gameplay, no assertions about play.
//
//     node tests/bootcheck.js
//
// WHY THIS EXISTS SEPARATELY FROM smoke.js. smoke boots the online build and
// then plays it, which takes 75-170 seconds; localstartcheck does the same for
// the local one. Both would catch a build that fails to load - eventually, and
// only if you were already planning to run them. This is the check you can
// afford to run after every edit, and it answers the one question that makes
// every other checker meaningless if the answer is no.
//
// THE BUG IT WAS WRITTEN FOR. Moving playerName() into shared/common.js left
// one reference behind, in the ACDebug export list:
//
//     playerName, setLocalName, refreshLocalNames, ...
//
// A bare identifier in an object literal's shorthand. It is a READ, so the
// sync's dangling-reference guard should have caught it - except that guard is
// bounded by the ONLINE build's vocabulary, and playerName was a local-only
// name. It was not in the online build's list of definitions, so it was never
// a candidate. The local build died at load with "playerName is not defined"
// and the sync reported success.
//
// A load check has no vocabulary problem: it runs the file.
const H = require('./harness');

const BUILDS = [
    ['online', u => u],
    ['local', u => u.replace('/index.html', '/local/index.html')],
];

(async () => {
    const browser = await H.launch();
    await H.startServer();
    let failed = 0;
    for (const [name, urlOf] of BUILDS) {
        const page = await H.newPage(browser);
        const errs = [];
        page.on('pageerror', e => errs.push(String(e.stack || e.message || e)));
        page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
        await page.goto(urlOf(H.GAME_URL), { waitUntil: 'load' });
        // ACDebug is published at the END of bootGame(), so its presence means
        // the whole closure ran rather than throwing somewhere in the middle.
        // 2.5s covers the shared modules and three.js on a loaded machine.
        await H.sleep(2500);
        const booted = await page.evaluate(() => !!window.ACDebug).catch(() => false);
        if (booted && !errs.length) {
            console.log('  ' + name + ' build: loads clean');
        } else {
            failed++;
            console.log('  ' + name + ' build: FAILED'
                + (booted ? '' : ' (ACDebug never appeared)'));
            for (const e of errs.slice(0, 3)) console.log('      ' + e.split('\n')[0]);
        }
        await page.close();
    }
    await H.closeAllBrowsers();
    // The exact wording tests/run.js grades on.
    console.log(failed ? '\nFAILED (' + failed + ' build(s) did not load)'
                       : '\nALL CHECKS PASSED');
    process.exit(failed ? 1 : 0);
})();
