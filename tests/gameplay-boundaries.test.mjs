import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGameplaySignal, emptyEngagement } from '../lib/gameplay-signals.ts';
import { startSignalFromProgress } from '../lib/game-adapters.ts';
function sequence(entries) {
 let state=emptyEngagement(), lastTick=null; const events=[];
 for (const [now,signal,visible=true] of entries) {
  const result=applyGameplaySignal({state,lastTick,now,signal,documentVisible:visible});
  state=result.state; lastTick=result.lastTick; events.push(...result.events);
 }
 return {state,events};
}
const start=runId=>({type:'start',runId});
const tick=(runId,fingerprint,active=true)=>({type:'progress',runId,fingerprint,active});
for (const boundary of ['hidden','paused']) test(boundary+' interval is not credited on resume',()=>{
 const result=sequence([[0,start('a')],[0,tick('a','0')],[1000,tick('a','1',boundary!=='paused'),boundary!=='hidden'],[2000,tick('a','2')],[3000,tick('a','3')]]);
 assert.equal(result.state.activeMs,1000);
});
test('time between different runs is not credited',()=>{
 const r=sequence([[0,start('a')],[0,tick('a','0')],[1000,start('b')],[2000,tick('b','1')],[3000,tick('b','2')]]);
 assert.equal(r.state.activeMs,1000);
});
test('game-over clears interval even before a later run starts',()=>{
 const r=sequence([[0,start('a')],[0,tick('a','0')],[1000,{type:'over',runId:'a'}],[2000,start('b')],[2000,tick('b','1')]]);
 assert.equal(r.state.activeMs,0);
});
test('hidden start is not a verified player',()=>{
 assert.deepEqual(sequence([[0,start('a'),false]]).events,[]);
});
test('inactive state change cannot synthesize a start',()=>{
 assert.equal(startSignalFromProgress('before',tick('a','after',false)),null);
});
