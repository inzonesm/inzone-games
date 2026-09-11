import { NextResponse } from 'next/server';
import {
  SESSION_PROTOTYPE_REDIRECT_STATUS,
  sessionPrototypeRedirectLocation,
} from '@/lib/session-prototype-redirect';

/**
 * Legacy pre-PR-13 invite and campaign URLs. Fresh copies now use
 * `/games/{id}?session=`. Keep this 308 until traffic on the old path
 * is ~0 (target: two weeks after the follow-up PR merges), then delete.
 */

function redirectFrom(request: Request): NextResponse {
  const url = new URL(request.url);
  return NextResponse.redirect(
    sessionPrototypeRedirectLocation(url.origin, url.searchParams),
    SESSION_PROTOTYPE_REDIRECT_STATUS,
  );
}

export function GET(request: Request) {
  return redirectFrom(request);
}

export function HEAD(request: Request) {
  return redirectFrom(request);
}
