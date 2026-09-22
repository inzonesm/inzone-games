import { NextResponse, type NextRequest } from 'next/server';
import { readSpeechCache } from '@/lib/companion/cache';
import { verifyCompanionActor } from '@/lib/companion/identity';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const actor = await verifyCompanionActor(req.headers.get('authorization'));
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key')?.trim() || '';
  if (!/^[a-f0-9]{16,64}$/.test(key)) {
    return NextResponse.json({ error: 'invalid_key' }, { status: 400 });
  }
  const hit = readSpeechCache(key);
  if (!hit) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(new Uint8Array(hit.bytes), {
    headers: {
      'Content-Type': hit.contentType,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
