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
import {
  CLIENT_SPEECH_CACHE_LIMIT,
  clientSpeechCacheSize,
  readClientSpeechCache,
  resetClientSpeechCacheForTests,
  writeClientSpeechCache,
} from '../lib/companion/client-speech-cache.ts';
import { buildCompanionReply } from '../lib/companion/reply.ts';
import {
  CAMPAIGN_EVENTS,
  isVerifiedGameplayEvent,
  resetCampaignAnalyticsForTests,
  sanitizeData,
  setCampaignTransport,
  trackCampaignEvent,
} from '../lib/campaign-analytics.ts';

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

test('speech provider prefers ElevenLabs when only the API key is set', () => {
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
    latency_ms: 240,
    outcome: 'ok',
  });
  assert.equal(clean.game_id, 'kart-bros');
  assert.equal(clean.companion_state, 'listening');
  assert.equal(clean.companion_provider, 'browser');
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
