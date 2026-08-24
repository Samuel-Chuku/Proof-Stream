// IMPLEMENTATION-BLIND ORACLE GENERATION.
//
// Reading code tells you a milestone's work is PRESENT. It does not tell you
// the work is CORRECT — an implementation that is subtly wrong, carrying a test
// that agrees with it, reads as finished.
//
// So this changes the question. Instead of asking a model to EVALUATE code, ask
// it to SPECIFY the behaviour and let execution adjudicate. The model no longer
// has to be right about whether the code works; it only has to be right about
// what the milestone means, and the runtime settles the rest. An executable
// test is a claim reality can refuse, which is what prose could never be.
//
// THE ONE RULE: the generator never sees the implementation body or the
// contributor's tests. A model shown the code writes tests that agree with
// whatever it already does, bugs included. It does see the public signatures,
// because you cannot call code you know nothing about.
//
// The prompts below are SETTLED. Model choice and the reference filter decide
// this result; prompt wording does not. Do not reopen them to save a token.
import { env } from './env';
import { callLlm } from './verdict';

/// Deliberately far above the agent's own ceiling, and NOT shared with it.
///
/// A truncated suite is not a smaller suite. It ends mid-expression, fails to
/// parse, and is scored `void` — so setting this too low does not buy a cheaper
/// check, it buys no check at all, paid for in full. Suites run to 130 lines.
///
/// Headroom is not billed unless it is used: providers charge for tokens
/// produced, not for the cap. There is no reason to be frugal here.
const ORACLE_MAX_TOKENS = Number(process.env.ORACLE_MAX_TOKENS || 16_000);

/// One file of the repository, as the sandbox will see it.
export type SourceFile = { path: string; contents: string };

/// Signatures and types, with every function BODY removed.
///
/// This is the line between "enough to call the code" and "enough to be misled
/// by it". Types are kept in full because they are interface, not logic.
export function publicInterface(source: string): string {
  const out: string[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A type or interface declaration: keep it whole, braces and all.
    if (/^export\s+(type|interface)\b/.test(line)) {
      out.push(line);
      let depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      while (depth > 0 && i + 1 < lines.length) {
        const next = lines[++i];
        out.push(next);
        depth += (next.match(/\{/g) ?? []).length - (next.match(/\}/g) ?? []).length;
      }
      continue;
    }

    // A function: keep the signature up to the opening brace, drop the body.
    if (/^export\s+(async\s+)?function\b/.test(line)) {
      const sig: string[] = [line];
      while (!sig[sig.length - 1].includes('{') && i + 1 < lines.length) sig.push(lines[++i]);
      out.push(...sig.map((s) => s.replace(/\{\s*$/, '{')), '  /* body hidden */', '}', '');
      // Skip the real body.
      let depth = 1;
      while (depth > 0 && i + 1 < lines.length) {
        const next = lines[++i];
        depth += (next.match(/\{/g) ?? []).length - (next.match(/\}/g) ?? []).length;
      }
      continue;
    }
  }
  return out.join('\n').trim();
}

/// A file is worth showing the generator only if it exports something callable.
/// A test file, a config, a barrel of re-exports contributes nothing to a
/// specification and spends tokens crowding out the module that matters.
export function interfacesOf(files: SourceFile[]): { path: string; iface: string }[] {
  return files
    .filter((f) => !/\.(test|spec)\.[mc]?[jt]sx?$/.test(f.path))
    .map((f) => ({ path: f.path, iface: publicInterface(f.contents) }))
    .filter((f) => f.iface.length > 0);
}

const SPEC_PROMPT = `You are writing a behavioural specification from a requirement, before any code exists.

You are given a requirement in plain English and the PUBLIC SIGNATURES of the module that is meant
to satisfy it. You are NOT given the implementation, and you must not guess at it or assume it is
correct. Specify what the requirement DEMANDS, not what some implementation might happen to do.

Produce:
1. OBSERVABLE BEHAVIOURS — what a caller must be able to rely on, in terms of arguments and results.
2. INPUT CLASSES — the genuinely distinct kinds of input a real caller would pass. Be concrete about
   how a normal caller CONSTRUCTS those arguments, because that is usually where a requirement is
   misread. If two arguments can refer to the same underlying thing, say explicitly how a real
   caller would produce that situation, and note that there may be more than one way.
3. INVARIANTS — properties that must hold across ALL inputs, not just the examples.

SPECIFY CONSEQUENCES, NOT MECHANISMS. This is the rule that matters most. A requirement usually says
WHAT must be true, not HOW the code should achieve it. "Reject", "prevent", "disallow" and "block"
do not say whether the code throws, returns an error value, or silently does nothing, and all of
those can be correct. If you specify the mechanism you will fail correct implementations that chose
a different one.

So for anything the requirement forbids, state the OBSERVABLE CONSEQUENCES that every correct
implementation must share, whichever mechanism it picked. What must NOT have changed afterwards?
What must NOT have been recorded? Those are the same for all of them, and they are what to specify.

SEPARATE WHAT THE REQUIREMENT STATES FROM WHAT IT LEAVES OPEN. End with two headed lists:

STATED — behaviour the requirement actually demands. A reader could point at the sentence that
demands it. This is the only list anything may be tested against.

UNSPECIFIED — everything a thorough engineer might reasonably want, that this requirement does not
ask for. Boundary conditions the wording does not settle (does "at" or "until" include the instant
itself?), inputs it never mentions (empty collections, duplicates, enormous numbers, malformed
values), qualities it never promises (not mutating arguments, tolerating unsorted input, being pure
or idempotent), and error handling it never describes.

Be generous with UNSPECIFIED and strict with STATED. An implementation is not wrong for failing to
do something it was never asked to do, and a specification that quietly promotes a preference into a
requirement will condemn perfectly good work.

Reply with prose. No code.`;

const TESTS_PROMPT = `You are writing an executable test suite from a specification, before seeing any implementation.

You are given a requirement, a behavioural specification, and the PUBLIC SIGNATURES of the module.
You have NOT seen the implementation and you must not assume it is correct — your tests exist to
find out whether it is.

Rules:
- TEST THE STATED LIST AND NOTHING ELSE. The specification ends with STATED and UNSPECIFIED. Every
  assertion must trace to a STATED item. Anything on the UNSPECIFIED list is off limits: do not
  assert it, do not assert the opposite of it, and do not smuggle it into a test that is nominally
  about something else. This is the rule that decides whether this suite is fair.
  Concretely, if the requirement did not settle it, you must not assert: which side of a boundary an
  exact value falls on, what happens for an empty collection, duplicate entries, negative or
  enormous numbers, whether arguments are left unmutated, whether unsorted input is tolerated, or
  which error is raised. Correct code routinely differs on all of these.
  When you find yourself writing a test for something the requirement never mentioned, delete it. A
  smaller suite that is entirely fair is worth far more than a thorough one that condemns good work.
- Test only OBSERVABLE BEHAVIOUR through the public interface. Never reach for internal structure,
  private state or a particular storage strategy. Two correct implementations can be built
  completely differently, and a test that assumes one of them is a broken test.
- NEVER require a particular failure MECHANISM unless the requirement named one. If the requirement
  says something must be rejected, do not assert that it throws, and do not assert that it returns
  unchanged. Assert the consequences both would share: that no value moved, that nothing was
  recorded, that state the operation should not have touched is exactly as it was. Write the call so
  the test survives EITHER mechanism, catching an exception if one is raised and then checking the
  same consequences. A test that demands a thrown error will fail a correct implementation that
  returns one instead, which withholds pay from someone who did the job.
- Cover every input class in the specification, especially the ones a real caller would hit rather
  than the ones that are easiest to write.
- Assert the invariants as well as the examples.
- Use node:test and node:assert/strict. Give every test a SHORT DISTINCT NAME — the names are how
  each result is tracked, so two tests must never share one.
- Import what you are testing using the exact relative paths listed below, INCLUDING the .ts
  extension. The suite runs on the Node test runner with no bundler and no path resolution, so an
  import missing its extension will not resolve and the whole suite is discarded as unrunnable.
- IMPORT TYPES WITH \`import type\`, SEPARATELY FROM VALUES. Types do not exist at runtime, and the
  runner strips annotations rather than compiling, so naming a type in an ordinary import produces a
  real import of something that is not there and the whole suite dies with "does not provide an
  export named". Anything declared \`export type\` or \`export interface\` in the signatures below is a
  type. Write \`import { doThing } from './x.ts';\` and \`import type { Thing } from './x.ts';\` — never
  \`import { doThing, Thing }\`.
- Prefer not importing types at all. Let TypeScript infer, and build values with object literals.
  A test that never names a type cannot get this wrong.

Reply with ONLY the TypeScript file. No prose, no code fences.`;

export type GeneratedSuite = {
  spec: string;
  tests: string;
  costUsd: number;
  model: string;
};

/// Stage A then stage B. The implementation is never passed to either.
///
/// `suitePath` is where the file will be written in the repository tree, and it
/// decides what the relative imports have to look like. It sits at the root, so
/// a module at `src/ledger.ts` is imported as `./src/ledger.ts`.
export async function generateSuite(
  milestone: string,
  files: SourceFile[],
  suitePath: string,
): Promise<GeneratedSuite> {
  const modules = interfacesOf(files);
  if (modules.length === 0) {
    throw new Error('no source file in this repository exports anything a test could call');
  }

  const signatures = modules
    .map((m) => `----- ${m.path} — import it as './${m.path}' -----\n\`\`\`ts\n${m.iface}\n\`\`\``)
    .join('\n\n');

  const spec = await ask(SPEC_PROMPT, `REQUIREMENT:\n${milestone}\n\nPUBLIC SIGNATURES:\n${signatures}`);

  const tests = await ask(
    TESTS_PROMPT,
    `REQUIREMENT:\n${milestone}\n\nSPECIFICATION:\n${spec.content}\n\n` +
      `THE SUITE WILL BE SAVED AS: ${suitePath}\n` +
      `IMPORT THE MODULES UNDER TEST FROM THESE EXACT PATHS:\n` +
      `${modules.map((m) => `  './${m.path}'`).join('\n')}\n\n` +
      `PUBLIC SIGNATURES:\n${signatures}`,
  );

  // Models fence code even when told not to.
  const cleaned = tests.content.replace(/^\s*```(?:ts|typescript)?\s*\n/, '').replace(/\n```\s*$/, '');
  return {
    spec: spec.content,
    tests: cleaned,
    costUsd: spec.costUsd + tests.costUsd,
    model: tests.model,
  };
}

async function ask(system: string, user: string): Promise<{ content: string; costUsd: number; model: string }> {
  const body: any = await callLlm(
    {
      model: env.oracleModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: ORACLE_MAX_TOKENS,
      temperature: 0,
    },
    env.llmApiKey,
    // NO FALLBACK LIST, DELIBERATELY. Every other call in this agent degrades to
    // a weaker model rather than lose a judgment. Here that is the worst
    // available outcome: a weak oracle does not fail loudly, it writes a suite
    // that passes everything and reports the code correct, so a silent
    // downgrade turns this check into a rubber stamp pointing in the direction
    // that releases money. If the oracle model cannot serve us, the correctness
    // check is unavailable and says so.
    [],
  );

  const content: string = body.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('the oracle model returned an empty completion');
  return { content, costUsd: Number(body.usage?.cost ?? 0), model: body.model ?? env.oracleModel };
}
