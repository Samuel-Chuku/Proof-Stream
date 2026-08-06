import { NextResponse, type NextRequest } from 'next/server';

/// Two hostnames, one deployment, two jobs.
///
///   proofstream.site       the landing page, and nothing else
///   app.proofstream.site   the product
///
/// Splitting them here rather than in two Vercel projects keeps a single build,
/// a single set of environment variables and one place for the design system —
/// the two can never drift, and there is no second deploy to remember before a
/// demo.
///
/// The apex serves `/landing` as its root by REWRITE, not redirect: a visitor
/// typing the domain should see the page at the address they typed, not get
/// bounced to a path they did not ask for. Every other path on the apex belongs
/// to the app, so it is redirected there rather than 404ing.
const APP_PREFIX = 'app.';

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase().split(':')[0];
  const { pathname, search } = req.nextUrl;

  // localhost, Vercel preview URLs, anything not the real domain: no split at
  // all. A preview that behaved differently from production would be worse than
  // no preview, and local dev must keep serving every route from one origin.
  if (!host.endsWith('proofstream.site')) return NextResponse.next();

  const isApp = host.startsWith(APP_PREFIX);
  const appHost = isApp ? host : `${APP_PREFIX}${host}`;
  const landingHost = isApp ? host.slice(APP_PREFIX.length) : host;

  if (!isApp) {
    if (pathname === '/') {
      return NextResponse.rewrite(new URL('/landing', req.url));
    }
    return NextResponse.redirect(`https://${appHost}${pathname}${search}`, 308);
  }

  // The app never shows the landing page: one canonical address for it, so a
  // link shared from a demo always lands somewhere that looks deliberate.
  if (pathname === '/landing') {
    return NextResponse.redirect(`https://${landingHost}/`, 308);
  }

  return NextResponse.next();
}

/// Skips Next's internals, the API routes (the GitHub callback must reach the
/// app host untouched) and anything with a file extension, so fonts, SVGs and
/// the favicon are never rewritten.
export const config = {
  matcher: ['/((?!_next/|api/|.*\\.).*)'],
};
