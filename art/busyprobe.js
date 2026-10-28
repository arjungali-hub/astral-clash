// Does a busy state leave its buttons working?
//
//   node art/busyprobe.js
//
// Finding #86: previewing a fighter whose model is not cached shows "Loading
// fighter" on the Confirm row, and when it cleared, Confirm and Back did
// nothing. busy() stashed innerHTML and wrote it back, and writing innerHTML
// back PARSES a new tree - the original buttons, and their click listeners,
// are gone.
//
// It looked intermittent because the second click on the same fighter works:
// the model is cached by then, so the busy state never appears. That is the
// shape that wastes an afternoon, so this asserts the mechanism directly
// rather than trying to catch it through the UI.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1000, height: 760 });
    await H.boot(page, { clearStorage: true });

    const out = await page.evaluate(() => {
        const D = window.ACDebug;
        // A row of the same shape as .detail-actions: a button with a listener.
        const host = document.createElement('div');
        const btn = document.createElement('button');
        btn.textContent = 'Confirm';
        let clicks = 0;
        btn.addEventListener('click', () => { clicks++; });
        host.appendChild(btn);
        document.body.appendChild(host);

        const press = () => host.querySelector('button').click();

        press();                       // before any busy state
        const before = clicks;

        D.busy(host, true, 'Loading fighter');
        const marked = !!host.querySelector('.busy-mark-wrap')
            || /ld-mark/.test(host.innerHTML);
        const hiddenWhileBusy = host.querySelector('button').style.display === 'none';

        D.busy(host, false);
        press();                       // after it clears - the reported failure
        const after = clicks;

        const sameNode = host.querySelector('button') === btn;
        host.remove();
        return { before, after, marked, hiddenWhileBusy, sameNode,
                 label: 'clicks before=' + before + ' after=' + after };
    });

    console.log(JSON.stringify(out, null, 2));
    const ok = out.before === 1 && out.after === 2 && out.marked && out.sameNode;
    console.log('');
    console.log(ok
        ? 'CONFIRMED: the button still works after a busy state, and is the same node.'
        : 'FAILED: a busy state still breaks the button - read the dump above.');
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
