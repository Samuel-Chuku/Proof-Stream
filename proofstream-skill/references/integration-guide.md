# Integrate ProofStream into a product

## A. Minimal integration

Start read-only. Configure the pinned Arc chain and a verified WorkStream address. Use `examples/read-stream.ts` to read roles, milestone, funding, certification, policy, earned, and withdrawable values. Display the source commit and chain ID beside the data.

## B to D. Create, fund, and configure

Use the actual WorkStream constructor and generated ABI. A safe sequence is:

1. deploy from the employer wallet, because `employer` is the deploying caller;
2. wait for deployment receipt and verify bytecode;
3. register the address if the agent should discover it;
4. approve exact USDC units;
5. fund and verify the `Funded` event plus `funded()` state;
6. open the milestone with exact text, budget, and duration;
7. wait for and verify every receipt before moving to the next step.

Do not copy the current web flow's optimistic navigation as a final integration pattern. Make each step resumable from on-chain state.

## E. Evidence source

The implemented evidence path is GitHub-shaped. A repository descriptor and branch acceptance rule are part of the security boundary. Verify webhook signatures, constrain repository and branch, cap body size, bound diff size, and record evidence identity before calling a model. A general evidence descriptor or a second source is roadmap work unless generated compatibility says otherwise.

## F to G. Monitor and detect certification

Subscribe to actual contract events with a bounded block cursor. On reconnect, scan from the last finalized cursor and dedupe by transaction hash, log index, and stream address. A local agent JSONL row is not certification. Certification is confirmed only by a successful receipt, decoded event, and matching contract state.

## H to I. Read payout state and withdraw

Read `withdrawable()` immediately before presenting a withdrawal action. Check the caller and payee allowlist. Submit the exact integer amount, wait for the receipt, decode `Withdrawn`, reread the balance and withdrawable amount, and show a transaction link. If the call times out, query the receipt and event before retrying.

## J. React status

Use `examples/react-stream-status.tsx` and [ui-ux.md](ui-ux.md). Render a state derived from chain reads first. Show agent evidence and judgment as supporting context. Use a pending state for submitted-but-unconfirmed transactions and an unknown state for a timeout. Do not show “paid” because a transaction hash exists.

## K to M. Events and verification

Decode the generated ABI event, verify the receipt status, verify the contract's nonce and certification values, then correlate the contributor's USDC transfer. For missed events, use a bounded `getLogs` scan and persist the cursor. Do not scan an unbounded chain range on every page request.

## N. Failures

Handle wrong chain, missing code, insufficient gas, insufficient USDC, missing approval, registry rejection, webhook rejection, missing evidence, model refusal, verifier paid failure, stale attestation, bad nonce, cap failure, paused or closed state, RPC timeout, and withdrawal failure separately. Link each error to [troubleshooting.md](troubleshooting.md). A product must explain what happened and whether the user can retry.
