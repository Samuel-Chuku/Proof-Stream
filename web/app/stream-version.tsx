/// WHICH GENERATION OF THE CONTRACT A STREAM IS.
///
/// Every employer deploys their own copy, so a redeploy does not migrate
/// anything: streams from every past deployment stay live and keep their own
/// behaviour forever. A reader looking at two streams side by side has no way
/// to tell that one of them cannot do what the other can.
///
/// NOT GREEN, and not close to it. Green means USDC the agent released, and a
/// contract version is not money. This is a chip in the same family as an
/// address: quiet, factual, and easy to skip past once you have read it.
export function StreamVersion({ version }: { version: number }) {
  const current = version >= 2;
  return (
    <span
      className={`ps-version${current ? '' : ' ps-version-old'}`}
      title={
        current
          ? 'Deployed from the current contract.'
          : 'An earlier contract. It keeps working, and it cannot do everything a current stream can.'
      }
    >
      V{version}
    </span>
  );
}

/// What an older stream cannot do, said once, where it matters.
///
/// Only the differences a person can act on. Nobody needs to read a changelog
/// on a payroll page, and listing everything would bury the one line that
/// changes what they should expect.
export function OlderStreamNote({ version }: { version: number }) {
  if (version >= 2) return null;
  return (
    <p className="ps-older-note">
      <b>THIS IS AN EARLIER STREAM.</b> It keeps working: pay accrues, the agent
      certifies, and withdrawing and closing are unaffected. What it cannot do is
      accept a claim link, and its per-unlock cap was allowed to sit below the
      budget, which can leave part of the work unpayable. Newer streams refuse
      that at deployment.
    </p>
  );
}
