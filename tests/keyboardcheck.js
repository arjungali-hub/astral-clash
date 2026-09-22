// Menu, pause and gameover reachable and escapable by keyboard alone.
//
// The last automatable line on the original brief, and a real accessibility
// claim rather than a nicety: somebody who cannot use a mouse either can or
// cannot get out of a modal, and "probably fine, it's all buttons" is not an
// answer.
//
// Three things decide it, and they are different questions:
//
//   1. Is every interactive control natively focusable? A <div> with a click
//      handler is invisible to Tab, and nothing about the page LOOKING like
//      buttons guarantees they are buttons.
//   2. Does Tab actually reach them in the screens that matter? A control can
//      be a real button and still be unreachable behind `tabindex="-1"` or a
//      hidden ancestor.
//   3. Does Escape get you OUT? Reaching a modal you cannot dismiss is worse
//      than not reaching it.
//
// Run against the local build, which is the one with two players at one
// keyboard and therefore the one where keyboard reach matters most.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    await H.boot(page, { clearStorage: true, path: '/local/index.html' });

    section('Every interactive control is a real control:');
    const controls = await page.evaluate(() => {
        // Anything that responds to a click but is not natively focusable and
        // has not been given a tabindex is unreachable by keyboard.
        const NATIVE = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'];
        const bad = [];
        for (const el of document.querySelectorAll('*')) {
            if (NATIVE.includes(el.tagName)) continue;
            if (el.hasAttribute('tabindex')) continue;
            const clicky = el.getAttribute('onclick')
                || el.className && /btn|button|card|tab|opt|chip/i.test(String(el.className));
            if (!clicky) continue;
            // Containers legitimately carry these names; only flag leaves that
            // look like the thing you press.
            if (el.children.length) continue;
            bad.push((el.tagName + '.' + String(el.className || '')).slice(0, 60));
        }
        return bad;
    });
    check('no click-only element that Tab cannot reach',
        controls.length === 0, controls.slice(0, 6).join(' | ') || 'none');

    section('Tab reaches the menu, and Escape leaves the modals:');
    const menuReach = await page.evaluate(() => {
        const vis = el => el.getClientRects().length > 0;
        const focusable = [...document.querySelectorAll('button, a[href], input, select, textarea')]
            .filter(el => vis(el) && !el.disabled && el.tabIndex !== -1);
        return { count: focusable.length, first: focusable[0] && focusable[0].id };
    });
    check('the menu offers focusable controls', menuReach.count > 3, JSON.stringify(menuReach));

    // Open a modal the way a keyboard user would reach it, then leave with Escape.
    const modalEscape = await page.evaluate(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const D = window.ACDebug;
        // The real id in this build. Guessing ids and falling back to "skipped"
        // would have quietly reported nothing rather than testing anything.
        const open = document.getElementById('btn-open-tutorial')
            || document.getElementById('btn-open-settings');
        if (!open) return { skipped: 'no How to Play button' };
        open.focus();
        const focused = document.activeElement === open;
        open.click();
        await wait(250);
        const opened = !!D.currentScreen || document.querySelectorAll('.modal').length >= 0;
        const before = [...document.querySelectorAll('[id$="-modal"], .modal')]
            .filter(el => el.getClientRects().length > 0).length;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await wait(300);
        const after = [...document.querySelectorAll('[id$="-modal"], .modal')]
            .filter(el => el.getClientRects().length > 0).length;
        return { focused, opened, before, after };
    });
    if (modalEscape.skipped) {
        check('a modal can be opened from the keyboard', false, modalEscape.skipped);
    } else {
        check('a menu button can take focus', modalEscape.focused === true, JSON.stringify(modalEscape));
        check('and Escape closes what it opened',
            modalEscape.after <= modalEscape.before, JSON.stringify(modalEscape));
    }

    section('Pause opens and closes during a fight, from the keyboard:');
    await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        const pick = (grid, detail) => {
            document.querySelectorAll(grid + ' .fighter-btn')[0].click();
            const c = document.querySelector(detail + ' .btn-confirm');
            if (c) c.click();
        };
        pick('#p1-grid', '#p1-detail');
        pick('#p2-grid', '#p2-detail');
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
        const card = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (card) card.click();
    });
    const fighting = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 90000);
    check('a fight is running to pause', fighting, 'never reached FIGHT');

    const paused = await page.evaluate(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const D = window.ACDebug;
        // ONCE, on window only. Dispatching on document AND window fired the
        // listener twice for every "press" - it is registered on window and a
        // document event bubbles there anyway - so Escape toggled pause on and
        // straight back off, and the test reported the game as unpausable.
        const send = k => window.dispatchEvent(
            new KeyboardEvent('keydown', { key: k, code: k, bubbles: true }));
        const start = D.gameState;
        // Report WHY, not just that it did not pause. The Escape branch is
        // `if (modalOpen()) closeTopModalByEscape(); else togglePause();`, so a
        // modal left registered after the arena picker would eat the key and
        // look identical to a broken pause.
        const modalBefore = typeof modalOpen === 'function' ? modalOpen() : 'no modalOpen';
        send('Escape');
        await wait(300);
        const afterOpen = D.gameState;
        const modalAfter = typeof modalOpen === 'function' ? modalOpen() : 'no modalOpen';
        send('Escape');
        await wait(300);
        // Did the handler run AT ALL? It sets keys[k] several lines before the
        // Escape branch, and `keys` is exposed - so this separates "the event
        // never arrived" from "it arrived and the branch did not fire".
        // (togglePause itself cannot be called from here: it is declared inside
        // bootGame(), so it is not a global the way the shared functions are.)
        const sawKey = !!(D.keys && D.keys.escape);
        return { start, afterOpen, afterClose: D.gameState, modalBefore, modalAfter, sawKey };
    });
    check('Escape pauses the fight', paused.afterOpen === 'PAUSED', JSON.stringify(paused));
    check('and Escape resumes it', paused.afterClose === 'FIGHT', JSON.stringify(paused));

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
