'use client';

import {
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  WebAuthnMode,
} from '@circle-fin/modular-wallets-core';
import { createPublicClient } from 'viem';
import { toWebAuthnAccount } from 'viem/account-abstraction';
import { arcTestnet } from './chain';

/// Circle Modular Wallets, for CONTRIBUTORS only.
///
/// The split is architectural, not a scoping choice. A modular wallet is an
/// ERC-4337 smart account and a user operation executes a call TO AN ADDRESS —
/// there is no contract-creation path. An employer must therefore bring a
/// browser wallet, because deploying the WorkStream is what makes them its
/// employer, and routing that through a deployer contract would make the
/// DEPLOYER the employer and send `closeMilestone` refunds somewhere nobody can
/// reach. Everything a contributor does is a call to an existing address, so
/// `withdraw` works perfectly.
///
/// Why it is worth having at all: the contributor is the party least likely to
/// own a wallet, and the one whose key loss is unrecoverable. `contributor` and
/// the policy payee are immutable on the contract, so a stream deployed against
/// a key nobody holds can never pay out — which has already cost this project
/// 40 USDC. A passkey lives in the device's secure enclave and is the only
/// onboarding here that does not begin with "first, install a wallet".
///
/// These credentials come from a DIFFERENT Circle account than the agents'
/// developer-controlled wallets, and deliberately so: the passkey domain is a
/// single account-level setting, and this account's is proofstream.site. The
/// two surfaces share nothing — no wallet set, no entity secret, no API key.
const CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
const CLIENT_URL = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL;

/// The chain segment Circle expects on the modular transport URL. Arc testnet
/// is supported natively; do not hand-roll this from the chain id.
const CHAIN_SEGMENT = 'arcTestnet';

export const passkeysConfigured = Boolean(CLIENT_KEY && CLIENT_URL);

/// Remembering WHICH passkey, not the passkey itself. WebAuthn keeps the
/// private key in the device's secure enclave and never exposes it; this is
/// only the public credential, so a contributor is not asked to pick their
/// passkey out of a list on every visit. Clearing it is a local sign-out and
/// loses nothing — the passkey itself still exists on the device.
const CREDENTIAL_KEY = 'proofstream.passkey.credential';

type StoredCredential = Parameters<typeof toWebAuthnAccount>[0]['credential'];

export function rememberCredential(credential: StoredCredential) {
  try {
    localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credential));
  } catch {
    // Private browsing refuses storage. The wallet still works for this
    // session; the contributor is asked for the passkey again next time.
  }
}

export function recallCredential(): StoredCredential | null {
  try {
    const raw = localStorage.getItem(CREDENTIAL_KEY);
    return raw ? (JSON.parse(raw) as StoredCredential) : null;
  } catch {
    return null;
  }
}

export function forgetCredential() {
  try {
    localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    /* nothing to clear */
  }
}

function requireConfig() {
  if (!CLIENT_KEY || !CLIENT_URL) {
    throw new Error(
      'Passkey wallets are not configured — NEXT_PUBLIC_CIRCLE_CLIENT_KEY and NEXT_PUBLIC_CIRCLE_CLIENT_URL must both be set.',
    );
  }
  return { key: CLIENT_KEY, url: CLIENT_URL };
}

/// Register a new passkey, or sign in with one this device already holds.
///
/// `username` is what the device shows in its own passkey picker, so it should
/// be recognisable months later on a device holding passkeys for many sites.
export async function authenticatePasskey(
  mode: 'register' | 'login',
  username: string,
): Promise<StoredCredential> {
  const { key, url } = requireConfig();
  const transport = toPasskeyTransport(url, key);

  const credential = await toWebAuthnCredential({
    transport,
    mode: mode === 'register' ? WebAuthnMode.Register : WebAuthnMode.Login,
    username,
  });

  rememberCredential(credential as StoredCredential);
  return credential as StoredCredential;
}

/// The contributor's smart account, plus a bundler that can send user
/// operations for it. Gas is sponsored by Circle's paymaster, which is the
/// other half of the onboarding argument: a contributor who has never held a
/// token can still collect what they earned.
export async function smartAccountFor(credential: StoredCredential) {
  const { key, url } = requireConfig();
  const modularTransport = toModularTransport(`${url}/${CHAIN_SEGMENT}`, key);

  const client = createPublicClient({ chain: arcTestnet, transport: modularTransport });

  const account = await toCircleSmartAccount({
    client,
    owner: toWebAuthnAccount({ credential }),
  });

  return { account, client, modularTransport };
}
