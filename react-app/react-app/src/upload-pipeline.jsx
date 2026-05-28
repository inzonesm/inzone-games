/* Upload Pipeline — Firebase Storage uploads, html_games writes,
 * and group-chat creation for the Upload portal.
 *
 * This runs entirely on the client using the Firebase JS compat SDK.
 * The gcloud-equivalent operations are:
 *   1. gcloud storage rm   gs://inzone-html/<slug>.html          (update only)
 *   2. gcloud storage cp   <local>  gs://inzone-html/<slug>.html
 *   3. generate download token + URL
 *   4. same for icon
 *   5. write html_games doc
 *   6. create groupChats doc
 *
 * Pre-reqs (loaded in index.html before this file):
 *   - firebase-storage-compat
 *   - window.inzoneFirebase.htmlStorage  (gs://inzone-html bucket)
 *   - window.inzoneFirebase.db           (Firestore client)
 */

const _slug = (value) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';

/* ── 1. Upload HTML game file to Firebase Storage ─────────────── */

/**
 * Uploads the HTML game file to gs://inzone-html/<slug>.html.
 * Returns { gameUrl, storageRef } on success.
 *
 * @param {File}     file       The .html game file from the file input.
 * @param {string}   slug       URL-safe game identifier.
 * @param {function} onProgress Called with (percent: number) during upload.
 */
async function uploadGameHtml(file, slug, onProgress) {
  const storage = window.inzoneFirebase.htmlStorage;
  if (!storage) throw new Error('Firebase Storage (inzone-html) not initialised');

  const ref = storage.ref(`${slug}.html`);

  // Delete previous version if it exists (equivalent to gcloud storage rm)
  try { await ref.delete(); } catch (e) { /* 404 is fine */ }

  return new Promise((resolve, reject) => {
    const task = ref.put(file, { contentType: 'text/html' });
    task.on(
      'state_changed',
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        if (onProgress) onProgress(Math.round(pct));
      },
      (err) => reject(err),
      async () => {
        const gameUrl = await ref.getDownloadURL();
        resolve({ gameUrl, storageRef: ref });
      },
    );
  });
}

/* ── 2. Upload game icon to Firebase Storage ──────────────────── */

/**
 * Uploads the icon to gs://inzone-html/<slug>-icon.<ext>.
 * Returns { iconUrl } or { iconUrl: '' } if no file provided.
 */
async function uploadGameIcon(file, slug) {
  if (!file) return { iconUrl: '' };
  const storage = window.inzoneFirebase.htmlStorage;
  if (!storage) throw new Error('Firebase Storage (inzone-html) not initialised');

  const ext = (file.name || 'icon.jpg').split('.').pop() || 'jpg';
  const ref = storage.ref(`${slug}-icon.${ext}`);

  // Remove old icon if present
  try { await ref.delete(); } catch (e) { /* 404 is fine */ }

  await ref.put(file, { contentType: file.type || 'image/jpeg' });
  const iconUrl = await ref.getDownloadURL();
  return { iconUrl };
}

/* ── 3. Write html_games Firestore document ───────────────────── */

/**
 * Creates or updates the html_games/<slug> document.
 *
 * @param {object} data  { slug, name, description, gameUrl, iconUrl, uploaderId, isUpdate }
 */
async function writeHtmlGame(data) {
  const db = window.inzoneFirebase.db;
  if (!db) throw new Error('Firestore not initialised');

  const doc = {
    name: data.name,
    description: data.description || '',
    gameUrl: data.gameUrl,
    iconUrl: data.iconUrl || '',
    uploaderId: data.uploaderId,
    status: 'approved',
  };

  if (data.isUpdate) {
    doc.updatedAt = window.firebase.firestore.FieldValue.serverTimestamp();
  } else {
    doc.createdAt = window.firebase.firestore.FieldValue.serverTimestamp();
  }

  await db.collection('html_games').doc(data.slug).set(doc, { merge: true });
  return data.slug;
}

/* ── 4. Create a dedicated group chat for the game ────────────── */

/**
 * Creates a groupChats document so the game has its own community chat.
 * Follows the schema from group_chat/manage_groups/ (Schema A style)
 * merged with the REST API schema from chat_service.py.
 *
 * @param {object} data  { slug, name, description, gameUrl, iconUrl, uploaderId, uploaderName }
 * @returns {string} The groupchat document ID.
 */
async function createGameGroupChat(data) {
  const db = window.inzoneFirebase.db;
  if (!db) throw new Error('Firestore not initialised');

  const docId = `game_${data.slug}_${Date.now()}`;

  await db.collection('groupChats').doc(docId).set({
    // Fields from chat_service.py create_groupchat schema
    groupchat_name: `${data.name} Community`,
    bio: data.description || `Official community chat for ${data.name}`,
    user_ids: [data.uploaderId],
    usernames: [data.uploaderName || 'Developer'],
    ai_usernames: [],
    messages: [],
    date_created: window.firebase.firestore.FieldValue.serverTimestamp(),
    groupchat_doc_id: docId,

    // Fields from manage_groups Schema A (richer metadata)
    name: `${data.name} Community`,
    description: data.description || `Play ${data.name} and chat with other players`,
    imageUrl: data.iconUrl || '',
    groupChatType: 'free',
    groupChatStatus: 'active',
    groupChatCategory: 'gaming',
    accessTier: 'Free',
    entryFee: 0,
    participants: [{
      uid: data.uploaderId,
      type: 'user',
      name: data.uploaderName || 'Developer',
    }],
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),

    // Game linkage (new fields — ties this chat to its html_game)
    gameId: data.slug,
    gameUrl: data.gameUrl,
    iconUrl: data.iconUrl || '',
  });

  return docId;
}

/* ── 5. Full pipeline — called by Upload.jsx ──────────────────── */

/**
 * Run the complete upload-to-live pipeline:
 *   1. Upload HTML to Firebase Storage
 *   2. Upload icon to Firebase Storage
 *   3. Write html_games document
 *   4. Create group chat (skip on update)
 *   5. Register with backend /api/game-sdk/games/register
 *
 * @param {object} opts
 * @param {File}     opts.htmlFile       The .html game file.
 * @param {File}     [opts.iconFile]     Game icon (optional).
 * @param {string}   opts.gameTitle      Human-readable title.
 * @param {string}   [opts.description]  One-liner for the store listing.
 * @param {string}   opts.uploaderId     Firebase UID of the developer.
 * @param {string}   [opts.uploaderName] Developer display name.
 * @param {boolean}  [opts.isUpdate]     True when updating an existing game.
 * @param {function} [opts.onProgress]   Progress callback (percent).
 * @param {function} [opts.onStep]       Step callback (stepIndex, meta).
 * @returns {Promise<object>} { gameUrl, iconUrl, gameKey, groupChatId, slug }
 */
async function runUploadPipeline(opts) {
  const slug = _slug(opts.gameTitle);
  const step = opts.onStep || (() => {});

  // Step 0: Upload received
  step(0, { slug });

  // Step 1: Upload HTML to Firebase Storage
  step(1, { message: 'Uploading game to Firebase Storage' });
  const { gameUrl } = await uploadGameHtml(opts.htmlFile, slug, opts.onProgress);

  // Step 2: Upload icon (if provided)
  step(2, { message: 'Uploading game icon' });
  const { iconUrl } = await uploadGameIcon(opts.iconFile || null, slug);

  // Step 3: Write html_games document
  step(3, { message: 'Writing to html_games collection' });
  await writeHtmlGame({
    slug,
    name: opts.gameTitle,
    description: opts.description || '',
    gameUrl,
    iconUrl,
    uploaderId: opts.uploaderId,
    isUpdate: opts.isUpdate,
  });

  // Step 4: Create group chat (only for new games, not updates)
  let groupChatId = null;
  if (!opts.isUpdate) {
    step(4, { message: 'Creating game community chat' });
    groupChatId = await createGameGroupChat({
      slug,
      name: opts.gameTitle,
      description: opts.description || '',
      gameUrl,
      iconUrl,
      uploaderId: opts.uploaderId,
      uploaderName: opts.uploaderName || 'Developer',
    });
  } else {
    step(4, { message: 'Skipping group chat (update)' });
  }

  // Step 5: Register with backend (game_registry + game_developers)
  step(5, { message: 'Registering with InZone backend' });
  let backendResult = { source: 'skipped' };
  try {
    backendResult = await window.inzoneAPI.registerGame({
      gameTitle: opts.gameTitle,
      summary: opts.description || '',
      developerName: opts.uploaderName || 'Developer',
      iconPreviewUrl: iconUrl,
      gameIconFile: null,
      bundleFile: null,
    });
  } catch (err) {
    // Backend registration is optional — the html_games doc is the source of truth
    console.warn('Backend register failed (non-fatal):', err);
    backendResult = { source: 'local', gameKey: `gk_${slug}_${Math.random().toString(36).slice(2, 8)}` };
  }

  return {
    slug,
    gameUrl,
    iconUrl,
    gameKey: backendResult.gameKey || backendResult.gameId || slug,
    liveUrl: gameUrl,
    groupChatId,
    source: backendResult.source,
  };
}

/* ── 6. Check if a game already exists (for update detection) ─── */

async function getExistingHtmlGame(slug) {
  const db = window.inzoneFirebase.db;
  if (!db) return null;
  try {
    const doc = await db.collection('html_games').doc(slug).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch {
    return null;
  }
}

/** List all games uploaded by a specific developer. */
async function listDeveloperHtmlGames(uploaderId) {
  const db = window.inzoneFirebase.db;
  if (!db) return [];
  try {
    const snap = await db.collection('html_games')
      .where('uploaderId', '==', uploaderId)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

// Expose on window for the script-tag architecture
window.uploadPipeline = {
  uploadGameHtml,
  uploadGameIcon,
  writeHtmlGame,
  createGameGroupChat,
  runUploadPipeline,
  getExistingHtmlGame,
  listDeveloperHtmlGames,
  slugify: _slug,
};
