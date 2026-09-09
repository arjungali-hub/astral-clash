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

// And the checker processes themselves. Found the hard way: two `node
// tests/netcheck.js` processes were still alive 5.4 and 4.3 HOURS after their
// runs were abandoned, each parked forever waiting on a browser that had
// already been cleaned up. A hung checker is worse than a leaked browser,
// because the next run of the same checker contends with it for the HTTP port
// and the CDP relay, which is why netcheck appeared to hang rather than fail.
// Matched on the script path, so nothing but this repo's own tests can match.
const NODE_MARKERS = ['*astral-clash*tests*', '*tests/netcheck.js*', '*tests\netcheck.js*'];

const ps = `
# Suppresses the CLIXML progress stream PowerShell writes to stderr on a
# cold start, which otherwise buries the one line of real output.
$ProgressPreference = 'SilentlyContinue'
$pats = @(${MARKERS.map(m => `'${m}'`).join(',')})
$nodePats = @(${NODE_MARKERS.map(m => `'${m}'`).join(',')})
$me = $PID

function Select-Matching($name, $patterns) {
    Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
        Where-Object {
            $cl = $_.CommandLine
            if (-not $cl) { return $false }
            if ($_.ProcessId -eq $me) { return $false }
            $hit = $false
            foreach ($p in $patterns) { if ($cl -like $p) { $hit = $true } }
            $hit
        }
}

$browsers = Select-Matching 'chrome.exe' $pats
$checkers = Select-Matching 'node.exe' $nodePats

$nb = 0
foreach ($p in $browsers) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $nb++ } catch {} }
$nc = 0
foreach ($p in $checkers) {
    # Report the age: a checker alive for hours is the signature of the hang
    # this tool exists to clear, and worth seeing rather than silently killing.
    $mins = [math]::Round(((Get-Date) - $p.CreationDate).TotalMinutes, 1)
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $nc++; "  killed checker pid $($p.ProcessId) (alive $mins min)" } catch {}
}

if ($nb -eq 0 -and $nc -eq 0) { 'nothing to clean: no headless test browsers or stray checkers running'; exit 0 }
"killed $nb stray headless chrome process(es) and $nc stray checker process(es)"
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
