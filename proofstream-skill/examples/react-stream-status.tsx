export type StreamStatusData = { funded: bigint; withdrawable: bigint; certificationConfirmed: boolean; transactionPending: boolean; refusal?: string };

export function ProofStreamStatus({ data }: { data: StreamStatusData }): JSX.Element {
  if (data.transactionPending) return <section aria-live="polite"><strong>Awaiting confirmation</strong><p>The transaction was submitted. Certification or payout is not final yet.</p></section>;
  if (data.refusal) return <section aria-live="polite"><strong>Review refused</strong><p>{data.refusal}</p></section>;
  if (data.certificationConfirmed) return <section aria-live="polite"><strong>Certified</strong><p>On-chain certification is confirmed. Withdrawable: {data.withdrawable.toString()} raw USDC units.</p></section>;
  if (data.funded === 0n) return <section><strong>Unfunded</strong><p>The stream has no deposited USDC.</p></section>;
  return <section aria-live="polite"><strong>Active</strong><p>Evidence and certification are still in progress.</p></section>;
}
