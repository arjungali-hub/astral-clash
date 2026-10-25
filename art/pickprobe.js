// Does previewPick + confirmPick actually choose a fighter?
//
//   node art/pickprobe.js
//
// One page, no networking, ten seconds. spectatecheck spent THREE CI rounds at
// ten minutes each reporting "host state MENU", and all three were this:
// confirmPick(side) takes ONE argument and returns immediately unless that
// side already has a preview, so `confirmPick('p1', 'Kaelen')` ignored the
// name, found no preview and did nothing. The cheapest way to know a two-call
// sequence works is to make the two calls.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 900, height: 700 });
    await H.boot(page, { clearStorage: true });

    const out = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        const before = { p1: D.p1Choice, p2: D.p2Choice, preview: D.p1Preview };
        // The wrong way, kept deliberately: this is what three CI rounds ran.
        D.confirmPick('p1', 'Kaelen');
        const afterWrong = { p1: D.p1Choice, preview: D.p1Preview };
        // The right way.
        D.previewPick('p1', 'Kaelen');
        const afterPreview = { p1: D.p1Choice, preview: D.p1Preview };
        D.confirmPick('p1');
        const afterConfirm = { p1: D.p1Choice, preview: D.p1Preview };
        D.previewPick('p2', 'Lyra');
        D.confirmPick('p2');
        return { before, afterWrong, afterPreview, afterConfirm,
                 p2: D.p2Choice,
                 exported: { p1Stage: typeof D.p1Stage, p1Preview: typeof D.p1Preview } };
    });

    console.log(JSON.stringify(out, null, 2));
    const ok = out.afterWrong.p1 === out.before.p1
        && out.afterConfirm.p1 === 'Kaelen' && out.p2 === 'Lyra';
    console.log('');
    console.log(ok
        ? 'CONFIRMED: confirmPick alone does nothing; preview-then-confirm picks.'
        : 'UNEXPECTED: read the dump above before changing the checker again.');
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
