// Spanish and French actually reach the screen, and no key is dead.
//
// WHAT CAN GO WRONG HERE. Keying on the English source string buys a lot - no
// markup edits, free fallback - and costs one thing: a key is only correct if
// it matches the source byte for byte. Get a character wrong and the entry is
// not an error, it is INVISIBLE. The string stays English, nothing throws, and
// the only way to find out is to read the screen in a language you may not
// speak. That is the failure this file exists to catch.
//
// So the central assertion is not "does Spanish appear" - it is "does EVERY
// entry in both tables match something real". A key that matches nothing is a
// translation somebody wrote that will never be seen.
//
// Runs on this machine: no fight, no models, just the menus.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    await H.startServer();
    const { check, section, finish } = H.makeChecker();
    const page = await H.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));

    await H.boot(page, { clearStorage: true });

    section('The tables are present and both languages are filled in:');
    const cov = await page.evaluate(() => ({
        langs: window.ACDebug.AC_LANGS.map(l => l.id),
        es: window.ACDebug.langCoverage('es'),
        fr: window.ACDebug.langCoverage('fr'),
    }));
    check('en, es and fr are offered',
        JSON.stringify(cov.langs) === JSON.stringify(['en', 'es', 'fr']),
        JSON.stringify(cov.langs));
    check('Spanish has a real table, not a stub',
        cov.es.strings > 80 && cov.es.blocks >= 14, JSON.stringify(cov.es));
    check('French has the same coverage as Spanish',
        cov.fr.strings === cov.es.strings && cov.fr.blocks === cov.es.blocks,
        JSON.stringify({ es: cov.es, fr: cov.fr }));

    section('Every PROSE key matches a real element - a mistyped one is silent:');
    // The brittle half. These keys are long, and they are the browser's own
    // textContent with whitespace collapsed, which is not what the source file
    // looks like. Each one has to be found.
    const prose = await page.evaluate(() => {
        const D = window.ACDebug;
        const present = new Set();
        for (const el of document.querySelectorAll('p, li, .tutorial-controls-row')) {
            present.add(D.proseKey(el.textContent));
        }
        const dead = {};
        for (const lang of ['es', 'fr']) {
            dead[lang] = Object.keys(D.I18N_HTML[lang]).filter(k => !present.has(k));
        }
        return dead;
    });
    check('no dead Spanish prose key', prose.es.length === 0,
        prose.es.map(k => k.slice(0, 60) + '...').join(' | ') || 'none');
    check('no dead French prose key', prose.fr.length === 0,
        prose.fr.map(k => k.slice(0, 60) + '...').join(' | ') || 'none');

    section('Spanish reaches the screen:');
    const es = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setLangForTest('es');
        D.localiseDOM();
        const txt = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : null;
        };
        return {
            online: txt('#btn-home-play'),
            // A heading inside the tutorial, from the text-node tier.
            heading: [...document.querySelectorAll('#tutorial-screen h4')]
                .map(h => h.textContent.trim()),
            // A prose block, from the whole-block tier. Its <b> must survive -
            // the translation supplies HTML, so emphasis is part of the value.
            objective: (() => {
                const p = [...document.querySelectorAll('#tutorial-screen p')]
                    .find(x => /manos|rondas|rival/.test(x.textContent));
                return p ? { text: p.textContent.trim().slice(0, 40), html: p.innerHTML } : null;
            })(),
            emphasised: !!document.querySelector('#tutorial-screen p b'),
            placeholder: (document.querySelector('[placeholder]') || {}).placeholder,
        };
    });
    check('a button label is Spanish', es.online && /línea/.test(es.online),
        String(es.online));
    check('tutorial headings are Spanish', es.heading.includes('Objetivo'),
        es.heading.slice(0, 5).join(', '));
    check('a prose block is Spanish, not a fragment salad',
        es.objective && /rondas/.test(es.objective.text), JSON.stringify(es.objective));
    check('prose keeps its <b> emphasis', es.emphasised === true, String(es.emphasised));

    section('Running it twice changes nothing - the pass must be idempotent:');
    // It is idempotent by construction: translated text no longer matches an
    // English key. Asserted because that property is the whole reason it is
    // safe to call from the frame loop.
    const twice = await page.evaluate(() => {
        const before = document.body.innerHTML;
        window.ACDebug.localiseDOM();
        window.ACDebug.localiseDOM();
        return document.body.innerHTML === before;
    });
    check('a second and third pass are no-ops', twice === true, String(twice));

    section('French, on a fresh page:');
    const page2 = await H.newPage(browser);
    page2.on('pageerror', e => errors.push('fr: ' + String(e.message || e)));
    await H.boot(page2, { clearStorage: true });
    const fr = await page2.evaluate(() => {
        const D = window.ACDebug;
        D.setLangForTest('fr');
        D.localiseDOM();
        const el = document.querySelector('#btn-home-play');
        return {
            online: el ? el.textContent.trim() : null,
            heading: [...document.querySelectorAll('#tutorial-screen h4')]
                .map(h => h.textContent.trim()),
        };
    });
    check('a button label is French', fr.online && /ligne/.test(fr.online),
        String(fr.online));
    check('tutorial headings are French', fr.heading.includes('Objectif'),
        fr.heading.slice(0, 5).join(', '));

    section('Unknown strings and English pass through untouched:');
    const fallback = await page.evaluate(() => {
        const D = window.ACDebug;
        D.setLangForTest('es');
        const unknown = D.t('A string nobody has translated yet');
        const spaced = D.t('  Start Match  ');
        D.setLangForTest('en');
        const english = D.t('Start Match');
        return { unknown, spaced, english };
    });
    check('an untranslated string comes back as English',
        fallback.unknown === 'A string nobody has translated yet', fallback.unknown);
    check('leading and trailing space is layout and is kept',
        fallback.spaced === '  Empezar combate  ', JSON.stringify(fallback.spaced));
    check('English is a pass-through, not a lookup',
        fallback.english === 'Start Match', fallback.english);

    section('The Language row exists in BOTH builds:');
    // The point of the whole sync apparatus. The row was added to the online
    // build only; it reached the local build because SHARED_MODULES made the
    // porter able to see that shared/i18n.js wants #btn-lang.
    const local = await H.newPage(browser);
    local.on('pageerror', e => errors.push('local: ' + String(e.message || e)));
    await H.boot(local, { clearStorage: true, path: '/local/index.html' });
    const bothRows = await Promise.all([page, local].map(p => p.evaluate(() => {
        const b = document.getElementById('btn-lang');
        return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
    })));
    check('online has a Language row', bothRows[0] !== null, String(bothRows[0]));
    check('local has the same Language row', bothRows[1] !== null, String(bothRows[1]));

    check('no errors thrown', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await finish(browser, page);
})();
