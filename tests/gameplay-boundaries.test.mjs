import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGameplaySignal, emptyEngagement, ACTIVITY_TIMEOUT_MS } from '../lib/gameplay-signals.ts';
import { progressStartKey, startSignalFromProgress } from '../lib/game-adapters.ts';
function sequence(entries) {
 let state=emptyEngagement(), lastTick=null, lastAction=null; const events=[];
 for (const [now,signal,visible=true] of entries) {
  const result=applyGameplaySignal({state,lastTick,lastAction,now,signal,documentVisible:visible});
  state=result.state; lastTick=result.lastTick; lastAction=result.lastAction; events.push(...result.events);
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
test('board churn with a stable actionFingerprint is not a start',()=>{
 const first={type:'progress',runId:'a',active:true,fingerprint:'wave1',actionFingerprint:'0'};
 const churn={type:'progress',runId:'a',active:true,fingerprint:'wave2',actionFingerprint:'0'};
 assert.equal(progressStartKey(first),'0');
 assert.equal(startSignalFromProgress(progressStartKey(first),churn),null);
});
test('time before a verified start is not credited even while the board changes',()=>{
 const boot={type:'progress',runId:'a',active:true,fingerprint:'0',actionFingerprint:'0'};
 const churn={type:'progress',runId:'a',active:true,fingerprint:'1',actionFingerprint:'0'};
 let state=emptyEngagement(), lastTick=null, lastAction=null;
 for (const [now, signal] of [[0,boot],[1000,churn],[2000,churn]]) {
  const r=applyGameplaySignal({state,lastTick,lastAction,now,signal,documentVisible:true});
  state=r.state; lastTick=r.lastTick; lastAction=r.lastAction;
 }
 assert.equal(state.activeMs,0);
 assert.deepEqual(state.startedRuns,[]);
});
test('autonomous fingerprint changes do not renew player-action grace',()=>{
 const action=(now,board,key='1')=>({type:'progress',runId:'a',active:true,fingerprint:board,actionFingerprint:key});
 let state=emptyEngagement(), lastTick=null, lastAction=null;
 const fold=(now,signal)=>{
  const r=applyGameplaySignal({state,lastTick,lastAction,now,signal,documentVisible:true});
  state=r.state; lastTick=r.lastTick; lastAction=r.lastAction;
 };
 fold(0,start('a'));
 fold(0,action(0,'b0'));
 for (let i=1;i<=8;i++) fold(i*1000,action(i*1000,'b'+i));
 assert.equal(state.activeMs,ACTIVITY_TIMEOUT_MS);
});
