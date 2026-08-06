'use client';

import { useEffect, useState } from 'react';
import { AddressChip } from './address-chip';
import {
  authenticatePasskey,
  forgetCredential,
  passkeysConfigured,
  recallCredential,
  smartAccountFor,
} from '../lib/passkey';

/// Onboarding for contributors who do not have a wallet.
///
/// A passkey lives in the device's secure enclave — a fingerprint or a face,
/// no seed phrase, no extension to install. It produces a Circle Smart Account
/// address, and that address is what the employer sets as `contributor` when
/// they create the stream.
///
/// THE ORDER MATTERS AND THE UI HAS TO SAY SO. `contributor` and the policy
/// payee are IMMUTABLE on the contract, so the address has to exist before the
/// stream is deployed. A contributor who creates a passkey afterwards has a
/// perfectly good wallet that the stream will never pay, and nothing can be
/// done about it — which is exactly how 40 USDC was lost here already.
export function PasskeyWallet() {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // A credential remembered on this device: derive the address without
    // asking for the passkey again. Deriving is a read, not a signature.
    const credential = recallCredential();
    if (!credential) return;
    smartAccountFor(credential)
      .then(({ account }) => setAddress(account.address))
      .catch(() => forgetCredential());
  }, []);

  async function run(mode: 'register' | 'login') {
    setBusy(mode);
    setError(null);
    try {
      const credential = await authenticatePasskey(mode, username.trim() || 'proofstream');
      const { account } = await smartAccountFor(credential);
      setAddress(account.address);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  if (!mounted) return null;

  if (!passkeysConfigured) {
    return (
      <p className="ps-caption">
        PASSKEY WALLETS ARE NOT CONFIGURED ON THIS DEPLOYMENT — CONNECT A BROWSER WALLET INSTEAD
      </p>
    );
  }

  if (address) {
    return (
      <div className="ps-passkey">
        <p className="ps-label">YOUR PASSKEY WALLET</p>
        <AddressChip address={address} />
        <p className="ps-caption">
          GIVE THIS ADDRESS TO THE EMPLOYER <b>BEFORE</b> THEY CREATE THE STREAM. THE CONTRIBUTOR AND
          PAYEE ARE FIXED WHEN THE CONTRACT IS DEPLOYED AND CAN NEVER BE CHANGED, SO A STREAM MADE
          AGAINST A DIFFERENT ADDRESS CAN NEVER PAY THIS ONE.
        </p>
        <button
          type="button"
          className="ps-button"
          onClick={() => {
            forgetCredential();
            setAddress(null);
          }}
        >
          [ FORGET ON THIS DEVICE ]
        </button>
        <p className="ps-caption">
          FORGETTING ONLY CLEARS IT HERE. THE PASSKEY STAYS ON YOUR DEVICE AND SIGNING IN AGAIN
          RETURNS THE SAME ADDRESS.
        </p>
      </div>
    );
  }

  return (
    <div className="ps-passkey">
      <p className="ps-label">NO WALLET? USE A PASSKEY</p>
      <p className="ps-body">
        A passkey is the fingerprint or face unlock your device already has. No seed phrase, no
        extension. It creates a smart account that can receive and withdraw your pay, and Circle
        sponsors the gas — so you can collect without ever holding a token first.
      </p>

      <label className="ps-caption" htmlFor="passkey-name">
        A NAME YOUR DEVICE WILL SHOW YOU LATER
      </label>
      <div className="ps-repoint-row">
        <input
          id="passkey-name"
          className="ps-input"
          value={username}
          placeholder="[ e.g. proofstream ]"
          onChange={(e) => setUsername(e.target.value)}
        />
        <button
          type="button"
          className="ps-button ps-button-primary"
          disabled={busy !== null}
          onClick={() => run('register')}
        >
          [ {busy === 'register' ? 'CREATING…' : 'CREATE'} ]
        </button>
        <button type="button" className="ps-button" disabled={busy !== null} onClick={() => run('login')}>
          [ {busy === 'login' ? 'OPENING…' : 'I HAVE ONE'} ]
        </button>
      </div>

      {error && <p className="ps-caption">{error}</p>}

      <p className="ps-caption">
        EMPLOYERS CANNOT USE THIS. CREATING A STREAM DEPLOYS A CONTRACT, AND A SMART ACCOUNT CAN ONLY
        CALL EXISTING ONES — SO AN EMPLOYER MUST CONNECT A BROWSER WALLET.
      </p>
    </div>
  );
}

/// WebAuthn refusals are routine and mostly not errors: a cancelled prompt, a
/// device with no biometrics, a passkey that belongs to another site. Saying
/// "something went wrong" for a cancelled dialog sends people hunting.
function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/NotAllowedError|cancel|abort/i.test(message)) {
    return 'The passkey prompt was dismissed. Nothing was created — try again when you are ready.';
  }
  if (/NotSupportedError|not supported/i.test(message)) {
    return 'This device or browser does not support passkeys. Connect a browser wallet instead.';
  }
  if (/InvalidStateError|already/i.test(message)) {
    return 'This device already has a passkey for ProofStream. Choose "I HAVE ONE" to sign in with it.';
  }
  if (/no credentials|not found/i.test(message)) {
    return 'No passkey for ProofStream was found on this device. Choose "CREATE" to make one.';
  }
  return message.split('\n')[0];
}
