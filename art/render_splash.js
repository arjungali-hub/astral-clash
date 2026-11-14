// Splash art for every fighter: the whole figure, and a bust, on NOTHING.
//
//   node art/render_splash.js              every fighter
//   node art/render_splash.js Kaelen Nyx   just these
//
// Writes assets/splash/<name>.webp (the figure, 768x1024) and
// assets/splash/<name>-bust.webp (head and shoulders, 320x320).
//
// WHY THIS IS NOT render_faces.js WITH A WIDER LENS. That script draws to the
// game's canvas and reads it back with toDataURL, and it sets the clear alpha
// to zero first so the portrait will sit on a coloured chip. It does not work:
// the renderer is created without `alpha: true`, so its drawing buffer HAS no
// alpha channel, and every portrait in assets/faces/ is a head on opaque
// black. Nobody noticed because the chips are 34px and dark.
//
// A fighter standing on a card cannot be on a black rectangle. So this renders
// into an RGBA render target - which has an alpha channel whatever the canvas
// was created with - and reads the pixels out of that.
//
// TWICE THE SIZE, THEN HALVED. A render target is not antialiased the way the
// canvas is, and a silhouette with stair-stepped edges is the first thing an
// eye finds on a cut-out. Drawing at 2x and letting a 2D canvas scale it down
// gives every edge pixel a real partial alpha.
//
// NO TONE MAPPING HAPPENS IN A RENDER TARGET in this version of three.js - it
// is applied only on the way to the screen - so the lights here are set for
// that and are not the menu stage's. The two are different pictures on
// purpose: this is a card, that is a place.
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, '..', 'tests', 'harness'));

const OUT = path.join(__dirname, '..', 'assets', 'splash');
const FIGURE = { w: 768, h: 1024 };
const BUST = { w: 320, h: 320 };

(async () => {
    const only = process.argv.slice(2);
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    const browser = await H.launch();
    await H.startServer();
    const page = await H.boot(await H.newPage(browser), { clearStorage: true });
    const roster = only.length ? only
        : await page.evaluate(() => Object.keys(window.ACDebug.CHAR_MODEL_URLS));
    let failed = 0, bytes = 0;

    for (const name of roster) {
        const out = await page.evaluate(async (n, FIG, BST) => {
            const D = window.ACDebug;
            if (!await D.ensureCharModel(n)) return { err: 'no model' };
            const g = D.buildRiggedCharacter(n);
            if (!g) return { err: 'no rig' };
            const rig = g.userData.rig;
            if (rig && rig.actions.Idle) { rig.actions.Idle.play(); rig.mixer.update(0.6); }
            // The weapon arm is posed by the game after the clip, not by the
            // clip - see menuStageDraw. Without this a scythe hangs straight
            // down and the figure is framed around a pole.
            animateWeapon({ name: n, mesh: g, atkState: 'idle', atkKind: null, atkStateTimer: 0 });
            const meta = (typeof CHAR_MAP !== 'undefined' && CHAR_MAP[n])
                || (typeof BOSS_MAP !== 'undefined' && BOSS_MAP[n]) || {};

            const scene = new THREE.Scene();
            scene.background = null;
            scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2030, 0.62));
            const key = new THREE.DirectionalLight(0xfff4e6, 1.25);
            key.position.set(-60, 85, 110);
            scene.add(key);
            // The rim is the fighter's own colour: it is what ties a grey
            // knight and a violet reaper to their tiles.
            const rim = new THREE.DirectionalLight(new THREE.Color(meta.color || '#00f3ff'), 1.9);
            rim.position.set(75, 40, -90);
            scene.add(rim);
            const holder = new THREE.Group();
            holder.add(g);
            // +X is a fighter's forward. Toward the camera, then a little off
            // it: a three-quarter view shows the weapon and the silhouette.
            holder.rotation.y = -Math.PI / 2 - 0.42;
            scene.add(holder);
            holder.updateMatrixWorld(true);

            const box = new THREE.Box3().setFromObject(holder);
            // NOTHING BELOW THE GROUND. A weapon held at rest points along the
            // forearm, and a forearm at rest hangs down: Nyx's scythe runs a
            // body-length below her feet. In a fight the arena floor hides
            // that half and she is a figure with a staff planted beside her;
            // with no floor the first render was a small reaper on top of a
            // long pole, framed to fit the pole. So the frame ignores what is
            // under the feet, and a clipping plane (below) does what the floor
            // does.
            box.min.y = Math.max(box.min.y, 0);
            const size = box.getSize(new THREE.Vector3());
            const mid = box.getCenter(new THREE.Vector3());
            let head = null;
            g.traverse(o => { if (!head && o.isBone && /^Head/.test(o.name || '')) head = o; });
            const headAt = new THREE.Vector3();
            if (head) { head.updateWorldMatrix(true, false); headAt.setFromMatrixPosition(head.matrixWorld); }
            else headAt.set(mid.x, box.max.y - size.y * 0.1, mid.z);

            const R = D.renderer;
            const shoot = (w, h, aim, span, lift) => {
                const cam = new THREE.PerspectiveCamera(22, w / h, 1, 4000);
                // Far enough back that `span` world units fill the frame's
                // height (or its width, whichever is the tighter fit).
                const need = Math.max(span.y, span.x / cam.aspect);
                const dist = need / (2 * Math.tan(cam.fov * Math.PI / 360));
                cam.position.set(aim.x, aim.y + lift, aim.z + dist);
                cam.lookAt(aim);
                const S = 2;
                const rt = new THREE.WebGLRenderTarget(w * S, h * S, {
                    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding });
                const prevTarget = R.getRenderTarget();
                const prevAlpha = R.getClearAlpha();
                const prevColor = R.getClearColor(new THREE.Color());
                R.setRenderTarget(rt);
                R.setClearColor(0x000000, 0);
                R.clear(true, true, true);
                const prevPlanes = R.clippingPlanes;
                R.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
                R.render(scene, cam);
                R.clippingPlanes = prevPlanes;
                const px = new Uint8Array(w * S * h * S * 4);
                R.readRenderTargetPixels(rt, 0, 0, w * S, h * S, px);
                R.setRenderTarget(prevTarget);
                R.setClearColor(prevColor, prevAlpha);
                rt.dispose();
                // GL's first row is the bottom one.
                const big = document.createElement('canvas');
                big.width = w * S; big.height = h * S;
                const bctx = big.getContext('2d');
                const img = bctx.createImageData(w * S, h * S);
                const row = w * S * 4;
                for (let y = 0; y < h * S; y++) {
                    img.data.set(px.subarray((h * S - 1 - y) * row, (h * S - y) * row), y * row);
                }
                bctx.putImageData(img, 0, 0);
                const small = document.createElement('canvas');
                small.width = w; small.height = h;
                const sctx = small.getContext('2d');
                sctx.imageSmoothingQuality = 'high';
                sctx.drawImage(big, 0, 0, w, h);
                // How much of the frame is figure: an empty or a full image
                // is a camera pointed at the wrong place.
                const a = sctx.getImageData(0, 0, w, h).data;
                let solid = 0;
                for (let i = 3; i < a.length; i += 4) if (a[i] > 128) solid++;
                return { url: small.toDataURL('image/webp', 0.9), cover: solid / (w * h) };
            };

            const figure = shoot(FIG.w, FIG.h,
                new THREE.Vector3(mid.x, mid.y, mid.z),
                { x: size.x * 1.12, y: size.y * 1.08 }, size.y * 0.04);
            // Head and shoulders - and on Gorgonok the shoulders are most of
            // the fighter, so the span is whichever is larger: a share of the
            // height, or a share of the width.
            const bustSpan = Math.max(size.y * 0.42, size.x * 0.74);
            const bust = shoot(BST.w, BST.h,
                new THREE.Vector3(headAt.x, headAt.y - bustSpan * 0.2, headAt.z),
                { x: bustSpan, y: bustSpan }, bustSpan * 0.06);

            const rigRef = g.userData.rig;
            if (rigRef && rigRef.mixer) { rigRef.mixer.stopAllAction(); rigRef.mixer.uncacheRoot(rigRef.mixer.getRoot()); }
            // The build's own disposer, through the one thing that was handed it:
            // ACDebug does not export it, and the menu stage was given it.
            if (typeof menuStage !== 'undefined' && menuStage) menuStage.X.disposeObject3D(g);
            return { figure, bust };
        }, name, FIGURE, BUST);

        if (!out || out.err) {
            failed++;
            console.log('  ' + name.padEnd(11) + 'FAILED: ' + (out ? out.err : 'nothing came back'));
            continue;
        }
        const line = [];
        for (const [kind, file] of [['figure', name.toLowerCase() + '.webp'], ['bust', name.toLowerCase() + '-bust.webp']]) {
            const shot = out[kind];
            const buf = Buffer.from(shot.url.split(',')[1], 'base64');
            fs.writeFileSync(path.join(OUT, file), buf);
            bytes += buf.length;
            // Under 4% of the frame is a camera pointed at nothing. A figure
            // over 85% is one cropped by its own frame; a bust may fill more,
            // being a crop on purpose, but not all of it.
            const odd = shot.cover < 0.04 || shot.cover > (kind === 'bust' ? 0.97 : 0.85);
            if (odd) failed++;
            line.push(kind + ' ' + Math.round(buf.length / 1024) + ' KB, ' + Math.round(shot.cover * 100)
                + '% of frame' + (odd ? '  <-- CHECK THIS' : ''));
        }
        console.log('  ' + name.padEnd(11) + line.join('   '));
    }
    console.log('\n' + roster.length + ' fighter(s), ' + Math.round(bytes / 1024) + ' KB in assets/splash/');
    console.log('page errors: ' + JSON.stringify(page.errors.slice(0, 4)));
    await H.closeAllBrowsers();
    process.exit(failed ? 1 : 0);
})();
