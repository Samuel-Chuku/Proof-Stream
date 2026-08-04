import Link from 'next/link';
import { BrandMark } from './brand-mark';
import { Socials } from './socials';

/// Present on every page. Carries the two things a first-time visitor needs
/// (how this works, and where to get testnet USDC) plus the repository, so the
/// claims on screen can be checked rather than taken on faith.
export function Footer() {
  return (
    <footer className="ps-footer">
      <div className="ps-footer-links">
        <Link href="/docs" className="ps-label">
          HOW IT WORKS
        </Link>
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="ps-label"
        >
          GET TESTNET USDC ↗
        </a>
        <a
          href="https://testnet.arcscan.app"
          target="_blank"
          rel="noreferrer"
          className="ps-label"
        >
          ARCSCAN ↗
        </a>
        <a
          href="https://github.com/Samuel-Chuku/Proof-Stream"
          target="_blank"
          rel="noreferrer"
          className="ps-label"
        >
          SOURCE ↗
        </a>
      </div>
      <div className="ps-footer-end">
        <Socials />
        <p className="ps-caption ps-footer-sig">
          <BrandMark size={14} />
          ARC TESTNET · CHAIN 5042002 · NOTHING HERE IS REAL MONEY
        </p>
      </div>
    </footer>
  );
}
