// Prints the webhook secret and ingress URL for one stream.
//
// Terminal parity for what section C's GitHub OAuth flow will do automatically:
// a technical user configures the webhook by hand with these two values and
// gets identical behaviour, with no UI and no OAuth app.
//
// The secret is DERIVED from GITHUB_WEBHOOK_SECRET and the stream address, so
// nothing is stored and this can be re-run at any time to recover it. Never
// hand out GITHUB_WEBHOOK_SECRET itself — it is the master that mints every
// stream's secret.
import { createHmac } from 'node:crypto';
import { isAddress } from 'viem';

const stream = process.argv[2];

if (!stream || !isAddress(stream)) {
  console.error('usage: pnpm webhook:secret <stream address>');
  process.exit(1);
}

const master = process.env.GITHUB_WEBHOOK_SECRET;
if (!master) {
  console.error('GITHUB_WEBHOOK_SECRET is not set — see .env.example');
  process.exit(1);
}

const ingress = process.env.AGENT_INGRESS_URL ?? 'https://<your-ingress-host>';
const secret = createHmac('sha256', master).update(stream.toLowerCase()).digest('hex');

console.log('Configure this webhook on the target repository:\n');
console.log(`  Payload URL   ${ingress.replace(/\/+$/, '')}/webhook/${stream}`);
console.log('  Content type  application/json');
console.log(`  Secret        ${secret}`);
console.log('  Events        Pull requests only\n');
console.log('The agent recomputes this secret per delivery; nothing is stored.');
