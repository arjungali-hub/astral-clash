// Does an open modal hold the keyboard?
//
//   node art/focusprobe.js
//
// Audit #50: "Enter on Settings leaves focus on the Settings button behind the
// modal. Tab walks the modal's 11 controls and its x, then leaves to BODY and
// the Home controls underneath while the modal stays open. There is no focus
// trap."
//
// Audit #51: "Once Tab has carried focus out of an open modal into the name
// field behind it, Escape (pressed 4 times) closes nothing."
//
// Both are driven with REAL key presses through the browser rather than by
// calling the handlers, because the thing being tested is where the browser
// puts focus and which listener sees the key first.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1400, height: 1000 });
    await H.boot(page, { clearStorage: true });

    const where = () => page.evaluate(() => {
        const a = document.activeElement;
        const panel = document.getElementById('settings-screen');
        return {
            tag: a ? a.tagName : 'none',
            id: a ? (a.id || '(no id)') : 'none',
            insidePanel: !!(a && panel && panel.contains(a)),
            panelOpen: !!(panel && getComputedStyle(panel).display !== 'none'),
        };
    });

    // ---- open it the way a keyboard user does --------------------------
    await page.focus('#btn-open-settings');
    await page.keyboard.press('Enter');
    await H.sleep(500);
    const onOpen = await where();

    // ---- twenty Tabs, which is more than the panel holds ---------------
    for (let i = 0; i < 20; i++) await page.keyboard.press('Tab');
    await H.sleep(200);
    const afterTabs = await where();

    // ---- and Shift+Tab backwards past the first control ----------------
    for (let i = 0; i < 25; i++) await page.keyboard.down('Shift'),
        await page.keyboard.press('Tab'), await page.keyboard.up('Shift');
    await H.sleep(200);
    const afterBackTabs = await where();

    // ---- Escape, from wherever focus ended up --------------------------
    await page.keyboard.press('Escape');
    await H.sleep(400);
    const afterEscape = await where();

    // ---- and Escape from inside a text field (#51) ---------------------
    await page.focus('#btn-open-settings');
    await page.keyboard.press('Enter');
    await H.sleep(400);
    const forced = await page.evaluate(() => {
        // Put focus in the field behind the modal by hand - the trap stops Tab
        // getting there now, and this has to test Escape rather than the trap.
        const f = document.getElementById('input-name');
        if (!f) return false;
        f.focus();
        return document.activeElement === f;
    });
    await page.keyboard.press('Escape');
    await H.sleep(400);
    const afterFieldEscape = await where();

    const rows = { onOpen, afterTabs, afterBackTabs, afterEscape,
                   fieldFocused: forced, afterFieldEscape };
    console.log(JSON.stringify(rows, null, 2));

    const fails = [];
    if (!onOpen.insidePanel) fails.push('#50: opening with Enter left focus outside the panel');
    if (!afterTabs.insidePanel) fails.push('#50: 20 Tabs escaped the panel');
    if (!afterBackTabs.insidePanel) fails.push('#50: Shift+Tab escaped the panel');
    if (afterEscape.panelOpen) fails.push('Escape did not close the panel');
    if (!forced) fails.push('could not focus the field behind the modal - probe issue');
    else if (afterFieldEscape.panelOpen) {
        fails.push('#51: Escape from inside a text field did not close the modal');
    }

    console.log('');
    if (fails.length) {
        for (const f of fails) console.log('FAIL: ' + f);
        await browser.close();
        process.exit(1);
    }
    console.log('CONFIRMED: focus opens inside the panel, Tab and Shift+Tab stay in it, '
        + 'and Escape closes it even from a text field.');
    await browser.close();
    process.exit(0);
})();
