# Integrate ProofStream into a product

## A. Minimal integration

Start read-only. Configure the pinned Arc chain and a verified WorkStream address. Use `examples/read-stream.ts` to read roles, milestone, funding, certification, policy, earned, and withdrawable values. Display the source commit and chain ID beside the data.

## B to D. Create, fund, and configure

Use the actual WorkStream constructor and generated ABI. Decide the mode first: a named stream supplies a contributor and no claim authority or payout caps; a claimable stream supplies a claim authority and no contributor; a public stream supplies neither and must carry nonzero payout caps with `dailyClaimCap >= claimCap`. A safe sequence is:

1. deploy from the employer wallet, because `employer` is the deploying caller;
2. wait for deployment receipt and verify bytecode;
3. register the address if the agent should discover it;
4. approve exact USDC units;
5. fund and verify the `Funded` event plus `funded()` state;
6. for a claimable stream, collect a signature bound to the claimant address, call `claim`, and verify `Claimed` plus activation state;
7. verify the stream mode, milestone, authors, policy, and activation state before work begins;
8. wait for and verify every receipt before moving to the next step.

Do not copy the current web flow's optimistic navigation as a final integration pattern. Make each step resumable from on-chain state.

## E. Evidence source

The implemented evidence path is GitHub-shaped. A repository descriptor and branch acceptance rule are part of the security boundary. Verify webhook signatures, constrain repository and branch, cap body size, bound diff size, and record evidence identity before calling a model. A general evidence descriptor or a second source is roadmap work unless generated compatibility says otherwise.

## F to G. Monitor and detect certification

Subscribe to actual contract events with a bounded block cursor. On reconnect, scan from the last finalized cursor and dedupe by transaction hash, log index, and stream address. A local agent JSONL row is not certification. Certification is confirmed only by a successful receipt, decoded event, and matching contract state.

## H to I. Read payout state and withdraw

For named and claimed streams, read `withdrawable()` immediately before presenting `withdraw`. For public streams, derive the authenticated earner id, read `payeeOf` and `earnerWithdrawable`, complete one-time `bindPayee` when needed, and present `withdrawFor`. Check the mode, caller, payee, milestone index, and applicable caps. Submit the exact integer amount, wait for the receipt, decode `Withdrawn` or `PaidOut`, reread state, and show a transaction link. If the call times out, query the receipt and event before retrying.

## J. React status

Use `examples/react-stream-status.tsx` and [ui-ux.md](ui-ux.md). Render a state derived from chain reads first. Show agent evidence and judgment as supporting context. Use a pending state for submitted-but-unconfirmed transactions and an unknown state for a timeout. Do not show “paid” because a transaction hash exists.

## K to M. Events and verification

Decode the generated ABI event, verify the receipt status, verify the contract's nonce and certification values, then correlate the contributor's USDC transfer. For missed events, use a bounded `getLogs` scan and persist the cursor. Do not scan an unbounded chain range on every page request.

## N. Failures

Handle wrong chain, missing code, invalid mode combinations, unclaimed streams, unresolved public earner ids, stale or copied binding signatures, insufficient gas, insufficient USDC, missing approval, registry rejection, webhook rejection, missing evidence, inconclusive correctness checks, model refusal, verifier paid failure, stale attestation, bad nonce, certification or payout cap failure, paused or closed state, RPC timeout, and withdrawal failure separately. Link each error to [troubleshooting.md](troubleshooting.md). A product must explain what happened and whether the user can retry.
