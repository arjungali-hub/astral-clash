// Batch 24 checker: per-side stores, pre-purchase descriptions, the split
// main-attack/special damage readout, and the longer dash cooldown.
//
// The load-bearing assertion here is "displayed damage == dealt damage". Batch
// 24's whole reason for moving special damage into character data was that the
// UI now prints it, and a literal in doSpecial plus a number in the shop would
// have been two copies free to drift. So this drives REAL specials through the
// real doSpecial and compares the HP it actually removes against the number the
// detail panel actually renders.
const H = require('./harness');

(async () => {
    const browser = await H.launch();
    const page = await H.newPage(browser);
    const { check, section, finish } = H.makeChecker();

    await H.boot(page, { clearStorage: true });

    // ---------------------------------------------------------------- data
    section('Character data completeness:');
    const data = await page.evaluate(() => {
        const D = window.ACDebug;
        const all = [...D.CHARACTERS, ...Object.values(D.BOSS_MAP)];
        return {
            missingAtk: D.CHARACTERS.filter(c => !c.atkName || !c.atkDesc).map(c => c.name),
            // A special whose damage is a data field must HAVE that field.
            // `titan` scales off attackDmg and `ward` deals none, so they're
            // the two legitimate exemptions — everything else routes through
            // specialHitDmg() and would silently deal 0 without it.
            missingDmg: all.filter(c => !['titan', 'ward'].includes(c.special)
                                        && typeof c.specialDmg !== 'number').map(c => c.name),
            minions: D.SURVIVAL_MINIONS.map(n => ({ name: n, dmg: D.BOSS_MAP[n].specialDmg })),
            descLens: D.CHARACTERS.map(c => c.desc.length),
        };
    });
    check('every character documents its main attack', data.missingAtk.length === 0, data.missingAtk.join(','));
    check('every damaging special has a specialDmg', data.missingDmg.length === 0, data.missingDmg.join(','));
    check('descriptions are substantive (all > 120 chars)',
        Math.min(...data.descLens) > 120, 'shortest=' + Math.min(...data.descLens));
    // The bug the refactor exposed: these three share doSpecial cases with
    // roster fighters and used to inherit the roster's damage wholesale, so
    // Grint's Skitter hit for Kaelen's 90 on a 130 HP body.
    check('Survival minions hit far softer than the roster they borrow from',
        data.minions.every(m => m.dmg > 0 && m.dmg <= 40), JSON.stringify(data.minions));

    // ------------------------------------------------- displayed == dealt
    section('Displayed special damage matches what doSpecial deals:');
    const dmg = await page.evaluate(() => {
        const D = window.ACDebug;
        const out = [];
        for (const c of D.CHARACTERS) {
            // Two standalone fighters, no meshes: doSpecial is pure state
            // manipulation, and skipping initMesh keeps this a fast unit check
            // rather than ten full match boots.
            const a = new D.Fighter(c.name, 400, 400, true, false);
            const t = new D.Fighter('Draven', 430, 400, false, false); // big HP pool, won't die mid-test
            a.fx = 1; a.fy = 0;                                        // face the target
            a.specialMeter = 100;
            const before = t.hp;
            a.doSpecial(t);
            out.push({
                name: c.name,
                kind: c.specialKind || 'damage',
                shown: D.specialDamageText(c),
                shownValue: D.specialDamageValue(c),
                declared: c.specialDmg,
                hits: c.specialHits || 1,
                dot: c.specialDot || 0,
                dealt: before - t.hp,
                projectiles: a.projectiles.map(p => p.damage),
                shieldFrames: a.shieldFrames || 0,
                burn: { frames: t.burnFrames || 0, dps: t.burnDps || 0 },
            });
        }
        return out;
    });

    for (const r of dmg) {
        if (r.kind === 'shield') {
            // Seraphine is the one special that deals nothing at all.
            check(`${r.name}: shield special deals no damage and raises a ward`,
                r.dealt === 0 && r.shieldFrames > 0 && r.shown === 'Shield', JSON.stringify(r));
        } else if (r.projectiles.length > 0) {
            // A volley does its damage through projectiles, not on cast.
            check(`${r.name}: every shard carries the displayed per-hit damage`,
                r.projectiles.length === r.hits && r.projectiles.every(d => d === r.declared),
                `hits=${r.hits} shown="${r.shown}" projectiles=${JSON.stringify(r.projectiles)}`);
        } else {
            check(`${r.name}: hit removes exactly the displayed per-hit damage`,
                Math.round(r.dealt) === r.declared,
                `shown="${r.shown}" declared=${r.declared} dealt=${r.dealt}`);
        }
        if (r.dot) {
            // The burn is folded into the displayed total, so the displayed
            // total is only honest if the burn really delivers it.
            const burnTotal = Math.round((r.burn.frames / 60) * r.burn.dps);
            check(`${r.name}: burn actually delivers the ${r.dot} it advertises`,
                burnTotal === r.dot, `burn=${JSON.stringify(r.burn)} -> ${burnTotal}, advertised ${r.dot}`);
        }
        // The bar's numeric total must never exceed the axis it's drawn against,
        // or the fill silently clips at 100% and stops being comparable.
        check(`${r.name}: special total fits the stat axis`,
            r.shownValue <= 120, `${r.shownValue} vs STAT_MAX.special`);
    }

    // ------------------------------------------------------ detail panel
    section('Detail panel shows attack and special separately:');
    const panel = await page.evaluate(() => {
        const D = window.ACDebug;
        const html = D.characterInfoHTML('p1', D.CHAR_MAP['Ignis']);
        const rows = [...html.matchAll(/<div class="stat-row"><span>([^<]+)<\/span>/g)].map(m => m[1]);
        const vals = [...html.matchAll(/class="stat-val">([^<]*)</g)].map(m => m[1]);
        return { rows, vals, hasAtkBlock: html.includes('Main Attack &mdash; Ember Jab'),
                 hasSpecialBlock: html.includes('Special &mdash; Inferno Burst'),
                 hasAtkDesc: html.includes('rapid flurry jab'),
                 seraphine: D.characterInfoHTML('p1', D.CHAR_MAP['Seraphine']) };
    });
    check('one bar per stat, attack and special split apart',
        JSON.stringify(panel.rows) === JSON.stringify(['Health', 'Main Attack', 'Special', 'Speed']),
        JSON.stringify(panel.rows));
    check('no single combined "Damage" row survives', !panel.rows.includes('Damage'), JSON.stringify(panel.rows));
    check('the main attack gets its own named write-up', panel.hasAtkBlock && panel.hasAtkDesc);
    check('the special keeps its own write-up', panel.hasSpecialBlock);
    // Ignis' special total is 45 + 66 burn, and the row must say so rather than
    // printing the raw 45 the switch case passes to takeDamage.
    check('a damage-over-time special prints its full total', panel.vals.some(v => v.startsWith('111')),
        JSON.stringify(panel.vals));
    check("Seraphine's special row reads Shield, not 0",
        /class="stat-val">Shield</.test(panel.seraphine));

    // ------------------------------------------------------------- dash
    section('Dash cooldown:');
    const dash = await page.evaluate(() => {
        const D = window.ACDebug;
        const f = new D.Fighter('Kaelen', 400, 400, true, false);
        f.tryDodge(1, 0);
        const afterFirst = f.dodgeCooldown;
        const iframes = f.invulnFrames;
        f.dodgeCooldown = 1;              // one frame short of ready
        f.invulnFrames = 0;
        f.tryDodge(1, 0);
        const refused = f.invulnFrames === 0;
        f.dodgeCooldown = 0;              // ready again
        f.tryDodge(1, 0);
        const allowed = f.invulnFrames > 0;
        return { cd: D.DODGE_COOLDOWN, afterFirst, iframes, refused, allowed };
    });
    check('cooldown is the longer 90 frames (1.5s)', dash.cd === 90, String(dash.cd));
    check('a dash arms the full cooldown', dash.afterFirst === 90, String(dash.afterFirst));
    check('i-frame window is unchanged, so the dodge still feels the same', dash.iframes === 14, String(dash.iframes));
    check('a second dash before the cooldown expires is refused', dash.refused);
    check('a dash after it expires is allowed', dash.allowed);

    // ------------------------------------------------------------ stores
    section('Per-side stores:');
    const stores = await page.evaluate(() => {
        const q = s => document.querySelectorAll(s).length;
        return {
            footerShop: q('#btn-open-shop'),
            tabs: q('.shop-tab'),
            sideButtons: [...document.querySelectorAll('[data-shop-side]')].map(b => ({
                side: b.dataset.shopSide,
                inActions: !!b.closest('.side-actions'),
            })),
            purseButtons: q('.side-purse button'),
            homeArmory: q('#btn-home-armory'),
            roomArmory: q('#btn-my-shop'),
        };
    });
    check('the single shared footer Shop button is gone', stores.footerShop === 0);
    check('the player toggle tabs are gone', stores.tabs === 0);
    // Batch 34 SUPERSEDES the per-side pair originally asserted here. Batch 24
    // gave each of two local players their own Shop button in their own panel;
    // online there is one player at this keyboard and one account (see
    // prog/ACCOUNT), so there is one Armory - on the home screen, and again in
    // the room while you are picking. The two-button assertion was not a
    // regression when it failed, it described a screen that no longer exists.
    check('the per-side shop buttons are gone with the two-player screen',
        stores.sideButtons.length === 0, JSON.stringify(stores.sideButtons));
    check('there is a single Armory on home and one in the room',
        stores.homeArmory === 1 && stores.roomArmory === 1, JSON.stringify(stores));

    for (const role of ['host', 'joiner']) {
        const opened = await page.evaluate(r => {
            const D = window.ACDebug;
            D.goHome();
            D.netFakeConnect(r);
            document.getElementById('btn-my-shop').click();
            const screen = document.getElementById('shop-screen');
            return {
                localSide: D.LOCAL_SIDE,
                shopSide: D.shopSide,
                cls: screen.className,
                title: document.getElementById('shop-title').textContent,
                visible: screen.getClientRects().length > 0,
                justify: getComputedStyle(screen).justifyContent,
            };
        }, role);
        const side = role === 'host' ? 'p1' : 'p2';
        check(`${role}: the room's Armory opens the fighter slot you drive (${side})`,
            opened.localSide === side && opened.shopSide === side, JSON.stringify(opened));
        check(`${role}: the panel is anchored to that side of the screen`,
            opened.cls === `side-${side}` && opened.justify === (side === 'p1' ? 'flex-start' : 'flex-end'),
            JSON.stringify(opened));
        check(`${role}: the panel says whose shop it is`,
            opened.title.includes(side === 'p1' ? 'Player 1' : 'Player 2'), opened.title);
        await page.evaluate(() => document.getElementById('btn-shop-close').click());
    }

    // ------------------------------------------- pre-purchase description
    section('Reading a description before buying:');
    const details = await page.evaluate(() => {
        const D = window.ACDebug;
        // Batch 34: one account, opened as the local player.
        window.ACDebug.openShop(window.ACDebug.LOCAL_SIDE);
        const cards = [...document.querySelectorAll('#shop-list .shop-card')];
        // Pick a card for a character this side has NOT bought — the whole point
        // is deciding before you spend.
        const locked = cards.find(c => {
            const n = c.querySelector('.shop-name');
            return n && !D.isCharUnlocked('p1', n.textContent) && D.CHAR_MAP[n.textContent];
        });
        if (!locked) return { error: 'no locked character card found' };
        const name = locked.querySelector('.shop-name').textContent;
        const info = locked.querySelector('.shop-info');
        const collapsedBefore = !locked.querySelector('.shop-detail');
        info.click();
        // buildShop rebuilds the list, so re-find the card by name.
        const find = () => [...document.querySelectorAll('#shop-list .shop-card')]
            .find(c => c.querySelector('.shop-name') && c.querySelector('.shop-name').textContent === name);
        const card = find();
        const det = card.querySelector('.shop-detail');
        const c = D.CHAR_MAP[name];
        const shown = det ? det.textContent : '';
        // Buying an upgrade elsewhere rebuilds the list — the panel you're
        // reading must not snap shut underneath you.
        D.addCoins('p1', 5000);
        D.buyDoubleJump('p1');
        const survives = !!find().querySelector('.shop-detail');
        return {
            name, collapsedBefore,
            opened: !!det,
            hasAtkName: shown.includes(c.atkName),
            hasAtkDesc: shown.includes(c.atkDesc.slice(0, 40)),
            hasSpecial: shown.includes(c.specialName),
            hasStats: shown.includes('Main Attack') && shown.includes('Special'),
            stillLocked: !D.isCharUnlocked('p1', name),
            survives,
            label: find().querySelector('.shop-info').textContent,
        };
    });
    check('a locked card offers a Details view', !details.error && details.collapsedBefore && details.opened,
        JSON.stringify(details));
    check('it is genuinely pre-purchase (still locked while reading)', details.stillLocked === true);
    check('it names and describes the main attack', details.hasAtkName && details.hasAtkDesc, JSON.stringify(details));
    check('it covers the special too', details.hasSpecial);
    check('it carries the split damage rows', details.hasStats);
    check('it stays open across a rebuild triggered by a purchase', details.survives === true);
    check('the toggle flips its label to Hide', details.label === 'Hide', details.label);

    // The dmg upgrade multiplies attackDmg only and `special` buys meter rate,
    // so labels reading "Damage"/"Special" beside a split damage readout implied
    // a scaling that doesn't exist.
    section('Upgrade labels say what they actually buy:');
    const labels = await page.evaluate(() => {
        // Batch 34: one account, opened as the local player.
        window.ACDebug.openShop(window.ACDebug.LOCAL_SIDE);
        return [...document.querySelectorAll('#shop-list .upg-label')].map(e => e.textContent);
    });
    check('renamed to Attack / Charge', labels.includes('Attack') && labels.includes('Charge')
        && !labels.includes('Damage'), [...new Set(labels)].join(','));

    // ---------------------------------------------------------------- bots
    // Batch 24 made the bot toggle sandbox-only and hidden outside it. Batch 34
    // removed bots from this build entirely - the sandbox that was their only
    // door is gone, and online the opponent is always a person - so what is
    // asserted here is now their ABSENCE. The flags survive because the Fighter
    // constructor, the AI branch of update() and beginMatch all read them, and
    // the archived split-screen build still uses them.
    section('Bots are gone from the online build:');
    const bots = await page.evaluate(() => {
        const D = window.ACDebug;
        document.getElementById('btn-shop-close').click();
        return {
            toggles: document.querySelectorAll('.bot-toggle, #btn-toggle-bot, #btn-toggle-bot-p1').length,
            difficulty: !!document.getElementById('btn-difficulty'),
            sandbox: !!document.getElementById('chk-unlock-all'),
            botsOff: !D.p1IsBot && !D.p2IsBot,
        };
    });
    check('no bot toggles remain in the DOM', bots.toggles === 0, JSON.stringify(bots));
    check('no difficulty cycler and no sandbox switch',
        !bots.difficulty && !bots.sandbox, JSON.stringify(bots));
    check('both fighter slots are human', bots.botsOff, JSON.stringify(bots));

    await page.evaluate(() => localStorage.clear());
    await finish(browser, page);
})();
