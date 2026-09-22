#!/usr/bin/env node
/**
 * Live probe of the DEPLOYED Firestore rules for project inzone-f93e4, using
 * disposable accounts only. Proves the financial/lifecycle write exposure is
 * closed and that group chats are no longer world-readable. Read-only except
 * for its own throwaway docs, which it deletes.
 *
 * Run BEFORE deploying the hotfix (expect FAIL lines) and AFTER (expect PASS):
 *   FIREBASE_WEB_API_KEY=<inzone-f93e4 web key> node scripts/security/probe_firestore_rules.mjs
 *
 * The web API key is public (it ships in the app); this only exercises rules as
 * an ordinary signed-in user would. It never uses admin credentials.
 */
const API_KEY = process.env.FIREBASE_WEB_API_KEY;
const PROJECT = process.env.FIREBASE_PROJECT || 'inzone-f93e4';
if (!API_KEY) { console.error('Set FIREBASE_WEB_API_KEY'); process.exit(2); }

const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const IDP = 'https://identitytoolkit.googleapis.com/v1/accounts';

async function jf(url, { body, token, method } = {}) {
  const res = await fetch(url, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {}; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function signUp() {
  const email = `qa-rules-${Math.random().toString(36).slice(2, 10)}@qa.inzone.invalid`;
  const { status, data } = await jf(`${IDP}:signUp?key=${API_KEY}`, { body: { email, password: 'Zx' + Math.random().toString(36).slice(2) + '!9', returnSecureToken: true } });
  if (status !== 200) throw new Error('signUp failed: ' + JSON.stringify(data));
  return { uid: data.localId, token: data.idToken };
}
const patch = (path, fields, token) =>
  jf(`${FS}/${path}?` + Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&'),
     { method: 'PATCH', token, body: { fields } });
const intVal = (n) => ({ integerValue: String(n) });

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`); };

const a = await signUp();
const b = await signUp();
try {
  // Seed a minimal profile the legitimate way (no protected fields).
  await patch(`humanUsers/${a.uid}`, { name: { stringValue: 'QA A' } }, a.token);

  const mint = await patch(`humanUsers/${a.uid}`, { balance: intVal(999999) }, a.token);
  check('cannot mint own balance', mint.status === 403, `(got ${mint.status})`);

  const sub = await patch(`humanUsers/${a.uid}`, { subscription: { mapValue: { fields: { isSubscribed: { booleanValue: true } } } } }, a.token);
  check('cannot forge subscription', sub.status === 403, `(got ${sub.status})`);

  const editable = await patch(`humanUsers/${a.uid}`, { bio: { stringValue: 'legit profile edit' } }, a.token);
  check('can still edit profile fields', editable.status === 200, `(got ${editable.status})`);

  const other = await patch(`humanUsers/${b.uid}`, { balance: intVal(0) }, a.token);
  check("cannot write another user's doc", other.status === 403, `(got ${other.status})`);

  const gc = await jf(`${FS}/groupChats?pageSize=1`);  // unauthenticated
  check('group chats not world-readable', gc.status === 401 || gc.status === 403, `(got ${gc.status})`);
} finally {
  for (const u of [a, b]) {
    await jf(`${FS}/humanUsers/${u.uid}`, { token: u.token, method: 'DELETE' });
    await jf(`${IDP}:delete?key=${API_KEY}`, { body: { idToken: u.token } });
  }
}
console.log(failures === 0 ? '\nAll checks passed — rules are hardened.' : `\n${failures} check(s) failed — rules still expose data.`);
process.exit(failures === 0 ? 0 : 1);
