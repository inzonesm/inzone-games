/**
 * Same-origin invite shim for hub games that are not on the isolated SDK host.
 *
 * Nightclub (and most first-party builds) check for window.InZoneSDK and call
 * sendChallenge / openChat. The isolated web SDK is opt-in and empty. Without
 * this shim the build surfaces a missing-SDK error on Invite.
 *
 * Privileged work stays in the trusted parent: this script only postMessages.
 * Tokens, Firebase config, and invented URLs never enter the game document.
 *
 * An existing InZoneSDK is never overwritten. Missing sendChallenge/openChat
 * are filled only when writable. Conversation membership is the only claim —
 * never a shared match join.
 */

import { GAME_INVITE_BRIDGE_MARKER, PLAY_INVITE_CHANNEL, PLAY_INVITE_PROTOCOL } from './play-invite.ts';

const INSTALL_SOURCE = String.raw`
(function (config) {
  if (window.__inzonePlayInvite) return;
  window.__inzonePlayInvite = true;

  var pending = new Map();
  var seq = 0;
  var targetOrigin = location.origin && location.origin !== 'null' ? location.origin : '*';
  var adopted = false;

  function sdkError(code) {
    var err = new Error(code);
    err.code = code;
    return err;
  }

  function callParent(method, payload) {
    if (window.parent === window) {
      return Promise.reject(sdkError('INZONE_HOST_UNAVAILABLE'));
    }
    return new Promise(function (resolve, reject) {
      var id = 'inv' + String(++seq);
      var timer = setTimeout(function () {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(sdkError('INZONE_HOST_TIMEOUT'));
      }, 20000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      parent.postMessage({
        channel: 'inzone-play-invite',
        v: 1,
        id: id,
        type: 'req',
        method: method,
        payload: payload || {}
      }, targetOrigin);
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.channel !== 'inzone-play-invite' || data.type !== 'res') return;
    var waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    clearTimeout(waiter.timer);
    if (data.ok) waiter.resolve(data.result);
    else {
      var code = data.error && data.error.code ? data.error.code : 'INZONE_HOST_ERROR';
      rejectSafe(waiter, sdkError(code));
    }
  });

  function rejectSafe(waiter, err) {
    waiter.reject(err);
  }

  function sendChallenge(payload) {
    return callParent('sendChallenge', payload);
  }

  function openChat(payload) {
    return callParent('openChat', payload);
  }

  function fillMissing(existing, name, fn) {
    if (!existing || typeof existing !== 'object') return;
    if (typeof existing[name] === 'function') return;
    try {
      existing[name] = fn;
    } catch (e) {
      /* frozen or non-writable — leave the existing SDK untouched */
    }
  }

  function conversationConfig() {
    return Promise.resolve({
      protocol: 1,
      gameId: config.gameId,
      isolation: 'same-origin-invite',
      capabilities: ['sendChallenge', 'openChat'],
      inviteScope: 'conversation',
      matchJoined: false
    });
  }

  function adopt() {
    var existing = window.InZoneSDK;
    if (existing && typeof existing === 'object') {
      fillMissing(existing, 'sendChallenge', sendChallenge);
      fillMissing(existing, 'openChat', openChat);
      return;
    }
    if (adopted) return;
    adopted = true;
    window.InZoneSDK = {
      sendChallenge: sendChallenge,
      openChat: openChat,
      getConfig: conversationConfig
    };
    window.dispatchEvent(new CustomEvent('inzone:sdk-ready', { detail: { inviteScope: 'conversation', matchJoined: false } }));
  }

  window.addEventListener('inzone:sdk-ready', function () { adopt(); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(adopt, 0); });
  } else {
    setTimeout(adopt, 0);
  }
  window.addEventListener('load', function () { adopt(); });
})
`;

export function gameInviteBridgeScript(gameId: string): string {
  return `(${INSTALL_SOURCE.trim()})(${JSON.stringify({ gameId, protocol: PLAY_INVITE_PROTOCOL, channel: PLAY_INVITE_CHANNEL })});`;
}

export function gameInviteBridgeTag(gameId: string): string {
  return `<script id="__inzone-play-invite">${gameInviteBridgeScript(gameId)}</script>`;
}

export { GAME_INVITE_BRIDGE_MARKER };
