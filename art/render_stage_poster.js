// The menu stage's POSTER: a photograph of the live stage, taken by the stage.
//
//   node art/render_stage_poster.js
//
// shared/menustage.js draws a small 3D scene behind Home. Not everybody gets
// it live - the poster tier (Save-Data, a lost WebGL context, `?stage=poster`,
// and every checker in tests/) shows a baked image instead, and every other
// tier shows that same image first, until there is a live frame to fade in
// over it.
//
// So the image has to be THE SAME SHOT, or the fade is a jump cut: a fighter
// who is two metres left of where the poster had him. That is why this does
// not build a scene of its own the way render_faces.js does. It boots the real
// game with `stage=still`, waits for the stage to draw, and asks the stage for
// its own pixels (menuStageSnapshot) - one camera, one set, one pose, written
// in one place.
//
// Run it again after changing anything in menuStageBuildSet or menuStagePose.
// Nothing checks that you did, and the symptom of forgetting is only that the
// first third of a second of Home looks slightly different from the rest.
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const OUT = path.join(__dirname, '..', 'assets', 'menu');
// THREE SHAPES, because the stage frames the shot by the frame's aspect - the
// fighter stands beside the menu on a wide frame and above it on a tall one -
// and one image cropped three ways matches the live shot in none of them. The
// first version shipped a single desktop poster; on a phone in landscape the
// fighter was 0.7 of his live size until the fade, and then was not.
//
//   stage-home        a desktop window: 1170 wide (the frame's cap) by 960
//   stage-home-wide   a phone on its side, at 2x so it is sharp on that screen
//   stage-home-tall   a phone upright, likewise
//
// The media queries that pick between them are beside the stage rules in the
// design layer and have to describe the same three shapes.
const VIEWS = [
    ['stage-home', { width: 1400, height: 1000 }],
    ['stage-home-wide', { width: 844, height: 390, deviceScaleFactor: 2 }],
    ['stage-home-tall', { width: 390, height: 844, deviceScaleFactor: 2 }],
];

(async () => {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    const browser = await H.launch();
    await H.startServer();
    let failed = 0;
    for (const [name, view] of VIEWS) {
        const page = await H.newPage(browser);
        await page.setViewport(view);
        await H.boot(page, { clearStorage: true, query: 'stage=still' });
        if (!await H.waitInPage(page, 'menuStageStats() && menuStageStats().drawn > 0', 120000)) {
            console.log(name + ': the stage never drew: '
                + JSON.stringify(await page.evaluate(() => menuStageStats())));
            failed++;
            await page.close();
            continue;
        }
        const shot = await page.evaluate(() => {
            const url = menuStageSnapshot('image/webp', 0.86);
            const c = document.getElementById('gameCanvas');
            return { url, w: c.width, h: c.height, stats: menuStageStats() };
        });
        if (!shot.url || !shot.url.startsWith('data:image/webp')) {
            console.log(name + ': no image came back: ' + JSON.stringify(shot.stats));
            failed++;
            await page.close();
            continue;
        }
        const buf = Buffer.from(shot.url.split(',')[1], 'base64');
        fs.writeFileSync(path.join(OUT, name + '.webp'), buf);
        console.log(('assets/menu/' + name + '.webp').padEnd(36) + shot.w + 'x' + shot.h + '  '
            + Math.round(buf.length / 1024) + ' KB  (' + shot.stats.fighter + ')');
        if (page.errors.length) console.log('   page errors: ' + JSON.stringify(page.errors.slice(0, 3)));
        await page.close();
    }
    await H.closeAllBrowsers();
    process.exit(failed ? 1 : 0);
})();
