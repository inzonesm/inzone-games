import { NextResponse } from 'next/server';
import {
  SESSION_PROTOTYPE_REDIRECT_STATUS,
  sessionPrototypeRedirectLocation,
} from '@/lib/session-prototype-redirect';

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
