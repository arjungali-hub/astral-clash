// Every screen this session touched, photographed.
//
//   node art/screenshots.js            online build
//   node art/screenshots.js --local    split-screen build
//
// WHY THIS EXISTS. A UI review pass changed about sixty declarations across
// ten panels, and four screenshots were taken while doing it. Everything else
// was reasoned from the stylesheet - which is exactly the method that produced
// three confidently wrong findings in the review being worked from. The HUD
// changes are the sharpest case: the round pips were moved to MODE_Y on the
// strength of a COMMENT saying that band is clear in both layouts.
//
// Each shot is taken from the real navigation - the buttons a player presses -
// rather than by forcing display:block on a panel, because half the findings
// here were about panels sized by their container.
const path = require('path');
const fs = require('fs');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const OUT = path.join(__dirname, '..', 'tests', 'screenshots', 'review');

// [name, what to do before the shot]. Each runs from a freshly-returned HOME,
// so one failure cannot cascade into the next.
const SHOTS = [
    ['home', () => {}],
    ['armory', () => document.getElementById('btn-home-armory').click()],
    ['tutorial', () => document.getElementById('btn-open-tutorial').click()],
    ['settings', () => document.getElementById('btn-open-settings').click()],
    ['audio', () => {
        document.getElementById('btn-open-settings').click();
        document.getElementById('btn-open-audio').click();
    }],
    ['rebind', () => {
        document.getElementById('btn-open-settings').click();
        document.getElementById('btn-open-rebind').click();
    }],
    ['account', () => {
        document.getElementById('btn-open-settings').click();
        const a = document.getElementById('btn-account');
        if (a) a.click();
    }],
    ['lobby', () => document.getElementById('btn-home-play').click()],
];

// RELOAD, rather than navigating back. showScreen and closeAllModals are not
// on ACDebug, so a "go home" built from them would quietly do nothing and
// every shot after the first would photograph the previous screen. A reload
// cannot half-work.
async function home(page) {
    await page.reload({ waitUntil: 'load' });
    await H.sleep(900);
    await page.evaluate(() => {
        const c = document.querySelector('#btn-tutorial-close');
        if (c) c.click();
        window.ACDebug.setDebugUnlockAll(true);
    }).catch(() => {});
    await H.sleep(200);
}

(async () => {
    const local = process.argv.includes('--local');
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await H.launch();
    await H.startServer();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1400, height: 1000 });
    await H.boot(page, { clearStorage: true, path: local ? '/local/index.html' : null });
    await page.evaluate(() => window.ACDebug.setDebugUnlockAll(true));

    const tag = local ? 'local' : 'online';
    const taken = [];
    for (const [name, open] of SHOTS) {
        await home(page);
        const ok = await page.evaluate((src) => {
            try { new Function('return (' + src + ')')()(); return true; }
            catch (e) { return String(e.message); }
        }, open.toString());
        if (ok !== true) { console.log('  SKIP ' + name + ': ' + ok); continue; }
        await H.sleep(600);
        const file = path.join(OUT, tag + '-' + name + '.png');
        await page.screenshot({ path: file });
        taken.push(name);
    }

    // ---- the select screen, with a fighter previewed (#45, #50, #34) ----
    await home(page);
    await page.evaluate(() => {
        const b = document.getElementById('btn-home-play');
        if (b) b.click();
    });
    await H.sleep(400);
    const reached = await page.evaluate(() => {
        const D = window.ACDebug;
        D.previewPick('p1', 'Kaelen');
        return D.gameState;
    }).catch((e) => 'threw: ' + e.message);
    await H.sleep(700);
    await page.screenshot({ path: path.join(OUT, tag + '-select-preview.png') });
    taken.push('select-preview (state ' + reached + ')');

    // ---- a real fight, for the HUD (#78, #89, #90) ----------------------
    const fought = await page.evaluate(() => {
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
        return true;
    }).catch((e) => String(e.message));
    if (fought === true
        && await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 60000)) {
        // Damage both sides so the bars, the pips and the low-HP flash all
        // have something to show.
        await page.evaluate(() => {
            const D = window.ACDebug;
            D.player1.hp = D.player1.maxHp * 0.18;
            D.player2.hp = D.player2.maxHp * 0.55;
            D.player1.specialMeter = 40;
        });
        await H.sleep(1200);
        await page.screenshot({ path: path.join(OUT, tag + '-hud-fight.png') });
        taken.push('hud-fight');

        await page.evaluate(() => window.ACDebug.togglePause && window.ACDebug.togglePause());
        await H.sleep(600);
        await page.screenshot({ path: path.join(OUT, tag + '-pause.png') });
        taken.push('pause');
    } else {
        console.log('  SKIP hud-fight/pause: never reached FIGHT (' + fought + ')');
    }

    console.log('');
    console.log(tag + ': ' + taken.length + ' shots in tests/screenshots/review/');
    for (const t of taken) console.log('   ' + t);
    await browser.close();
    process.exit(0);
})();
