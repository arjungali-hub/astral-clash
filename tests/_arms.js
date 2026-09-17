// The first-person arm for each character, photographed in a real match.
const H = require('./harness');
const fs = require('fs');
const path = require('path');
const OUT = process.env.SHOT_DIR || require('os').tmpdir();
const WHO = (process.env.WHO || 'Kaelen,Draven,Lyra').split(',');
const MAP = process.env.MAP || 'The Colosseum Ring';

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });
    await page.setViewport({ width: 1266, height: 522 });

    for (const who of WHO) {
        await H.boot(page);
        await page.evaluate((name) => {
            const D = window.ACDebug;
            D.setDebugUnlockAll(true);
            D.setMatchMode('classic');
            const pick = (grid, detail, n) => {
                const cards = Array.from(document.querySelectorAll(grid + ' .fighter-btn'));
                (cards.find(c => c.textContent.includes(n)) || cards[0]).click();
                document.querySelector(detail + ' .btn-confirm').click();
            };
            pick('#p1-grid', '#p1-detail', name);
            pick('#p2-grid', '#p2-detail', name === 'Lyra' ? 'Kaelen' : 'Lyra');
        }, who);
        await H.sleep(450);
        await page.evaluate((m) => {
            const cards = Array.from(document.querySelectorAll('#mapselect-grid .map-card'));
            (cards.find(c => c.textContent.includes(m)) || cards[0]).click();
        }, MAP);
        const live = await H.waitInPage(page, "window.ACDebug.gameState === 'FIGHT'", 70000);
        await H.sleep(1400);
        const vm = await page.evaluate(() => {
            const D = window.ACDebug, v = D.vmP1;
            if (!v) return { noVm: true };
            v.updateWorldMatrix(true, true);
            const arm = v.children.find(c => c.type === 'Group');
            const box = new THREE.Box3().setFromObject(v);
            const size = box.getSize(new THREE.Vector3());
            return { kids: v.children.length,
                     armScale: arm ? [arm.scale.x, arm.scale.y, arm.scale.z].map(n => +n.toFixed(2)) : null,
                     fromModel: !!v.userData.armFromModel,
                     size: [size.x, size.y, size.z].map(n => +n.toFixed(1)) };
        });
        const file = path.join(OUT, 'arm-' + who + '.png');
        fs.writeFileSync(file, await page.screenshot({ encoding: 'base64' }), 'base64');
        console.log(who, 'live=' + live, JSON.stringify(vm), '->', file);
    }
    await browser.close();
    process.exit(0);
})();
