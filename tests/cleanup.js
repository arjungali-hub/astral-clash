// Kills headless Chrome instances left behind by an interrupted test run.
//
//     node tests/cleanup.js
//
// WHY THIS EXISTS. puppeteer only shuts its browser down when the script
// reaches `browser.close()`. A run that is killed first — a timeout, Ctrl+C, an
// unhandled rejection — orphans a complete Chrome, renderer and GPU children
// included, and that orphan keeps software-rendering the game's 3D scene
// through swiftshader for as long as the machine is up. netcheck launches TWO
// browsers per run, so they accumulate fast. Eight of them on an 8-core machine
// made the whole desktop unresponsive and started failing new launches with
// "timed out waiting for the WS endpoint" — which reads exactly like a test
// bug and is not one.
//
// harness.js now closes its browsers on every exit path (see armCleanup), so
// this is the mop for strays predating that, or for a SIGKILL that runs no
// handlers at all.
//
// It matches on the COMMAND LINE, never on the process name. A blanket
// `taskkill /F /IM chrome.exe` closed the user's real browser windows once;
// every process killed here must be provably one of ours.
const { execSync } = require('child_process');

// Every marker is unique to a puppeteer-launched test browser:
//   --use-gl=swiftshader   the software GL renderer we ask for explicitly
//   --headless             a real browsing session is never headless
//   --remote-debugging-port with a puppeteer temp profile
// A normal Chrome has none of these. Requiring a match here is what makes the
// kill safe.
const MARKERS = ['*swiftshader*', '*--headless*'];

const ps = `
# Suppresses the CLIXML progress stream PowerShell writes to stderr on a
# cold start, which otherwise buries the one line of real output.
$ProgressPreference = 'SilentlyContinue'
$pats = @(${MARKERS.map(m => `'${m}'`).join(',')})
$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
        $cl = $_.CommandLine
        if (-not $cl) { return $false }
        $hit = $false
        foreach ($p in $pats) { if ($cl -like $p) { $hit = $true } }
        $hit
    }
if (-not $procs) { 'nothing to clean: no headless test browsers running'; exit 0 }
$n = 0
foreach ($p in $procs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $n++ } catch {}
}
"killed $n stray headless chrome process(es)"
$left = (Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | Measure-Object).Count
"chrome.exe processes still running (your real browser): $left"
`;

try {
    // -EncodedCommand sidesteps quoting entirely: this script contains both
    // quote styles and $ sigils, and passing it through -Command has broken
    // on that repeatedly.
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    const out = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, {
        encoding: 'utf8',
        timeout: 120000,
    });
    process.stdout.write(out);
} catch (e) {
    console.error('cleanup failed:', (e.message || '').slice(0, 200));
    process.exit(1);
}
