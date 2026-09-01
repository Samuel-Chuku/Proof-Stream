// Does the remote sandbox actually do what agent/src/sandbox.ts claims?
//
//   SANDBOX_DRIVER=remote pnpm sandbox:smoke
//
// LIVE: this creates a real sandbox and costs about half a cent. It is the only
// way to find out, because everything in the test suite is asserted against the
// source rather than against the provider.
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
const secrets = ['CIRCLE_API_KEY', 'ENTITY_SECRET', 'AGENT_WALLET_ID', 'GITHUB_TOKEN', 'LLM_API_KEY', 'SANDBOX_TOKEN'];
const found = secrets.filter((k) => leak.stdout.includes(k));
found.length === 0 ? pass('no agent secrets in the sandbox environment') : fail(`LEAKED: ${found.join(', ')}`);
// The provider injects its own gateway credential into the base environment. It
// reaches nothing of ours, but it would spend our account, so it is scrubbed too.
!/BETA9_TOKEN/.test(leak.stdout) ? pass("the platform's own token is scrubbed") : fail('BETA9_TOKEN is still readable');
console.log(`        (sandbox saw: ${leak.stdout.trim().split('\n').map((l) => l.split('=')[0]).join(', ') || 'nothing'})`);

console.log('\n3. egress is actually blocked, not just requested');
// PROBED WITH NODE, NOT CURL, AND THE REASON IS A NEAR MISS.
//
// The image is pinned to node:22-slim and slim images carry no curl. The old
// probe was `if curl ...; then echo REACHED; else echo refused; fi`, so a
// MISSING curl took the else branch and printed `refused` — reporting the
// security control as holding without ever attempting a connection. It would
// have passed identically with egress wide open.
//
// So probe with the runtime we know is there, which is also the one a
// contributor's code would actually use to exfiltrate. A sentinel is printed
// ONLY on success, and the failure branch names the error, so "the probe never
// ran" cannot be mistaken for "the network refused".
const PROBE =
  `node -e 'fetch("https://api.github.com",{signal:AbortSignal.timeout(8000)})` +
  `.then(function(r){console.log("REACHED_THE_INTERNET",r.status)})` +
  `.catch(function(e){console.log("refused:"+((e.cause&&e.cause.code)||e.name))})'`;
const net = await runInSandbox([], PROBE, { seconds: 60 }, { trusted: false });
const out = net.stdout + net.stderr;
!/REACHED_THE_INTERNET/.test(out) && /refused:/.test(out)
  ? pass(`outbound network refused (${out.match(/refused:(\S+)/)?.[1] ?? 'no reason given'})`)
  : fail(`egress got through, or the probe did not run — ${JSON.stringify(out.slice(0, 200))}`);

console.log('\n4. a hang is killed at our deadline, not left to run');
const started = Date.now();
const hung = await runInSandbox([], 'sleep 600', { seconds: 20 }, { trusted: false });
const took = Math.round((Date.now() - started) / 1000);
hung.timedOut ? pass(`reported as a timeout after ~${took}s`) : fail(`not reported as a timeout (exit ${hung.exitCode})`);
took < 90 ? pass("killed near our deadline rather than the provider's") : fail(`took ${took}s for a 20s limit`);

console.log('\n5. the image can actually run a generated suite, and a failure looks like one');
// The controls above are about safety. This one is about the check being able
// to do its job at all: the correctness oracle writes a TypeScript suite and
// runs it with no install step and no network, which only works because Node 22
// strips types natively and ships its own test runner.
//
// A PASSING TEST ALONE WOULD PROVE NOTHING. Six measurements in this project
// were broken by a check that could only come out green, so the suite below
// contains one test that must pass and one that must fail, and BOTH are
// asserted. If the runtime were missing we would see neither.
const suite = [
  { path: 'src/mod.ts', contents: 'export function two(): number {\n  return 2;\n}\n' },
  {
    path: 'oracle.test.ts',
    contents:
      'import test from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'import { two } from "./src/mod.ts";\n' +
      'test("this one must pass", () => assert.equal(two(), 2));\n' +
      'test("this one must fail", () => assert.equal(two(), 3));\n',
  },
];
const ran = await runInSandbox(suite, 'node --test oracle.test.ts', { seconds: 120 }, { trusted: false });
const tap = ran.stdout + ran.stderr;
/^# pass 1$/m.test(tap) ? pass('type-annotated TypeScript ran with no install step') : fail(`no passing test in the TAP — ${JSON.stringify(tap.slice(0, 300))}`);
/^# fail 1$/m.test(tap) && /not ok \d+ - this one must fail/.test(tap)
  ? pass('a failing test is reported as failing, by name')
  : fail('the deliberately broken test did not come back as a failure — this check could only ever go green');

console.log(process.exitCode ? '\nSOMETHING IS NOT AS CLAIMED — read the FAILs above.\n' : '\nAll four controls hold, and the runtime can run a suite.\n');
