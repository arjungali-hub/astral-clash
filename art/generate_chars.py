# -*- coding: utf-8 -*-
"""Generate the roster's raw character meshes with Hyper3D Rodin.

    python art/generate_chars.py            # all pending characters
    python art/generate_chars.py Lyra Nyx   # just these

Writes art/raw/<Name>.glb plus art/raw/<Name>.preview.webp, and records job ids
in art/raw/manifest.json so an interrupted run resumes instead of re-spending
generations.

WHY THIS IS A SCRIPT AND NOT THE BLENDER MCP TOOL. The blender-mcp addon wraps
this same API (`create_rodin_job_main_site`), but going through Blender means
one character per round trip with a human-scale pause between each. Talking to
the API directly lets the whole roster be queued and polled unattended, which
matters at 13 characters. The Blender side is still needed afterwards - see
art/pipeline.py, which does the rig/bind/bake that turns a raw mesh into
something the game can animate.

CREDENTIALS: the key is the blender-mcp addon's shared free-trial key
(RODIN_FREE_TRIAL_KEY, literally "vibecoding"), read out of Blender's saved
preferences. It is a communal balance, not a personal account - which is why it
was briefly "out of funds" earlier and then worked again. Generation is free;
credits are spent on DOWNLOAD, so re-rolling a bad result costs nothing but a
poll loop.

DELIBERATELY NOT USED: `bbox_condition`. Passing one stretched a humanoid into a
cone - Rodin treats it as a hard target rather than a hint. Proportion is
controlled through the prompt instead, and final scale is set in-game by
RIG_HEIGHT_MULT.
"""
import io, json, os, sys, time
import urllib.request

KEY = os.environ.get('RODIN_API_KEY', 'vibecoding')
API = 'https://hyperhuman.deemos.com/api/v2'
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw')

# A shared preamble does the heavy lifting. Every clause is load-bearing:
#   "T-pose, arms out"      - art/pipeline.py's automatic weighting binds a
#                             skeleton to this mesh; limbs touching the torso
#                             weld together and bleed weights across the seam.
#   "symmetrical"           - the game mirrors nothing, but an asymmetric result
#                             reads as a modelling error at fighting-game scale.
#   "single character"      - otherwise Rodin happily returns a character on a
#                             decorative base, which then has to be cut off.
#   "no base, no pedestal"  - same, said twice because it ignores it once.
#   "full body, head to feet"- a bust is a common failure mode for a portrait-ish
#                             prompt, and pipeline.py's ground-and-measure step
#                             would happily scale a bust to full fighter height.
PREAMBLE = ('full body game character, head to feet, standing T-pose with arms '
            'straight out to the sides, symmetrical, single character, no base, '
            'no pedestal, no weapon in hands, clean silhouette, game asset')

# One line of art direction each, written from the roster's own titles and
# descriptions. Weapons are deliberately excluded: buildRiggedCharacter
# transplants the ORIGINAL procedural mesh's hand props onto the skeleton, so a
# generated weapon would be a second one clipping through the first.
CHARACTERS = {
    'Lyra':      'slender arcane sorceress in layered violet robes, crystalline glass shards floating at her shoulders, pale hair, glowing amethyst filigree',
    'Draven':    'heavy armoured knight warden in dark iron plate armour, closed visored helmet, broad pauldrons, steel greaves, weathered metal',
    # 'bare chest' tripped Rodin's content filter (IMAGE_CONTENT_VIOLATION),
    # so the same silhouette is described through clothing instead.
    'Ignis':     'muscular brawler monk in a sleeveless scorched tunic and wrapped forearms, glowing orange ember cracks along his arms, short dark hair, heavy cloth trousers, leather belt',
    'Nyx':       'gaunt hooded reaper in tattered charcoal robes, deep hood shadowing a pale skull-like face, ragged cloth strips, bone accents',
    'Aurelia':   'regal storm herald in gold-trimmed white and blue armour, flowing cape, feathered shoulder crests, crackling blue energy at her gauntlets',
    'Seraphine': 'celestial guardian in ivory and pale gold ceremonial armour, halo ring behind her head, long flowing robes, ethereal blue glow',
    'Gorgonok':  'enormous broad-shouldered stone and iron forge brute, cracked granite skin with molten seams, thick heavy arms, small head sunk between shoulders',
    'Thorne':    'wild druid warrior in bark and leather armour, thick green vines and thorny creepers wrapped around arms and torso, antlered helm, mossy cloak',
    'Voss':      'lean hooded assassin in tight black leather with dark grey wraps, face mask, hood, belt pouches, minimal armour, agile build',
    # --- the four AI-only creatures (BOSS_MAP) -----------------------------
    'Karrigos':  'colossal hollow stone titan, immense cracked basalt body, hollow glowing orange chest cavity, massive arms, craggy featureless head, ancient and eroded',
    'Grint':     'small scrappy goblin-like scrapling creature, wiry limbs, scavenged metal plate armour, oversized ears, hunched posture, junk-metal texture',
    'Slagling':  'small squat molten cinder creature, cracked blackened crust over glowing magma, stubby limbs, ember-filled mouth, volcanic rock skin',
    'Hollowkin': 'tall gaunt husk creature, desiccated grey withered body, hollow black eye sockets, exposed ribs, tattered wrappings, long thin limbs',
}


def _retry(fn, what, tries=5):
    """Retries transient network failures with a growing pause.

    A whole-roster run is tens of minutes of network I/O, and a single
    `getaddrinfo failed` killed the batch after 8 of 13 characters (the same
    outage also failed a git push at that moment). Every call in here is
    idempotent - submission is recorded in the manifest BEFORE polling starts -
    so retrying is always safe.
    """
    delay = 5
    for attempt in range(tries):
        try:
            return fn()
        except Exception as e:
            if attempt == tries - 1:
                raise
            print('    (%s failed: %s - retrying in %ds)' % (what, str(e)[:70], delay))
            time.sleep(delay)
            delay = min(delay * 2, 60)


def post(path, payload=None, files=None):
    """JSON POST, or multipart when `files` is given."""
    url = API + path
    if files is not None:
        boundary = '----astralclash%d' % int(time.time() * 1000)
        body = b''
        for k, v in files:
            body += ('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                     % (boundary, k, v)).encode('utf-8')
        body += ('--%s--\r\n' % boundary).encode()
        req = urllib.request.Request(url, data=body, method='POST', headers={
            'Authorization': 'Bearer ' + KEY,
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
        })
    else:
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                     headers={'Authorization': 'Bearer ' + KEY,
                                              'Content-Type': 'application/json'})
    def once():
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read().decode())
    try:
        return _retry(once, 'POST ' + path)
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf8', 'replace')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw[:400]}


def fetch(url, dest):
    def once():
        with urllib.request.urlopen(url, timeout=300) as r:
            blob = r.read()
        io.open(dest, 'wb').write(blob)   # write only after a COMPLETE read, so
        return os.path.getsize(dest)      # a truncated fetch leaves no file
    return _retry(once, 'download ' + os.path.basename(dest))


def manifest_path():
    return os.path.join(RAW, 'manifest.json')


def load_manifest():
    try:
        return json.load(io.open(manifest_path(), encoding='utf-8'))
    except Exception:
        return {}


def save_manifest(m):
    io.open(manifest_path(), 'w', encoding='utf-8').write(json.dumps(m, indent=1))


def submit(name):
    prompt = CHARACTERS[name] + ', ' + PREAMBLE
    code, data = post('/rodin', files=[
        ('tier', 'Sketch'),
        ('mesh_mode', 'Raw'),
        ('texture_mode', 'high'),
        ('prompt', prompt),
    ])
    if code not in (200, 201) or 'uuid' not in data:
        return None, 'submit failed (HTTP %s): %s' % (code, json.dumps(data)[:220])
    return {
        'uuid': data['uuid'],
        'subscription_key': data['jobs']['subscription_key'],
        'submitted': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'consumed': data.get('consumed'),
    }, None


def poll(job, budget=900):
    """Waits for every sub-job to finish. Returns (ok, states)."""
    deadline = time.time() + budget
    states = []
    while time.time() < deadline:
        code, data = post('/status', {'subscription_key': job['subscription_key']})
        states = [j.get('status') for j in data.get('jobs', [])]
        if states and all(s in ('Done', 'Failed') for s in states):
            return (not any(s == 'Failed' for s in states)), states
        time.sleep(10)
    return False, states + ['TIMEOUT']


def download(name, job):
    code, data = post('/download', {'task_uuid': job['uuid']})
    items = data.get('list') or []
    got = {}
    for it in items:
        n = str(it.get('name', ''))
        if n.lower().endswith('.glb'):
            dest = os.path.join(RAW, name + '.glb')
            got['glb'] = fetch(it['url'], dest)
        elif n.lower().endswith(('.webp', '.png', '.jpg')):
            dest = os.path.join(RAW, name + '.preview' + os.path.splitext(n)[1])
            got['preview'] = fetch(it['url'], dest)
    return got, [str(i.get('name')) for i in items]


def main():
    if not os.path.isdir(RAW):
        os.makedirs(RAW)
    wanted = sys.argv[1:] or list(CHARACTERS)
    unknown = [w for w in wanted if w not in CHARACTERS]
    if unknown:
        print('unknown character(s): %s' % ', '.join(unknown))
        print('known: %s' % ', '.join(CHARACTERS))
        return 1

    man = load_manifest()
    for name in wanted:
        glb = os.path.join(RAW, name + '.glb')
        if os.path.exists(glb) and os.path.getsize(glb) > 50000:
            print('%-11s already have %s (%.2f MB) - skipping'
                  % (name, os.path.basename(glb), os.path.getsize(glb) / 1e6))
            continue

        job = man.get(name)
        if not job or 'subscription_key' not in job:
            job, err = submit(name)
            if err:
                print('%-11s %s' % (name, err))
                continue
            man[name] = job
            save_manifest(man)
            print('%-11s submitted %s (consumed %s)' % (name, job['uuid'][:8], job.get('consumed')))
        else:
            print('%-11s resuming %s' % (name, job['uuid'][:8]))

        try:
            ok, states = poll(job)
        except Exception as e:
            print('%-11s polling failed: %s' % (name, str(e)[:90]))
            continue
        if not ok:
            print('%-11s generation did not finish: %s' % (name, ' '.join(states)))
            continue
        try:
            got, names = download(name, job)
        except Exception as e:
            print('%-11s download failed: %s' % (name, e))
            continue
        if 'glb' not in got:
            print('%-11s no GLB offered (got %s)' % (name, names))
            continue
        man[name]['downloaded'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        man[name]['bytes'] = got['glb']
        save_manifest(man)
        print('%-11s OK  %.2f MB' % (name, got['glb'] / 1e6))
    return 0


if __name__ == '__main__':
    sys.exit(main())
