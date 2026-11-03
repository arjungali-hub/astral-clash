// #8: BACK AND RELOAD. Does the game ask before a match is thrown away, and
// does Back close a modal instead of leaving the site?
//
//     node tests/backguardcheck.js
//
// WHY THIS FILE EXISTS. #8 shipped with no coverage at all - nothing in the
// suite mentioned beforeunload, popstate or history - and the way that showed
// up was four unrelated checkers reporting NO VERDICT. smoke, swingcheck,
// mapscheck and maptimecheck are the only four that call H.boot() inside a loop
// on one page, so they are the only four that re-navigate straight after a
// fight, and the guard did to them exactly what it is built to do to a player:
// it refused. A browser dialog nobody answers blocks the navigation that raised
// it, so page.goto waited out its whole budget and threw before the first
// assertion of any of them.
//
// Three shards' worth of failures, and not one of them was about the thing that
// had changed. A feature whose only test is the damage it does elsewhere is an
// untested feature; this is its test.
//
// THE TWO HALVES ARE OPPOSITE ASSERTIONS, which is the point of testing them
// together. The guard has to fire during a match and has to NOT fire on a menu,
// and it has to consume exactly the history entries it creates - one too few
// and Back leaves the site with a modal open, one too many and Back stops
// working on a page where nothing is open.
const H = require('./harness');

// bootcheck's path into the arena: the shortest one that reaches FIGHT.
async function intoAFight(page) {
    await page.evaluate(() => {
        window.ACDebug.setDebugUnlockAll(true);
        for (const s of ['p1', 'p2']) {
            const b = document.querySelector('#' + s + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + s + '-detail .btn-confirm');
            if (c) c.click();
        }
        const st = document.getElementById('btn-start-match');
        if (st) st.click();
        const card = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (card) card.click();
    });
    return H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 70000);
}

const shown = (page, id) => page.evaluate((i) => {
    const el = document.getElementById(i);
    return !!el && getComputedStyle(el).display !== 'none';
}, id);

// A RELOAD, asked for the way a player asks for one, and answered by the
// harness's dialog handler. What is under test is whether the game ASKS, which
// is page.dialogs - not whether the navigation eventually happened.
async function navigateAndCount(page) {
    page.dialogs.length = 0;
    await page.goto(H.GAME_URL, { waitUntil: 'load', timeout: H.budget(30000) });
    await H.sleep(900);
    return page.dialogs.filter(d => d.type === 'beforeunload').length;
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });

    section('On a menu, leaving is the browser\'s business');
    check('menu state is MENU', await page.evaluate(() => window.ACDebug.gameState) === 'MENU');
    check('reloading a menu asks nothing', await navigateAndCount(page) === 0);

    section('A live match is asked about before it is thrown away');
    if (!await intoAFight(page)) {
        check('reached a fight', false, 'never left the menu');
    } else {
        await H.sleep(600);
        check('gameState is FIGHT', await page.evaluate(() => window.ACDebug.gameState) === 'FIGHT');
        check('reloading a live match asks first', await navigateAndCount(page) === 1);
    }

    // THE CASE THE GUARD WAS ORIGINALLY BLIND TO. It asked inLiveMatch(), which
    // excludes PAUSED, and matchInProgress() exists for exactly this reading:
    // the fight is not running, but the match is still there to lose. Pause is
    // also the only way most people reach Settings mid-match, so the narrow
    // version was off in the likeliest case there is.
    section('So is a paused one');
    if (!await intoAFight(page)) {
        check('reached a fight to pause', false, 'never left the menu');
    } else {
        await H.sleep(600);
        await page.keyboard.press('Escape');
        await H.sleep(400);
        const st = await page.evaluate(() => window.ACDebug.gameState);
        check('Escape paused the match', st === 'PAUSED', 'state is ' + st);
        check('pause screen is up', await shown(page, 'pause-screen'));
        check('reloading a PAUSED match asks first', await navigateAndCount(page) === 1);
    }

    section('Back closes the modal, not the site');
    // A sentinel on the window, because the two outcomes are indistinguishable
    // by URL: boot navigates to this same address twice, so the entry behind
    // the current one IS the game. A document navigation wipes a global; a
    // popstate the game handled itself does not.
    const mark = () => page.evaluate(() => { window.__acBackProbe = 1; });
    const survived = () => page.evaluate(() => window.__acBackProbe === 1);

    await page.evaluate(() => document.getElementById('btn-open-settings').click());
    await H.sleep(400);
    check('Settings opened', await shown(page, 'settings-screen'));
    await mark();
    page.dialogs.length = 0;
    await page.evaluate(() => history.back());
    await H.sleep(600);
    check('Back closed Settings', !await shown(page, 'settings-screen'));
    check('Back did not leave the page', await survived());
    check('Back asked nothing on a menu', page.dialogs.length === 0);

    // AND THE SYMMETRIC FAILURE, which is the likelier one to write: a modal
    // closed by its own x or by Escape has to give its history entry back, or
    // every later Back press is swallowed by a modal that is no longer there -
    // the exact wart openModal's comment says the design exists to avoid.
    //
    // WHAT IS NOT ASSERTED HERE, and why - because the obvious two ways to
    // assert it both look sound and are not, and the next person will reach for
    // exactly those:
    //
    //   * PRESS BACK AND SEE WHETHER WE LEFT. A leaked entry is a Back press
    //     that goes nowhere, so pressing Back on a page with nothing open ought
    //     to leave the site. It cannot be read that way: every entry in this
    //     page's history is the SAME URL, so "we left" and "we went back to
    //     another entry for this same address" are the same observation.
    //   * READ history.state. armBackGuard stamps {acModal: n}, which looks like
    //     a direct answer and is not: navigating to a URL already in the entry
    //     RELOADS it, and a reload restores that entry's state. Measured right
    //     after a plain page.goto, history.state is already {acModal:1} - so
    //     every entry reads alike, before anything in the test has happened.
    //
    // backGuardDepth is the real bookkeeping and lives inside bootGame()'s
    // closure, where a checker cannot see it. modalStack can be read, so what
    // IS asserted is the behaviour the accounting exists to produce: a panel
    // that shuts, a page that stays, and a stack that empties. The count itself
    // has no sound assertion from out here, and an assertion whose failure
    // cannot be attributed is worth less than this paragraph.
    const stackDepth = () => page.evaluate(() => modalStack.length);

    section('A modal closed any other way still clears the stack');
    await page.evaluate(() => document.getElementById('btn-open-settings').click());
    await H.sleep(400);
    check('opening pushes onto the stack', await stackDepth() === 1);
    await page.keyboard.press('Escape');
    await H.sleep(800);
    check('Escape closed Settings', !await shown(page, 'settings-screen'));
    check('Escape emptied the stack', await stackDepth() === 0);

    // The tutorial is the one that opens BY ITSELF, on a first visit, before
    // anyone has pressed anything - and it arms the guard from load-time code,
    // which is the one place a push can happen with no gesture behind it.
    section('So does the one that opens by itself');
    await page.evaluate(() => document.getElementById('btn-open-tutorial').click());
    await H.sleep(500);
    check('How to Play opened', await shown(page, 'tutorial-screen'));
    check('and pushed onto the stack', await stackDepth() === 1);
    await page.evaluate(() => document.getElementById('btn-tutorial-close').click());
    await H.sleep(800);
    check('Got it! closed it', !await shown(page, 'tutorial-screen'));
    check('Got it! emptied the stack', await stackDepth() === 0);

    // AND BACK STILL WORKS AFTERWARDS, which is the half of the accounting that
    // can be seen from here: if closing by Escape had left an entry behind, the
    // press below would spend itself on that and this panel would stay up.
    section('Back still closes a modal after all of that');
    await page.evaluate(() => document.getElementById('btn-open-settings').click());
    await H.sleep(400);
    await mark();
    await page.evaluate(() => history.back());
    await H.sleep(900);
    check('Back closed it', !await shown(page, 'settings-screen'));
    check('and did not leave the page', await survived());

    await finish(browser, page);
})();
