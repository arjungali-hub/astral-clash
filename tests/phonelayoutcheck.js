// The menus on a phone: both ways up, in English and in French.
//
//     node tests/phonelayoutcheck.js
//
// WHY THIS FILE EXISTS. The online build plays on phones, and until the menu
// redesign nothing asked what its menus looked like on one - touchfpscheck is
// about the pads during a fight, and every layout checker runs at desktop
// sizes or at a narrow DESKTOP window, which is not the same thing: a phone on
// its side is 844 wide and 390 tall, a shape no desktop window has.
//
// Home is laid out three ways now (see HOME in the design layer): two columns
// on a desktop, a compressed two columns on a phone on its side, one column
// on a phone held upright. Each is a media query somebody wrote by looking at
// one screenshot, and this is what looks at them afterwards.
//
// WHAT IT ASSERTS is what a thumb needs, not what a designer wanted:
//
//   * nothing is wider than the screen;
//   * Play is on the screen without scrolling, and big enough to hit;
//   * every control that is visible is at least 40px in its smaller direction
//     and not cut off by the side of the frame;
//   * no button's label is clipped by its own box;
//   * the fighter's slot - the box the menu stage aims at - exists, is a
//     sensible size, and is not underneath Play.
//
// FRENCH TOO, because it is the long one. "How to Play" is "Comment jouer" and
// the three-button row is where a longer word wraps first; `sizeprobe --fr`
// exists for the same reason.
const H = require('./harness');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SHAPES = [
    ['on its side', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }],
    ['upright', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];
const MIN_TARGET = 40;

function measureHome() {
    const vis = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const box = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const frame = document.getElementById('game-container').getBoundingClientRect();
    const home = document.getElementById('home-screen');
    const controls = [...home.querySelectorAll('button, input, select, a[href]')].filter(vis);
    const small = [], cut = [], clipped = [];
    for (const el of controls) {
        const r = el.getBoundingClientRect();
        const name = el.id || el.className || el.tagName;
        if (Math.min(r.width, r.height) < 40) small.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        if (r.left < frame.left - 1 || r.right > frame.right + 1) cut.push(name);
        // A label wider than the box it is in: scrollWidth past clientWidth on
        // a button means the text is either clipped or has pushed out of it.
        if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) {
            clipped.push(name + ' needs ' + el.scrollWidth + ' has ' + el.clientWidth);
        }
    }
    const play = document.getElementById('btn-home-play');
    const slot = document.getElementById('home-slot');
    const p = box(play), s = slot ? box(slot) : null;
    const overlap = s && !(s.x + s.w <= p.x || p.x + p.w <= s.x || s.y + s.h <= p.y || p.y + p.h <= s.y);
    return {
        pageWider: document.documentElement.scrollWidth > window.innerWidth + 1,
        overlayWider: (() => { const o = document.getElementById('ui-overlay'); return o.scrollWidth > o.clientWidth + 1; })(),
        frame: { y: Math.round(frame.top), bottom: Math.round(frame.bottom) },
        play: p, slot: s, slotUnderPlay: !!overlap,
        controls: controls.length, small, cut, clipped,
        lang: document.documentElement.lang,
    };
}

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    let last = null;

    for (const lang of ['en', 'fr']) {
        for (const [label, viewport] of SHAPES) {
            section('Home, ' + label + (lang === 'en' ? '' : ', in French'));
            const page = await H.newPage(browser);
            await page.emulate({ userAgent: UA, viewport });
            await H.boot(page, { clearStorage: true });
            if (lang !== 'en') {
                // The game's own switch: it stores the choice and reloads,
                // because English cannot be put back once it is replaced.
                await page.evaluate((l) => localStorage.setItem('astralClashLang', l), lang);
                await H.boot(page);
            }
            await H.sleep(700);
            const m = await page.evaluate(measureHome);
            if (lang !== 'en') check('the page is in ' + lang, m.lang === lang, m.lang);
            check('nothing is wider than the screen', !m.pageWider && !m.overlayWider,
                'page ' + m.pageWider + ', overlay ' + m.overlayWider);
            check('Play is on screen without scrolling',
                m.play.y >= m.frame.y - 1 && m.play.y + m.play.h <= m.frame.bottom + 1,
                'Play ' + m.play.y + '..' + (m.play.y + m.play.h) + ', frame ' + m.frame.y + '..' + m.frame.bottom);
            check('Play is a real target', m.play.h >= 48 && m.play.w >= 200, m.play.w + 'x' + m.play.h);
            check('every visible control is at least ' + MIN_TARGET + 'px', m.small.length === 0,
                m.small.join('; '));
            check('none is cut off by the side of the frame', m.cut.length === 0, m.cut.join('; '));
            check('no button label is clipped', m.clipped.length === 0, m.clipped.join('; '));
            check('the fighter has a slot to stand in', !!m.slot && m.slot.w >= 110 && m.slot.h >= 150,
                JSON.stringify(m.slot));
            check('and it is not underneath Play', !m.slotUnderPlay,
                'slot ' + JSON.stringify(m.slot) + ', Play ' + JSON.stringify(m.play));
            check('logged no errors', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 2)));
            if (last) await last.close();
            last = page;
        }
    }
    await finish(browser, last);
})();
