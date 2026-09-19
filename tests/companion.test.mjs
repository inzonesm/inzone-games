import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGSHIP_IDS } from '../lib/flagship-roster.ts';
import { COMPANION_KNOWLEDGE_VERSION, companionName } from '../lib/companion/config.ts';
import {
  allFlagshipKnowledge,
  flagshipKnowledge,
  knowledgePromptBlock,
} from '../lib/companion/knowledge.ts';
import {
  describeNightclubContext,
  sanitizeNightclubContext,
} from '../lib/companion/nightclub-context.ts';
import {
  beginCompanionTurn,
  companionLimitError,
  finishCompanionTurn,
  resetCompanionLimitsForTests,
} from '../lib/companion/limits.ts';
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  selectSpeechProvider,
} from '../lib/companion/providers.ts';
import { speechCacheKey } from '../lib/companion/cache.ts';
import { speakPrompt } from '../lib/companion/speak-prompt.ts';
import {
  CLIENT_SPEECH_CACHE_LIMIT,
  clientSpeechCacheSize,
  readClientSpeechCache,
  resetClientSpeechCacheForTests,
  writeClientSpeechCache,
} from '../lib/companion/client-speech-cache.ts';
import { buildCompanionReply } from '../lib/companion/reply.ts';
import {
  converseCompanion,
  resetCompanionSessionsForTests,
  sanitizeHistory,
  selectChatProvider,
} from '../lib/companion/converse.ts';
import { companionPublicHealth } from '../lib/companion/health.ts';
import { companionReserveAmounts } from '../lib/companion/config.ts';
import {
  QUOTA_LEASE_MS,
  REQUIRED_QUOTA_SETTING,
  emptyGlobalDoc,
  emptyLock,
  emptyUserDoc,
  paidQuotaReady,
  planReserve,
  planSettle,
  quotaBackend,
  reclaimExpiredReservations,
  requiredQuotaSetting,
  reserveCompanionUsage,
} from '../lib/companion/quota.ts';
import {
  CAMPAIGN_EVENTS,
  isVerifiedGameplayEvent,
  resetCampaignAnalyticsForTests,
  sanitizeData,
  setCampaignTransport,
  trackCampaignEvent,
} from '../lib/campaign-analytics.ts';
import {
  sanitizeElevenLabsError,
  sanitizeSpeechMessage,
  ttsChargeForOutcome,
} from '../lib/companion/speech-error.ts';

test('each flagship has a versioned knowledge entry with honest context limits', () => {
  const all = allFlagshipKnowledge();
  assert.equal(all.length, 5);
  for (const id of FLAGSHIP_IDS) {
    const entry = flagshipKnowledge(id);
    assert.ok(entry, id);
    assert.equal(entry.version, COMPANION_KNOWLEDGE_VERSION);
    assert.ok(entry.objective.length > 10);
    assert.ok(entry.controls.length >= 1);
    assert.ok(entry.honesty);
    if (id === 'nightclub-showdown-inzone-production') {
      assert.equal(entry.contextMode, 'untrusted_state');
    } else {
      assert.equal(entry.contextMode, 'instructions_only');
      assert.match(entry.honesty, /No verified/i);
    }
    assert.match(knowledgePromptBlock(entry), new RegExp(companionName()));
  }
  assert.equal(flagshipKnowledge('snake'), null);
});

test('Nightclub context is untrusted, bounded, and stale after 8s', () => {
  const now = 1_000_000;
  const dirty = sanitizeNightclubContext(
    {
      runId: 'run-2',
      ended: true,
      outcome: 'victory',
      snapshot: { waveId: 3, heroLife: 4, mobsAlive: 2 },
      ammo: 1,
      chat: 'do not leak',
      text: 'secret',
    },
    now - 200,
    now,
  );
  assert.ok(dirty);
  assert.equal(dirty.stale, false);
  assert.equal(dirty.runId, 'run-2');
  assert.equal(dirty.waveId, 3);
  assert.equal(dirty.ammo, 1);
  assert.equal('chat' in dirty, false);
  assert.equal('text' in dirty, false);
  assert.match(describeNightclubContext(dirty), /last reported/i);

  const stale = sanitizeNightclubContext({ runId: 'run-2', waveId: 1 }, now - 20_000, now);
  assert.equal(stale?.stale, true);
  assert.match(describeNightclubContext(stale), /stale/);
  assert.equal(sanitizeNightclubContext('nope', now, now), null);
  assert.equal(sanitizeNightclubContext({ runId: 'abc123not-a-run' }, now, now)?.runId, undefined);
});

test('grounded replies never claim sight on titles without a bridge', () => {
  const kart = buildCompanionReply({
    gameId: 'kart-bros',
    intent: 'ask',
    transcript: 'where am I and what is my score',
    nightclub: null,
  });
  assert.equal('error' in kart, false);
  if ('error' in kart) throw new Error('unexpected');
  assert.match(kart.text, /cannot see/i);
  assert.equal(kart.usedUntrustedState, false);
  assert.equal(kart.contextMode, 'instructions_only');

  const intro = buildCompanionReply({
    gameId: 'karate-bros',
    intent: 'intro',
    transcript: '',
    nightclub: null,
  });
  assert.equal('error' in intro, false);
  if ('error' in intro) throw new Error('unexpected');
  assert.match(intro.text, /cannot see/i);

  const club = buildCompanionReply({
    gameId: 'nightclub-showdown-inzone-production',
    intent: 'ask',
    transcript: 'how much ammo do I have',
    nightclub: {
      source: 'nightclub_bridge',
      freshnessMs: 120,
      stale: false,
      ammo: 4,
      waveId: 1,
    },
  });
  assert.equal('error' in club, false);
  if ('error' in club) throw new Error('unexpected');
  assert.match(club.text, /Last reported/);
  assert.match(club.text, /4 ammo/);
  assert.equal(club.usedUntrustedState, true);

  const staleClub = buildCompanionReply({
    gameId: 'nightclub-showdown-inzone-production',
    intent: 'ask',
    transcript: 'what wave is this',
    nightclub: { source: 'nightclub_bridge', freshnessMs: 20_000, stale: true, waveId: 9 },
  });
  assert.equal('error' in staleClub, false);
  if ('error' in staleClub) throw new Error('unexpected');
  assert.match(staleClub.text, /stale|missing/i);
  assert.equal(staleClub.usedUntrustedState, false);
});

test('companion limits bound concurrency, turns, and spend', () => {
  resetCompanionLimitsForTests();
  beginCompanionTurn('conc');
  assert.equal(companionLimitError('conc', 1), 'concurrency');
  finishCompanionTurn('conc', 0);

  resetCompanionLimitsForTests();
  let allowed = 0;
  while (companionLimitError('rate', 1) === null && allowed < 20) {
    beginCompanionTurn('rate');
    finishCompanionTurn('rate', 1);
    allowed += 1;
  }
  assert.equal(allowed, 12);
  assert.equal(companionLimitError('rate', 1), 'rate_limited');
});

test('speech provider prefers ElevenLabs when only the API key is set', async () => {
  assert.equal(selectSpeechProvider({}).provider, 'browser');
  const keyOnly = selectSpeechProvider({ ELEVENLABS_API_KEY: 'k' });
  assert.equal(keyOnly.provider, 'elevenlabs');
  assert.equal(keyOnly.voiceId, DEFAULT_ELEVENLABS_VOICE_ID);
  assert.equal(keyOnly.modelId, DEFAULT_ELEVENLABS_MODEL_ID);
  assert.equal(keyOnly.voiceSettings?.stability, 0.55);
  assert.equal(keyOnly.voiceSettings?.similarity_boost, 0.75);
  assert.equal(keyOnly.voiceSettings?.style, 0.25);
  assert.equal(keyOnly.voiceSettings?.use_speaker_boost, true);
  assert.equal(
    selectSpeechProvider({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_VOICE_ID: 'voice' }).voiceId,
    'voice',
  );
  assert.equal(
    selectSpeechProvider({
      ELEVENLABS_API_KEY: 'k',
      NEXT_PUBLIC_VOICE_PROVIDER: 'web-speech',
    }).provider,
    'browser',
  );
  assert.equal(
    selectSpeechProvider({
      ELEVENLABS_API_KEY: 'k',
      NEXT_PUBLIC_VOICE_PROVIDER: 'elevenlabs',
    }).provider,
    'elevenlabs',
  );
  assert.equal(selectSpeechProvider({ OPENAI_API_KEY: 'sk' }).provider, 'openai');
  const blockedSpeech = await speakPrompt('hello there', {
    allowPaidSpeech: false,
    env: { ELEVENLABS_API_KEY: 'k' },
  });
  assert.equal(blockedSpeech.provider, 'browser');
  const a = speechCacheKey({
    text: 'hello!',
    provider: 'elevenlabs',
    voiceId: 'voice',
    modelId: 'eleven_turbo_v2',
    language: 'en-US',
    settings: 'stb:0.55',
  });
  const b = speechCacheKey({
    text: 'hello.',
    provider: 'elevenlabs',
    voiceId: 'voice',
    modelId: 'eleven_turbo_v2',
    language: 'en-US',
    settings: 'stb:0.55',
  });
  const c = speechCacheKey({
    text: 'hello!',
    provider: 'elevenlabs',
    voiceId: 'voice',
    modelId: 'eleven_multilingual_v2',
    language: 'en-US',
    settings: 'stb:0.55',
  });
  assert.match(a, /^[a-f0-9]{40}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('client speech cache is a 24-entry LRU', () => {
  resetClientSpeechCacheForTests();
  for (let i = 0; i < CLIENT_SPEECH_CACHE_LIMIT + 2; i += 1) {
    writeClientSpeechCache(`k${i}`, new Blob([String(i)]));
  }
  assert.equal(clientSpeechCacheSize(), CLIENT_SPEECH_CACHE_LIMIT);
  assert.equal(readClientSpeechCache('k0'), null);
  assert.ok(readClientSpeechCache('k2'));
});

test('chat provider is separate from speech and scripted replies stay the fallback', async () => {
  assert.equal(selectChatProvider({}).provider, 'none');
  assert.equal(selectChatProvider({ OPENAI_API_KEY: 'sk' }).provider, 'openai');
  assert.equal(selectChatProvider({ OPENAI_API_KEY: 'sk' }).modelId, 'gpt-4o-mini');
  assert.equal(quotaBackend({}), 'process_local');
  assert.equal(quotaBackend({ FIREBASE_SERVICE_ACCOUNT: '{}' }), 'firestore');
  assert.equal(paidQuotaReady({}), false);
  assert.equal(paidQuotaReady({ FIREBASE_SERVICE_ACCOUNT: '{}' }), true);
  assert.equal(requiredQuotaSetting(), 'FIREBASE_SERVICE_ACCOUNT');
  assert.equal(REQUIRED_QUOTA_SETTING, 'FIREBASE_SERVICE_ACCOUNT');
  const blockedHealth = companionPublicHealth({
    OPENAI_API_KEY: 'sk-not-printed',
    ELEVENLABS_API_KEY: 'xi-not-printed',
  });
  assert.equal(blockedHealth.paidChatConfigured, true);
  assert.equal(blockedHealth.paidSpeechConfigured, true);
  assert.equal(blockedHealth.paidQuotaReady, false);
  assert.equal(blockedHealth.quotaUnavailable, true);
  assert.equal(blockedHealth.requiredSetting, 'FIREBASE_SERVICE_ACCOUNT');
  assert.equal(JSON.stringify(blockedHealth).includes('sk-not-printed'), false);
  assert.equal(JSON.stringify(blockedHealth).includes('xi-not-printed'), false);
  const readyHealth = companionPublicHealth({
    OPENAI_API_KEY: 'sk-not-printed',
    FIREBASE_SERVICE_ACCOUNT: '{}',
  });
  assert.equal(readyHealth.paidQuotaReady, true);
  assert.equal(readyHealth.quotaUnavailable, false);
  assert.equal(readyHealth.requiredSetting, null);

  resetCompanionSessionsForTests();
  const first = await converseCompanion({
    uid: 'u1',
    gameId: 'kart-bros',
    intent: 'ask',
    transcript: 'how do I play this',
    nightclub: null,
    env: {},
  });
  assert.equal('error' in first, false);
  if ('error' in first) throw new Error('unexpected');
  assert.equal(first.replySource, 'scripted_fallback');
  assert.equal(first.modelProvider, 'none');
  assert.equal(first.fallbackReason, 'provider_unconfigured');
  assert.equal(first.chatCharsUsed, 0);
  assert.match(first.text, /lobby|Invalid code|cannot see/i);

  const follow = await converseCompanion({
    uid: 'u1',
    gameId: 'kart-bros',
    intent: 'ask',
    transcript: 'what about that room code then',
    nightclub: null,
    history: [
      { role: 'user', text: 'how do I play this' },
      { role: 'assistant', text: first.text },
    ],
    env: {},
  });
  assert.equal('error' in follow, false);
  if ('error' in follow) throw new Error('unexpected');
  assert.equal(follow.replySource, 'scripted_fallback');
  assert.match(follow.text, /same limits/i);

  const history = sanitizeHistory([
    { role: 'user', text: 'one' },
    { role: 'assistant', text: 'two' },
    { role: 'nope', text: 'drop' },
    { role: 'user', text: '   ' },
  ]);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');

  const blockedPaid = await converseCompanion({
    uid: 'u-block',
    gameId: 'kart-bros',
    intent: 'ask',
    transcript: 'how do I play this',
    nightclub: null,
    env: { OPENAI_API_KEY: 'sk-not-used' },
    allowPaidChat: false,
    paidBlockReason: 'quota_unavailable',
  });
  assert.equal('error' in blockedPaid, false);
  if ('error' in blockedPaid) throw new Error('unexpected');
  assert.equal(blockedPaid.replySource, 'scripted_fallback');
  assert.equal(blockedPaid.modelProvider, 'openai');
  assert.equal(blockedPaid.fallbackReason, 'quota_unavailable');
  assert.equal(blockedPaid.chatCharsUsed, 0);
});

test('paid reserve refuses process-local and splits chat from TTS', async () => {
  const denied = await reserveCompanionUsage('uid', { chatChars: 80, ttsChars: 40 }, Date.now(), {});
  assert.equal(denied.ok, false);
  if (denied.ok) throw new Error('unexpected');
  assert.equal(denied.error, 'quota_unavailable');
  assert.equal(denied.backend, 'process_local');
  assert.equal(denied.requiredSetting, 'FIREBASE_SERVICE_ACCOUNT');

  const now = 1_700_000_000_000;
  const uid = 'quota-user';
  const day = '2023-11-14';
  const reserved = planReserve({
    user: emptyUserDoc(uid, day, now),
    global: emptyGlobalDoc(day, now),
    lock: emptyLock(uid, now),
    uid,
    day,
    amounts: { chatChars: 120, ttsChars: 40 },
    now,
    reservationId: 'res-1',
  });
  assert.equal(reserved.ok, true);
  if (!reserved.ok) throw new Error('unexpected');
  assert.equal(reserved.user.chatChars, 120);
  assert.equal(reserved.user.ttsChars, 40);
  assert.equal(reserved.global.chatChars, 120);
  assert.equal(reserved.global.ttsChars, 40);
  assert.equal(reserved.reservation.settled, false);
  assert.equal(reserved.lock.reservationId, 'res-1');

  const chatOnlyCap = planReserve({
    user: { ...emptyUserDoc(uid, day, now), chatChars: 39_900, ttsChars: 0 },
    global: emptyGlobalDoc(day, now),
    lock: emptyLock(uid, now),
    uid,
    day,
    amounts: { chatChars: 200, ttsChars: 10 },
    now,
    reservationId: 'res-chat',
  });
  assert.equal(chatOnlyCap.ok, false);
  if (chatOnlyCap.ok) throw new Error('unexpected');
  assert.equal(chatOnlyCap.error, 'spend_limited');

  const ttsOnlyCap = planReserve({
    user: { ...emptyUserDoc(uid, day, now), chatChars: 0, ttsChars: 19_900 },
    global: emptyGlobalDoc(day, now),
    lock: emptyLock(uid, now),
    uid,
    day,
    amounts: { chatChars: 10, ttsChars: 200 },
    now,
    reservationId: 'res-tts',
  });
  assert.equal(ttsOnlyCap.ok, false);
  if (ttsOnlyCap.ok) throw new Error('unexpected');
  assert.equal(ttsOnlyCap.error, 'spend_limited');

  const committed = planSettle({
    user: reserved.user,
    global: reserved.global,
    lock: reserved.lock,
    reservationId: 'res-1',
    actual: { chatChars: 90, ttsChars: 25 },
    releaseTurn: false,
    now: now + 10,
  });
  assert.equal(committed.applied, true);
  assert.equal(committed.user.chatChars, 90);
  assert.equal(committed.user.ttsChars, 25);
  assert.equal(committed.user.reservations['res-1'], undefined);
  assert.equal(committed.lock.inflight, 0);

  const duplicate = planSettle({
    user: committed.user,
    global: committed.global,
    lock: committed.lock,
    reservationId: 'res-1',
    actual: { chatChars: 0, ttsChars: 0 },
    releaseTurn: true,
    now: now + 20,
  });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.user.chatChars, 90);
  assert.equal(duplicate.user.ttsChars, 25);
  assert.equal(duplicate.user.turns, reserved.user.turns);

  const live = planReserve({
    user: emptyUserDoc(uid, day, now),
    global: emptyGlobalDoc(day, now),
    lock: emptyLock(uid, now),
    uid,
    day,
    amounts: { chatChars: 50, ttsChars: 30 },
    now,
    reservationId: 'res-exp',
  });
  assert.equal(live.ok, true);
  if (!live.ok) throw new Error('unexpected');
  const expired = reclaimExpiredReservations(
    live.user,
    live.global,
    live.lock,
    now + QUOTA_LEASE_MS + 1,
  );
  assert.deepEqual(expired.reclaimed, ['res-exp']);
  assert.equal(expired.user.chatChars, 0);
  assert.equal(expired.user.ttsChars, 0);
  assert.equal(expired.user.turns, 0);
  assert.equal(expired.lock.inflight, 0);
  const lateSettle = planSettle({
    user: expired.user,
    global: expired.global,
    lock: expired.lock,
    reservationId: 'res-exp',
    actual: { chatChars: 50, ttsChars: 30 },
    releaseTurn: false,
    now: now + QUOTA_LEASE_MS + 2,
  });
  assert.equal(lateSettle.applied, false);
  assert.equal(lateSettle.user.chatChars, 0);
  assert.ok(companionReserveAmounts().chatChars > companionReserveAmounts().ttsChars);

  const ttsFailReserve = planReserve({
    user: emptyUserDoc(uid, day, now),
    global: emptyGlobalDoc(day, now),
    lock: emptyLock(uid, now),
    uid,
    day,
    amounts: { chatChars: 2360, ttsChars: 280 },
    now,
    reservationId: 'res-tts-fail',
  });
  assert.equal(ttsFailReserve.ok, true);
  if (!ttsFailReserve.ok) throw new Error('unexpected');
  assert.equal(ttsFailReserve.user.ttsChars, 280);
  const ttsFailedSettle = planSettle({
    user: ttsFailReserve.user,
    global: ttsFailReserve.global,
    lock: ttsFailReserve.lock,
    reservationId: 'res-tts-fail',
    actual: { chatChars: 196, ttsChars: 0 },
    releaseTurn: false,
    now: now + 5,
  });
  assert.equal(ttsFailedSettle.applied, true);
  assert.equal(ttsFailedSettle.user.chatChars, 196);
  assert.equal(ttsFailedSettle.user.ttsChars, 0);
  assert.equal(ttsFailedSettle.user.turns, 1);
  assert.equal(ttsFailedSettle.user.reservations['res-tts-fail'], undefined);
  const ttsFailAgain = planSettle({
    user: ttsFailedSettle.user,
    global: ttsFailedSettle.global,
    lock: ttsFailedSettle.lock,
    reservationId: 'res-tts-fail',
    actual: { chatChars: 0, ttsChars: 280 },
    releaseTurn: false,
    now: now + 6,
  });
  assert.equal(ttsFailAgain.applied, false);
  assert.equal(ttsFailAgain.user.ttsChars, 0);
  assert.equal(ttsFailAgain.user.turns, 1);
  let turnsAfterFail = ttsFailedSettle.user.turns;
  let userAfterFail = ttsFailedSettle.user;
  let globalAfterFail = ttsFailedSettle.global;
  for (let i = 0; i < 20 && turnsAfterFail < 12; i += 1) {
    const next = planReserve({
      user: userAfterFail,
      global: globalAfterFail,
      lock: emptyLock(uid, now + 10 + i),
      uid,
      day,
      amounts: { chatChars: 10, ttsChars: 10 },
      now: now + 10 + i,
      reservationId: `res-retry-${i}`,
    });
    assert.equal(next.ok, true);
    if (!next.ok) throw new Error('unexpected');
    userAfterFail = next.user;
    globalAfterFail = next.global;
    turnsAfterFail = next.user.turns;
  }
  assert.equal(turnsAfterFail, 12);
  const blockedRetry = planReserve({
    user: userAfterFail,
    global: globalAfterFail,
    lock: emptyLock(uid, now + 40),
    uid,
    day,
    amounts: { chatChars: 10, ttsChars: 10 },
    now: now + 40,
    reservationId: 'res-retry-blocked',
  });
  assert.equal(blockedRetry.ok, false);
  if (blockedRetry.ok) throw new Error('unexpected');
  assert.equal(blockedRetry.error, 'rate_limited');
});

test('ElevenLabs errors keep status/code/requestId and drop secrets plus spoken text', () => {
  const dirty = sanitizeElevenLabsError({
    httpStatus: 401,
    body: {
      detail: {
        status: 'invalid_api_key',
        message: 'Invalid API key sk-secretvalue123 for text "How do I play Kart Bros with a lobby code?"',
        request_id: 'req_abc123xyz',
        param: 'voice_settings',
      },
    },
    requestIdHeader: 'hdr_req_99',
    modelId: 'eleven_turbo_v2',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
  });
  assert.equal(dirty.httpStatus, 401);
  assert.equal(dirty.code, 'invalid_api_key');
  assert.equal(dirty.requestId, 'hdr_req_99');
  assert.equal(dirty.param, 'voice_settings');
  assert.equal(dirty.ownerSetting, 'ELEVENLABS_API_KEY');
  assert.equal(dirty.ttsProviderCharge, 'unknown');
  assert.match(dirty.message, /\[redacted\]/);
  assert.equal(dirty.message.includes('sk-secretvalue123'), false);
  assert.equal(dirty.message.includes('How do I play Kart Bros'), false);
  assert.equal(JSON.stringify(dirty).includes('xi-api-key'), false);

  const credits = sanitizeElevenLabsError({
    httpStatus: 402,
    body: { detail: { status: 'insufficient_credits', message: 'You do not have enough credits', request_id: 'req_cred' } },
    modelId: 'eleven_turbo_v2',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
  });
  assert.equal(credits.code, 'insufficient_credits');
  assert.equal(credits.requestId, 'req_cred');
  assert.match(credits.ownerSetting || '', /credits/i);

  const settings = sanitizeElevenLabsError({
    httpStatus: 400,
    body: { detail: { status: 'invalid_voice_settings', message: 'style is not supported', param: 'style' } },
  });
  assert.equal(settings.code, 'invalid_voice_settings');
  assert.equal(settings.param, 'style');
  assert.equal(settings.ownerSetting, null);

  const unknown = sanitizeElevenLabsError({
    httpStatus: 500,
    body: { detail: { status: 'totally_new_internal_code', message: 'Bearer eyJabc.def.ghi and AIzaSyDummyKeyValue' } },
  });
  assert.equal(unknown.code, 'upstream_error');
  assert.equal(unknown.message.includes('Bearer'), false);
  assert.equal(unknown.message.includes('AIza'), false);
  assert.equal(sanitizeSpeechMessage('plain short error'), 'plain short error');
  assert.equal(ttsChargeForOutcome({ failed: true, provider: 'browser' }), 'unknown');
  assert.equal(ttsChargeForOutcome({ failed: false, provider: 'browser' }), 'none');
  assert.equal(ttsChargeForOutcome({ failed: false, provider: 'elevenlabs', cached: true }), 'none');
  assert.equal(ttsChargeForOutcome({ failed: false, provider: 'elevenlabs', cached: false }), 'billed');
});

test('companion analytics never carry transcript and never count as verified play', () => {
  resetCampaignAnalyticsForTests();
  const events = [];
  setCampaignTransport((event) => events.push(event));
  for (const name of [
    CAMPAIGN_EVENTS.companionIntro,
    CAMPAIGN_EVENTS.companionTurn,
    CAMPAIGN_EVENTS.companionListen,
    CAMPAIGN_EVENTS.companionAudioFail,
  ]) {
    assert.equal(isVerifiedGameplayEvent(name), false, name);
  }
  const clean = sanitizeData({
    game_id: 'kart-bros',
    transcript: 'how do I steer',
    text: 'player said a secret',
    companion_state: 'listening',
    companion_provider: 'browser',
    companion_model: 'none',
    companion_reply_source: 'scripted_fallback',
    latency_ms: 240,
    outcome: 'ok',
  });
  assert.equal(clean.game_id, 'kart-bros');
  assert.equal(clean.companion_state, 'listening');
  assert.equal(clean.companion_provider, 'browser');
  assert.equal(clean.companion_model, 'none');
  assert.equal(clean.companion_reply_source, 'scripted_fallback');
  assert.equal(clean.latency_ms, 240);
  assert.equal(clean.text, undefined);
  assert.equal(clean.transcript, undefined);
  trackCampaignEvent(CAMPAIGN_EVENTS.companionTurn, {
    game_id: 'kart-bros',
    transcript: 'do not ship this',
    companion_state: 'thinking',
    companion_provider: 'browser',
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].data.transcript, undefined);
  assert.equal(events[0].data.companion_state, 'thinking');
});
