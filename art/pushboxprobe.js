// Do two fighters standing on exactly the same point come apart?
//
//   node art/pushboxprobe.js
//
// resolvePlayerCollision is commented "keeps the two fighters from ever
// standing exactly on top of each other", and exactly on top of each other was
// the one case it could not do. `Math.hypot(dx, dy) || 1` kept the division
// safe and left the direction at (0, 0), so the branch ran, computed a push,
// and multiplied it by a zero vector. Nothing moved, and nothing in the maths
// could ever separate them again.
//
// Reported from a collision sweep as "two fighters can occupy exactly the same
// x/y (verified: distinct objects, identical coordinates, both at rest)". The
// method here is the one that report used - set x/y and let the game run -
// because that is what proved it in the first place.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

// The shortest path into a real fight, as bootcheck does it: the pushbox only
// runs while two fighters exist.
async function enterAFight(page) {
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));
    for (const side of ['p1', 'p2']) {
        await page.evaluate((s) => {
            const b = document.querySelector('#' + s + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + s + '-detail .btn-confirm');
            if (c) c.click();
        }, side);
    }
    await page.evaluate(() => {
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
    });
    await page.evaluate(() => {
        const c = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (c) c.click();
    });
    return H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000);
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1000, height: 700 });
    await H.boot(page, { clearStorage: true });

    if (!await enterAFight(page)) {
        console.log('FAILED: never reached FIGHT - this says nothing about the pushbox.');
        await browser.close();
        process.exit(1);
    }
    // Clear of walls and scenery, so a clamp or an obstacle cannot be what
    // separates them and be mistaken for the pushbox working.
    const out = await page.evaluate(async () => {
        const D = window.ACDebug;
        const a = D.player1, b = D.player2;
        const put = (x, y) => {
            for (const f of [a, b]) { f.x = x; f.y = y; f.vx = 0; f.vy = 0; }
        };
        const gap = () => Math.hypot((b.x + b.width / 2) - (a.x + a.width / 2),
                                     (b.y + b.height / 2) - (a.y + a.height / 2));
        const frames = (n) => new Promise((res) => {
            let i = 0;
            const step = () => (++i >= n ? res() : requestAnimationFrame(step));
            requestAnimationFrame(step);
        });

        put(820, 460);
        const coincidentAt0 = gap();
        await frames(30);
        const coincidentAfter = gap();

        // A control: overlapping but NOT coincident always worked, so if this
        // one fails the probe is wrong rather than the fix.
        put(820, 460);
        b.x = 825;
        await frames(30);
        const overlappingAfter = gap();

        return {
            minDist: a.width / 2 + b.width / 2 - 8,
            coincidentAt0, coincidentAfter, overlappingAfter,
            distinct: a !== b,
        };
    });

    console.log(JSON.stringify(out, null, 2));
    const fails = [];
    if (!out.distinct) fails.push('player1 and player2 are the same object');
    if (out.coincidentAt0 > 0.001) fails.push('could not place them coincident');
    if (out.coincidentAfter < out.minDist - 0.5) {
        fails.push('coincident fighters stayed welded: gap '
            + out.coincidentAfter.toFixed(2) + ' < minDist ' + out.minDist);
    }
    if (out.overlappingAfter < out.minDist - 0.5) {
        fails.push('the control failed too - merely overlapping fighters did not separate, '
            + 'so this probe is not measuring the pushbox');
    }

    console.log('');
    if (fails.length) {
        for (const f of fails) console.log('FAIL: ' + f);
        await browser.close();
        process.exit(1);
    }
    console.log('CONFIRMED: coincident fighters separate to the full pushbox distance.');
    await browser.close();
    process.exit(0);
})();
