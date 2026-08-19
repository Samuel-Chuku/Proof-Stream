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

/// NOT BUILT YET. Needs a Beam account key and the SDK added as a dependency.
///
/// When it is written, everything vendor-shaped belongs inside this function.
/// The rules from the header are the acceptance criteria, and the first one is
/// the one to check by reading the code rather than the docs: the environment
/// handed to the remote run must contain NOTHING from `process.env`.
async function runRemotely(
  _files: SandboxFile[],
  _command: string,
  _limits: SandboxLimits,
): Promise<SandboxRun> {
  throw new Error(
    'the remote sandbox driver is not implemented yet — it needs a Beam key and the SDK; ' +
      'see the header of agent/src/sandbox.ts for what it must guarantee',
  );
}
