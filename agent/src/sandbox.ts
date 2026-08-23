// RUNNING CODE WE DID NOT WRITE.
//
// The correctness check generates a test suite from the milestone and executes
// it against what the contributor merged. Executing it is the whole point, and
// it is also the dangerous part: that code can do anything, and this agent holds
// a funded wallet, a Circle entity secret and a GitHub token. Nobody has to fool
// the judgment to steal from us — they submit a "test" that reads the
// environment. `npm install` alone is arbitrary code execution via postinstall,
// before a single test runs.
//
// So the controls, in the order that actually matters:
//
//   1. NO SECRETS IN THE SANDBOX, EVER. This is the whole game. With no key, no
//      token and no wallet inside, full arbitrary code execution buys an
//      attacker a copy of a public repository they already had.
//   2. NOT THE AGENT'S HOST, and no route back to it. Blocks lateral movement.
//   3. EPHEMERAL, with hard time limits. Nothing persists; a hang cannot become
//      a bill.
//   4. Egress restricted during the run. Useful, but it cannot be absolute
//      because `npm install` needs the network, and it matters far less once (1)
//      holds.
//
// ONE FUNCTION, NOT AN ABSTRACTION LAYER. There is no provider interface, no
// factory, no config-driven selection — that is a lot of machinery for something
// with one implementation. What makes swapping vendors cheap is the SIGNATURE:
// nothing below names a vendor, so a vendor's shape dies inside the function
// body and never reaches a caller.

export type SandboxFile = { path: string; contents: string };

export type SandboxRun = {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the run was killed at the deadline rather than exiting. */
  timedOut: boolean;
};

export type SandboxLimits = {
  /** Wall-clock ceiling. The run is killed, not waited on. */
  seconds: number;
};

/// Where the code runs.
///
/// `local` executes ON THIS MACHINE and is therefore NOT A SANDBOX. It exists so
/// the correctness experiment can run OUR OWN fixtures, which we wrote and can
/// read. It must never be handed a contributor's code, and `runInSandbox`
/// refuses to do so rather than trusting a caller to remember.
export type SandboxDriver = 'local' | 'remote';

export class UntrustedCodeLocally extends Error {
  constructor() {
    super(
      'refusing to run untrusted code with the local driver — set SANDBOX_DRIVER=remote ' +
        'and provide credentials, or pass trusted: true for fixtures we wrote ourselves',
    );
    this.name = 'UntrustedCodeLocally';
  }
}

export function driver(): SandboxDriver {
  return process.env.SANDBOX_DRIVER === 'remote' ? 'remote' : 'local';
}

/// Write `files`, run `command`, return what happened. Nothing else.
///
/// `trusted` is deliberately not optional-by-omission at the call site that
/// matters: a caller handling a contributor's repository must pass `false`, and
/// with the local driver that throws rather than executing. Getting this wrong
/// should be loud and immediate, not discovered later.
export async function runInSandbox(
  files: SandboxFile[],
  command: string,
  limits: SandboxLimits,
  opts: { trusted: boolean },
): Promise<SandboxRun> {
  const where = driver();

  if (where === 'local' && !opts.trusted) throw new UntrustedCodeLocally();
  if (where === 'local') return runLocally(files, command, limits);

  return runRemotely(files, command, limits);
}

// ---------------------------------------------------------------------------

async function runLocally(files: SandboxFile[], command: string, limits: SandboxLimits): Promise<SandboxRun> {
  const { execFile } = await import('node:child_process');
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');

  const root = await mkdtemp(join(tmpdir(), 'proofstream-run-'));
  try {
    for (const f of files) {
      const dest = join(root, f.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.contents);
    }

    return await new Promise<SandboxRun>((resolve) => {
      const child = execFile(
        'sh',
        ['-c', command],
        { cwd: root, timeout: limits.seconds * 1_000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const killed = Boolean(err && (err as NodeJS.ErrnoException).code === undefined && child.killed);
          resolve({
            exitCode: err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            timedOut: killed,
          });
        },
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/// Beam lives HERE and nowhere else. Every vendor-shaped name in this file is
/// inside this function body, so replacing the vendor is replacing one function.
///
/// The four controls from the header, and where each one is enforced:
///
///   1. NO SECRETS. `env` is an explicit object, never `...process.env`. The
///      sandbox gets PATH and HOME and nothing else. This is the control that
///      makes the other three merely useful rather than load-bearing, so it is
///      written as a whole-object literal that cannot accidentally inherit.
///   2. NOT OUR HOST. Beam runs it on their infrastructure. Nothing here opens a
///      port back, and the sandbox is never told where we are.
///   3. EPHEMERAL, WITH A DEADLINE WE ENFORCE. `keepWarmSeconds` is Beam's
///      keep-warm setting, not a kill switch, and Beam documents no hard maximum
///      lifetime — so the wall clock is raced HERE and `terminate()` runs in a
///      finally. A hang must not become a bill.
///   4. NO EGRESS. `updateNetworkPermissions(true)` blocks outbound traffic
///      before any contributor code runs. Note the ordering: files are written
///      and the network is cut BEFORE `execShell`, because `npm install` is
///      arbitrary code execution and it must not be the thing that gets out.
async function runRemotely(
  files: SandboxFile[],
  command: string,
  limits: SandboxLimits,
): Promise<SandboxRun> {
  const { Sandbox, beamOpts } = await import('@beamcloud/beam-js');

  // THE SDK AUTHENTICATES OFF A MUTABLE MODULE OBJECT, not off the environment.
  // It reads no env var and no config file of its own, so forgetting this does
  // not fail at startup — it fails on the first live judgment with "Beam token
  // is not set", which is the worst possible moment to discover it.
  if (!beamOpts.token) {
    const token = process.env.BEAM_TOKEN;
    if (!token) {
      throw new Error(
        'BEAM_TOKEN is not set — the remote sandbox cannot authenticate. ' +
          'Get it from the Beam dashboard, or run `beam configure` and copy the token out.',
      );
    }
    beamOpts.token = token;

    // The workspace id is required on every request, and the SDK's own
    // `_getWorkspace()` cannot fetch it because `request()` refuses before the
    // id is set. So resolve it directly, once, and let it be overridden to skip
    // the round trip.
    beamOpts.workspaceId =
      process.env.BEAM_WORKSPACE_ID || (await resolveWorkspaceId(token, beamOpts.gatewayUrl));
  }

  const WORKDIR = '/workspace';

  const sandbox = new Sandbox({
    name: 'proofstream-correctness',
    cpu: Number(process.env.SANDBOX_CPU || 2),
    memory: process.env.SANDBOX_MEMORY || '2Gi',
    // Beam's own ceiling, set above ours so OUR deadline is the one that fires.
    // If this were the tighter of the two, a run could be reaped mid-test and
    // report a failure that was really a timeout.
    keepWarmSeconds: limits.seconds + 60,
  });

  const instance = await sandbox.create();

  try {
    // Cut the network FIRST. Everything after this line may be hostile.
    await instance.updateNetworkPermissions(true);

    for (const f of files) {
      const dest = `${WORKDIR}/${f.path}`;
      const dir = dest.slice(0, dest.lastIndexOf('/'));
      if (dir && dir !== WORKDIR) await instance.fs.mkdir(dir);
      await instance.fs.writeText(dest, f.contents);
    }

    const proc = await instance.execShell(command, {
      cwd: WORKDIR,
      // THE WHOLE GAME. An explicit object, never spread from process.env. A
      // sandbox that can read our environment is a sandbox that can read a
      // Circle entity secret and a funded wallet's credentials.
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: WORKDIR },
    });

    // Ours is the deadline that counts. `wait()` resolves with the exit code;
    // the timer resolves with null and we report a timeout rather than a
    // failure, because "the tests did not finish" and "the tests failed" are
    // different answers and only one of them is the contributor's fault.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), limits.seconds * 1_000);
    });

    const exitCode = await Promise.race([proc.wait(), deadline]).finally(() => clearTimeout(timer));

    if (exitCode === null) {
      await proc.kill().catch(() => {});
      return { exitCode: -1, stdout: '', stderr: '', timedOut: true };
    }

    const [stdout, stderr] = await Promise.all([
      proc.stdout.read().catch(() => ''),
      proc.stderr.read().catch(() => ''),
    ]);

    return { exitCode, stdout, stderr, timedOut: false };
  } finally {
    // Unconditional. The sandbox costs money for as long as it exists, and the
    // reason we are here at all is that we do not trust what is inside it.
    await instance.terminate().catch(() => {});
  }
}

/// One call, to turn a token into the workspace id every other call needs.
/// Set BEAM_WORKSPACE_ID to skip it.
async function resolveWorkspaceId(token: string, gatewayUrl: string): Promise<string> {
  const res = await fetch(`${gatewayUrl}/api/v1/workspace/current`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `could not resolve the sandbox workspace: ${res.status}. ` +
        'Check BEAM_TOKEN, or set BEAM_WORKSPACE_ID directly to skip this lookup.',
    );
  }
  const body = (await res.json()) as { externalId?: string; external_id?: string; id?: string };
  const id = body.externalId ?? body.external_id ?? body.id;
  if (!id) throw new Error('the workspace lookup returned no id — set BEAM_WORKSPACE_ID directly');
  return id;
}
