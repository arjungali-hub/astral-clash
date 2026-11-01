// Does a networked hit do what a local hit does?
//
//   node art/hitprobe.js
//
// Audit #1: "On the victim's machine a landed hit only removes HP: no
// knockback, no hitstun, no hit flash, no meter for taking damage." The cause
// is one line in applyDamage - `if (!attacker) return;` - and everything a hit
// IS lives after it. The HIT handler passed null.
//
// This asserts the MECHANISM rather than driving two browsers: run the same
// damage through the local path and through the networked path on one page,
// and compare what each leaves behind. The networked path is the handler
// itself, called with a HIT message of the shape the wire carries - so if the
// message stops carrying a direction, or the handler stops resolving the
// attacker, this fails for the right reason.
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1000, height: 700 });
    await H.boot(page, { clearStorage: true });

    await page.evaluate(() => {
        const D = window.ACDebug;
        D.setDebugUnlockAll(true);
        for (const side of ['p1', 'p2']) {
            const b = document.querySelector('#' + side + '-grid .fighter-btn');
            if (b) b.click();
            const c = document.querySelector('#' + side + '-detail .btn-confirm');
            if (c) c.click();
        }
        const s = document.getElementById('btn-start-match');
        if (s) s.click();
        const card = document.querySelectorAll('#mapselect-grid .map-card')[0];
        if (card) card.click();
    });
    // WAITED FOR, not slept through: the intro clock now starts when the
    // loading screen hides, so how long INTRO lasts in wall-clock time depends
    // on how long the assets took.
    if (!await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000)) {
        console.log('FAILED: never reached FIGHT - this says nothing about #1.');
        await browser.close();
        process.exit(1);
    }

    const out = await page.evaluate(() => {
        const D = window.ACDebug;
        // THE VICTIM IS THE LOCAL FIGHTER, because that is who the HIT handler
        // applies to - no need to fake which side this client drives. Online
        // LOCAL_SIDE is p1 at boot, so p1 is hit and p2 is the attacker.
        const b = D.player1, a = D.player2;
        const place = () => {
            a.x = 760; a.y = 400; a.z = 0; a.fx = -1; a.fy = 0;
            b.x = 700; b.y = 400; b.z = 0; b.fx = 1; b.fy = 0;
            b.hitstunTimer = 0; b.hitFlash = 0; b.invulnFrames = 0;
            b.specialMeter = 0; b.hp = b.maxHp;
            a.atkKind = 'basic';
        };
        const snap = (f) => ({ x: Math.round(f.x * 10) / 10, hp: Math.round(f.hp),
                               hitstun: Math.round(f.hitstunTimer),
                               flash: Math.round(f.hitFlash),
                               meter: Math.round(f.specialMeter * 100) / 100 });

        // ---- the local path, which is the reference ------------------
        place();
        const beforeLocal = snap(b);
        b.takeDamage(30, a, { dx: -1, dy: 0 });
        const afterLocal = snap(b);

        // ---- the networked path, through the real handler ------------
        place();
        const beforeNet = snap(b);
        D.netFeed({ t: 'HIT', dmg: 30, dx: -1, dy: 0, sp: false });
        const afterNet = snap(b);

        return {
            local: { before: beforeLocal, after: afterLocal },
            net: { before: beforeNet, after: afterNet },
        };
    });

    if (out.err) { console.log('FAILED: ' + out.err); await browser.close(); process.exit(1); }
    console.log(JSON.stringify(out, null, 2));

    const dl = { dx: Math.abs(out.local.after.x - out.local.before.x),
                 hitstun: out.local.after.hitstun, flash: out.local.after.flash,
                 meter: out.local.after.meter - out.local.before.meter };
    const dn = { dx: Math.abs(out.net.after.x - out.net.before.x),
                 hitstun: out.net.after.hitstun, flash: out.net.after.flash,
                 meter: out.net.after.meter - out.net.before.meter };
    console.log('');
    console.log('            knockback  hitstun  flash  meter');
    const row = (n, d) => console.log('  ' + n.padEnd(10)
        + String(d.dx).padEnd(11) + String(d.hitstun).padEnd(9)
        + String(d.flash).padEnd(7) + d.meter);
    row('local', dl);
    row('networked', dn);

    const fails = [];
    if (!(dl.dx > 0)) fails.push('the LOCAL path produced no knockback - this probe is wrong, not the game');
    if (!(dn.dx > 0)) fails.push('#1: a networked hit still produces no knockback');
    if (!(dn.hitstun > 0)) fails.push('#1: a networked hit still produces no hitstun');
    if (!(dn.flash > 0)) fails.push('#1: a networked hit still produces no hit flash');
    if (!(dn.meter > 0)) fails.push('#1: taking a networked hit still builds no meter');

    console.log('');
    if (fails.length) {
        for (const f of fails) console.log('FAIL: ' + f);
        await browser.close();
        process.exit(1);
    }
    console.log('CONFIRMED: a networked hit knocks back, stuns, flashes and builds meter.');
    await browser.close();
    process.exit(0);
})();
