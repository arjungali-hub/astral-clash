// THE TWO BUILDS ARE ONE GAME, asserted rather than hoped for.
//
// Every round of review has found the same class of bug: a fix applied to the
// online build, or applied directly to the GENERATED local build, that the
// other one never got. Three examples in one review - "the local build uses
// Arial almost everywhere", "the pause menu has no Settings, in either build"
// (it had one online), and a boss with two different names.
//
// These are the things that must not differ. Anything that legitimately does -
// split screen, two keyboards, the local-only spectator view - is not asserted
// here.
const H = require('./harness');
const LOCAL = '/local/index.html';

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    await page.setViewport({ width: 1280, height: 530 });

    const survey = async (path) => {
        await H.boot(page, { clearStorage: true, path });
        await H.boot(page, { path });
        return page.evaluate(() => {
            const D = window.ACDebug;
            const fonts = {};
            for (const e of document.querySelectorAll('button, input, select, h1, h2, h3, p, span, label')) {
                if (e.offsetParent === null) continue;
                const fam = getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '');
                fonts[fam] = (fonts[fam] || 0) + 1;
            }
            // VISIBLE LABELS, not the whole document: innerHTML carries the
            // inline script, and the code's own comments talk about the shop
            // panel constantly. What matters is what a player is shown.
            const labels = Array.from(document.querySelectorAll(
                '#shop-title, #shop-title-p1, #shop-title-p2, [data-shop-side],'
                + ' #btn-home-armory, #btn-my-shop'))
                .map(e => (e.textContent || '').trim()).filter(Boolean);
            return {
                fonts,
                // Every mode's name and blurb, which carry the boss's name and
                // the description of Survival Waves.
                modes: (D.MATCH_MODES || []).map(m => m.id + '|' + m.name + '|' + m.blurb),
                // Controls belong at the top of How to Play, in both.
                firstCard: (document.querySelector('.tutorial-card h4') || {}).textContent || null,
                pauseButtons: Array.from(document.querySelectorAll('#pause-screen button'))
                    .map(b => b.id),
                // One word for the store.
                labels,
                saysShop: labels.some(t => /\bShop\b/.test(t)),
                saysArmory: labels.some(t => /\bArmory\b/.test(t)),
                // The roster and its prices come from shared/roster.js.
                roster: (D.CHARACTERS || []).map(c => c.name + '|' + c.title).join(','),
            };
        });
    };

    const online = await survey(null);
    const local = await survey(LOCAL);

    section('Both builds use the game’s own type:');
    for (const [tag, m] of [['online', online], ['local', local]]) {
        const arial = Object.keys(m.fonts).filter(f => !/^Astral/.test(f));
        check(`${tag}: no control falls back to a system font`,
            arial.length === 0, JSON.stringify(m.fonts));
    }

    section('The same things are called the same things:');
    check('the mode list is identical, blurbs included',
        online.modes.join('\n') === local.modes.join('\n'),
        JSON.stringify({ online: online.modes, local: local.modes }));
    check('the roster and its titles are identical (they come from shared/roster.js)',
        online.roster === local.roster,
        JSON.stringify({ online: online.roster.slice(0, 120), local: local.roster.slice(0, 120) }));
    check('neither build calls the store a "Shop"',
        online.saysShop === false && local.saysShop === false,
        JSON.stringify({ online: online.labels, local: local.labels }));
    check('and both call it the Armory',
        online.saysArmory === true && local.saysArmory === true,
        JSON.stringify({ online: online.saysArmory, local: local.saysArmory }));

    section('The same things are in the same places:');
    check('How to Play opens on Controls in both',
        online.firstCard === 'Controls' && local.firstCard === 'Controls',
        JSON.stringify({ online: online.firstCard, local: local.firstCard }));
    check('the pause menu offers Settings in both',
        online.pauseButtons.includes('btn-pause-settings')
        && local.pauseButtons.includes('btn-pause-settings'),
        JSON.stringify({ online: online.pauseButtons, local: local.pauseButtons }));

    await finish(browser, page);
})();
