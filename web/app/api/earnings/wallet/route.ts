import { type NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { readWalletEarnings } from '../../../../lib/earnings';

export const runtime = 'nodejs';

/// Every stream that knows one wallet, for the earnings page.
///
/// The wallet is client state, so this cannot be read during the server
/// render the way the GitHub half is. Public data: which streams name which
/// contributor is on chain for anyone to read, so there is no session here.
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: 'an address is required' }, { status: 400 });
  }
  const fresh = req.nextUrl.searchParams.get('fresh') !== null;
  return NextResponse.json({ positions: await readWalletEarnings(address, fresh) });
}
