// Does the remote sandbox actually do what agent/src/sandbox.ts claims?
//
//   SANDBOX_DRIVER=remote pnpm sandbox:smoke
//
// LIVE: this creates a real sandbox and costs about half a cent. It is the only
// way to find out, because everything in the test suite is asserted against the
// source rather than against Beam.
//
// The interesting check is the third one. "No egress" is the control most
// likely to be silently untrue — an SDK flag that is accepted and ignored looks
// exactly like one that works, and we would not find out until a contributor's
// postinstall script had already phoned home.
import { runInSandbox, driver } from '../agent/src/sandbox';

const pass = (s: string) => console.log(`  PASS  ${s}`);
const fail = (s: string) => { console.log(`  FAIL  ${s}`); process.exitCode = 1; };

if (driver() !== 'remote') {
  console.error('set SANDBOX_DRIVER=remote — this is pointless against the local driver');
  process.exit(1);
}

const files = [
  { path: 'hello.txt', contents: 'written from the agent\n' },
  { path: 'src/nested.txt', contents: 'a nested path survived\n' },
];

console.log('\n1. files land, the command runs, output comes back');
const basic = await runInSandbox(files, 'cat hello.txt src/nested.txt', { seconds: 60 }, { trusted: false });
basic.exitCode === 0 ? pass(`exit 0`) : fail(`exit ${basic.exitCode}: ${basic.stderr.slice(0, 200)}`);
basic.stdout.includes('written from the agent') ? pass('stdout returned') : fail(`stdout was ${JSON.stringify(basic.stdout.slice(0, 120))}`);
basic.stdout.includes('a nested path survived') ? pass('nested paths created') : fail('nested path missing');

console.log('\n1b. a real shell is running the command');
// If this fails, every check below that uses shell syntax is meaningless —
// which is exactly what happened on the first run.
const sh = await runInSandbox([], 'echo one && echo two', { seconds: 60 }, { trusted: false });
sh.stdout.includes('one') && sh.stdout.includes('two')
  ? pass('shell operators are interpreted')
  : fail(`no shell — got ${JSON.stringify(sh.stdout.slice(0, 120))}`);

console.log('\n2. our environment did NOT follow the code in');
// The whole game. If a Circle secret or a wallet id is readable in there, every
// other control is decoration.
const leak = await runInSandbox([], 'env', { seconds: 60 }, { trusted: false });
const secrets = ['CIRCLE_API_KEY', 'ENTITY_SECRET', 'AGENT_WALLET_ID', 'GITHUB_TOKEN', 'LLM_API_KEY', 'OPENROUTER_API_KEY'];
const found = secrets.filter((k) => leak.stdout.includes(k));
found.length === 0 ? pass('no agent secrets in the sandbox environment') : fail(`LEAKED: ${found.join(', ')}`);
// Beam injects its own gateway credential into the base environment. It reaches
// nothing of ours, but it would buy our Beam account, so it gets scrubbed too.
!/BETA9_TOKEN/.test(leak.stdout) ? pass("the platform's own token is scrubbed") : fail('BETA9_TOKEN is still readable');
console.log(`        (sandbox saw: ${leak.stdout.trim().split('\n').map((l) => l.split('=')[0]).join(', ') || 'nothing'})`);

console.log('\n3. egress is actually blocked, not just requested');
// Deliberately NOT matched on an error string. An earlier version looked for
// the word BLOCKED and found it echoed back inside curl's own complaint about
// arguments it could not parse — a pass that proved nothing. This prints a
// sentinel ONLY on success, so reaching the network is the only way to see it.
const net = await runInSandbox(
  [],
  'if curl -sS --max-time 8 -o /dev/null https://api.github.com; then echo REACHED_THE_INTERNET; else echo refused; fi',
  { seconds: 60 },
  { trusted: false },
);
const out = net.stdout + net.stderr;
!/REACHED_THE_INTERNET/.test(out) && /refused/.test(out)
  ? pass('outbound network refused')
  : fail(`egress got through, or the probe did not run — ${JSON.stringify(out.slice(0, 200))}`);

console.log('\n4. a hang is killed at our deadline, not left to run');
const started = Date.now();
const hung = await runInSandbox([], 'sleep 600', { seconds: 20 }, { trusted: false });
const took = Math.round((Date.now() - started) / 1000);
hung.timedOut ? pass(`reported as a timeout after ~${took}s`) : fail(`not reported as a timeout (exit ${hung.exitCode})`);
took < 90 ? pass('killed near the deadline rather than at Beam\'s') : fail(`took ${took}s for a 20s limit`);

console.log(process.exitCode ? '\nSOMETHING IS NOT AS CLAIMED — read the FAILs above.\n' : '\nAll four controls hold.\n');
