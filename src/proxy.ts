import { NextResponse, type NextRequest } from 'next/server';

// Passes the page's address to the server code, so requireUser can check it against the sub-categories the person was
// given (src/lib/access.ts). Nothing else happens here.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-rs-path', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!_next/|api/|favicon|logo|icons|manifest|sw\\.js|.*\\.(?:png|svg|jpg|ico|webmanifest)$).*)'] };
