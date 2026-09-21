import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanionGrounding, groundingPromptBlock, nightclubPlayActive } from '../lib/companion/grounding.ts';
import { buildCompanionReply } from '../lib/companion/reply.ts';
import { flagshipKnowledge } from '../lib/companion/knowledge.ts';
import { parseOpenAiSseLine } from '../lib/companion/openai-stream.ts';

test('Nightclub grounding separates mechanics, fresh state, and unknown sight', () => {
  const g = buildCompanionGrounding({
    gameId: 'nightclub-showdown-inzone-production',
    nightclub: {
      source: 'nightclub_bridge',
      freshnessMs: 80,
      stale: false,
      runId: 'run-2',
      waveId: 1,
      ammo: 4,
      heroLife: 3,
      mobsAlive: 2,
    },
    previousRunId: 'run-1',
  });
  assert.equal(g.staleAdvice, true);
  assert.equal(g.runChanged, true);
  assert.ok(g.verifiedMechanics.some((line) => /Head shot/i.test(line)));
  assert.match(g.freshState || '', /4 ammo/);
  assert.ok(g.unknown.includes('enemy positions'));
  const prompt = groundingPromptBlock(g);
  assert.match(prompt, /Do not say aim for the head/i);
  assert.doesNotMatch(prompt, /(?:^|\n)Aim for the head/i);
  assert.equal(
    nightclubPlayActive({
      source: 'nightclub_bridge',
      freshnessMs: 80,
      stale: false,
      runId: 'run-2',
      ended: false,
      paused: false,
    }),
    true,
  );
});

test('active Nightclub run is play-active only on a fresh unpaused snapshot', () => {
  assert.equal(
    nightclubPlayActive({
      source: 'nightclub_bridge',
      freshnessMs: 40,
      stale: false,
      ended: false,
      paused: false,
      cinematic: false,
    }),
    true,
  );
  assert.equal(
    nightclubPlayActive({
      source: 'nightclub_bridge',
      freshnessMs: 40,
      stale: false,
      ended: true,
    }),
    false,
  );
});

test('scripted Nightclub replies drop stale ammo advice after restart', () => {
  const stale = buildCompanionReply({
    gameId: 'nightclub-showdown-inzone-production',
    intent: 'ask',
    transcript: 'how much ammo do I have',
    nightclub: { source: 'nightclub_bridge', freshnessMs: 20, stale: false, runId: 'run-3', ended: true },
    previousRunId: 'run-2',
  });
  assert.equal('error' in stale, false);
  if ('error' in stale) throw new Error('unexpected');
  assert.match(stale.text, /stale|run changed/i);
  assert.doesNotMatch(stale.text, /aim for the head/i);

  const knowledge = flagshipKnowledge('nightclub-showdown-inzone-production');
  assert.ok(knowledge);
  assert.doesNotMatch(knowledge.guidance.join(' '), /Aim for the head/i);
});

test('Kart and Escape Road stay instructions-only', () => {
  const kart = buildCompanionGrounding({ gameId: 'kart-bros', nightclub: null });
  assert.equal(kart.playActive, false);
  assert.equal(kart.freshState, null);
  const road = buildCompanionGrounding({ gameId: 'clescaperoad', nightclub: null });
  assert.ok(road.unknown.some((item) => /race|flight|bout|started/i.test(item)));
});

test('OpenAI SSE parser reads deltas and stops on DONE', () => {
  assert.equal(parseOpenAiSseLine('data: {"choices":[{"delta":{"content":"Hi"}}]}'), 'Hi');
  assert.equal(parseOpenAiSseLine('data: [DONE]'), null);
  assert.equal(parseOpenAiSseLine(''), undefined);
});
