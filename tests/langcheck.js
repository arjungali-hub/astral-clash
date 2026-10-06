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
    // BOTH BUILDS. The tables cover the split-screen game too - its tutorial
    // and settings prose is different text on a page this one never shows - so
    // checking only the online page reported every local-only block as dead.
    // A key is dead when NEITHER build has it.
    const proseIn = (pg) => pg.evaluate(() => {
        // window.proseKey, not ACDebug.proseKey: a top-level function in a
        // shared module is a global in BOTH builds, whereas each build's
        // ACDebug lists only what that build chose to export - and the local
        // one never listed the i18n helpers.
        const present = [];
        for (const el of document.querySelectorAll('p, li, .tutorial-controls-row')) {
            present.push(window.proseKey(el.textContent));
        }
        return present;
    });
    const localForProse = await H.newPage(browser);
    await H.boot(localForProse, { clearStorage: true, path: '/local/index.html' });
    const present = new Set([...(await proseIn(page)), ...(await proseIn(localForProse))]);
    await localForProse.close();
    const prose = await page.evaluate((have) => {
        const D = window.ACDebug;
        const set = new Set(have);
        const dead = {};
        for (const lang of ['es', 'fr']) {
            dead[lang] = Object.keys(D.I18N_HTML[lang]).filter(k => !set.has(k));
        }
        return dead;
    }, [...present]);
    check('no dead Spanish prose key', prose.es.length === 0,
        prose.es.map(k => k.slice(0, 60) + '...').join(' | ') || 'none');
    check('no dead French prose key', prose.fr.length === 0,
        prose.fr.map(k => k.slice(0, 60) + '...').join(' | ') || 'none');

    section('Every FLAT key matches something too - the gap that cost eight:');
    // The prose check above covers I18N_HTML. This covers I18N, and it exists
    // because eight entries were written with a curly apostrophe where the
    // source has a straight one - "Host's choice" against "Host’s choice".
    // They could never match at runtime, nothing threw, and the strings simply
    // stayed English. Exactly the failure the file header warns about, in the
    // half that was not being checked.
    //
    // Keys are compared against every text node and translatable attribute the
    // page actually holds, so a key that matches nothing is named.
    const deadFlat = await page.evaluate(() => {
        const D = window.ACDebug;
        const present = new Set();
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walk.nextNode())) {
            const t = n.nodeValue.trim();
            if (t) present.add(t);
        }
        for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
            for (const a of ['placeholder', 'title', 'aria-label']) {
                const v = el.getAttribute(a);
                if (v && v.trim()) present.add(v.trim());
            }
        }
        // Strings the game builds at runtime rather than ships in markup - HUD
        // words, toasts, roster prose - are legitimately absent from a menu
        // page, so only keys that LOOK like markup are judged here: anything
        // also present in the English table for another screen would be a false
        // alarm, and a check that cries wolf is one nobody reads.
        const out = {};
        for (const lang of ['es', 'fr']) {
            out[lang] = Object.keys(D.I18N[lang]).filter((k) => {
                if (present.has(k)) return false;
                // Apostrophe style is the specific trap: a key that matches
                // once the quote is swapped is dead, and provably so.
                const swapped = k.replace(/'/g, '’');
                const unswapped = k.replace(/’/g, "'");
                return present.has(swapped) || present.has(unswapped);
            });
        }
        return out;
    });
    check('no Spanish key is dead on an apostrophe', deadFlat.es.length === 0,
        deadFlat.es.join(' | ') || 'none');
    check('no French key is dead on an apostrophe', deadFlat.fr.length === 0,
        deadFlat.fr.join(' | ') || 'none');

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
    check('a button label is Spanish', es.online && /Jugar/.test(es.online),
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
    check('a button label is French', fr.online && /Jouer/.test(fr.online),
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
    // A <select> now, not a cycle button: three languages is already too many to
    // reach by pressing until the one you want comes round, and a cycle never
    // shows what the choices are. The porters add and remove elements but
    // cannot CONVERT one, so the local build kept a button with a dead listener
    // until the sync was taught to replace it - which is what the second half
    // of this is really checking.
    const bothRows = await Promise.all([page, local].map(p => p.evaluate(() => {
        const sel = document.getElementById('sel-lang');
        if (!sel) return null;
        return {
            options: [...sel.options].map(o => o.value),
            value: sel.value,
            labelled: !!document.querySelector('label[for="sel-lang"]'),
        };
    })));
    for (const [i, name] of [[0, 'online'], [1, 'local']]) {
        const r = bothRows[i];
        check(name + ' has a language dropdown', r !== null, JSON.stringify(r));
        check(name + ' offers every language, not just the next one',
            !!r && JSON.stringify(r.options) === JSON.stringify(['en', 'es', 'fr']),
            JSON.stringify(r && r.options));
        check(name + ' has it labelled for a screen reader',
            !!r && r.labelled, JSON.stringify(r && r.labelled));
    }

    check('no errors thrown', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
    await finish(browser, page);
})();
