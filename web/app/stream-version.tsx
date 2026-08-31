/// WHICH GENERATION OF THE CONTRACT A STREAM IS.
///
/// Every employer deploys their own copy, so a redeploy does not migrate
/// anything: streams from every past deployment stay live and keep their own
/// behaviour forever. A reader looking at two streams side by side has no way
/// to tell that one of them cannot do what the other can.
///
/// NOT GREEN, and not close to it. Green means USDC the agent released, and a
/// contract version is not money.
///
/// Quiet on purpose: hairline border, dim ink, no fill. An earlier attempt gave
/// it a dithered background, which at this size read as a rendering artefact
/// rather than a label. A version is a footnote, not a status.
export function StreamVersion({ version }: { version: number }) {
  return (
    <span
      className="ps-version"
      title={
        version >= 2
          ? 'Deployed from the current contract.'
          : 'An earlier contract. It keeps working, and cannot accept a claim link.'
      }
    >
      V{version}
    </span>
  );
}
