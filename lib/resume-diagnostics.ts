/**
 * Why a tap did or did not resume the game — recorded, not guessed.
 *
 * A device recording showed Nightclub Showdown holding its own "PAUSED — click
 * anywhere to resume" overlay for 29 seconds while taps landed near Restart.
 * That proves the overlay stayed up. It does not prove an ordinary tap on the
 * playable canvas failed, and the difference decides where the fix goes:
 *
 *   - taps that never reached the frame at all (host bar, a sheet, our overlay)
 *   - taps on the build's own HUD (Restart, Mute) which are not resume taps
 *   - taps on the playable canvas that the engine ignored
 *
 * Only the third is a defect in the resume path. The first two are a layout or
 * an expectation problem and would be fixed somewhere else entirely.
 *
 * WHAT THIS RECORDS, AND WHAT IT REFUSES TO
 * -----------------------------------------
 * Coordinates, element shape (tag, id, classes, test id), canvas bounds,
 * focus, visibility, the pause overlay, the companion hold, and whether the
 * engine's own paused flag changed afterwards.
 *
 * Never any text content. An element's text can be a chat message, a player
 * name or a transcript, so `describeTarget` copies structure and drops
 * `textContent` entirely. Nothing here is sent anywhere: there is no transport
 * in this module and the panel exports to the clipboard or a file only. It is
 * Preview-only and opt-in by query parameter, so it cannot follow anyone home.
 */

/** Where a pointer actually landed. */
export type TapZone =
  /** The playable surface: a canvas tap inside the canvas box. */
  | 'canvas'
  /** The build's own HUD inside the frame — Restart, Mute and friends. */
  | 'in-frame-hud'
  /** Somewhere else inside the frame. */
  | 'in-frame-other'
  /** Our persistent bar. */
  | 'host-bar'
  /** One of our sheets: More, Change game, Rook, session, comments. */
  | 'host-sheet'
  /** Our floating overlay layer, excluding sheets. */
  | 'host-overlay'
  /** Host chrome we did not name. */
  | 'host-other';

/** A single node on the path from the tap target upwards. Structure only. */
export type TargetNode = {
  tag: string;
  id?: string;
  classes?: string[];
  testId?: string;
};

export type TapPoint = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Copies an element's shape and nothing it says.
 *
 * `textContent` is deliberately absent: a button's label is harmless, but the
 * same walk passes through chat bubbles and captions, and a diagnostic that
 * sometimes captures a message is a diagnostic that captures messages.
 */
export function describeTarget(el: Element | null, maxDepth = 6): TargetNode[] {
  const out: TargetNode[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < maxDepth) {
    const classes = typeof node.className === 'string'
      ? node.className.split(/\s+/).filter(Boolean).slice(0, 6)
      : undefined;
    const testId = node.getAttribute?.('data-testid') ?? undefined;
    out.push({
      tag: node.tagName ? node.tagName.toLowerCase() : 'unknown',
      ...(node.id ? { id: node.id } : {}),
      ...(classes && classes.length ? { classes } : {}),
      ...(testId ? { testId } : {}),
    });
    node = node.parentElement;
    depth += 1;
  }
  return out;
}

function pathHas(path: TargetNode[], className: string): boolean {
  return path.some((n) => n.classes?.includes(className));
}

function inside(point: TapPoint, rect: Rect | null): boolean {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return (
    point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height
  );
}

/**
 * Classify a tap.
 *
 * The overlay in this build is drawn inside the canvas, so a tap on the words
 * "click anywhere to resume" is a canvas tap and is reported as one. That is
 * the whole point: if those taps are classified `canvas` and the engine still
 * does not resume, the resume path is at fault and nothing else is.
 */
export function classifyTap(input: {
  inFrame: boolean;
  path: TargetNode[];
  point: TapPoint;
  canvasRect: Rect | null;
}): TapZone {
  const { inFrame, path, point, canvasRect } = input;
  if (!inFrame) {
    if (pathHas(path, 'game-rail')) return 'host-bar';
    if (pathHas(path, 'player-sheet') || pathHas(path, 'rook-sheet')
      || pathHas(path, 'social-panel') || pathHas(path, 'comments-panel')) return 'host-sheet';
    if (pathHas(path, 'player-overlay')) return 'host-overlay';
    return 'host-other';
  }
  const onCanvasElement = path[0]?.tag === 'canvas';
  if (onCanvasElement && inside(point, canvasRect)) return 'canvas';
  if (inside(point, canvasRect) && !onCanvasElement) return 'in-frame-hud';
  if (path.some((n) => n.tag === 'button' || n.tag === 'a')) return 'in-frame-hud';
  return 'in-frame-other';
}

/** A pause reading, before or after a tap. */
export type PauseState = {
  mainPaused: boolean | null;
  overlay: boolean | null;
  iframeFocused: boolean | null;
  hold: boolean;
  visibility: string;
};

/** What the engine did with the tap. */
export type ResumeOutcome =
  /** The overlay cleared or the engine unpaused. */
  | 'resumed'
  /** The engine was already running; nothing to resume. */
  | 'already-running'
  /** Still paused afterwards. On a `canvas` tap this is the defect. */
  | 'ignored'
  /** The engine could not be read on one side of the tap. */
  | 'unknown';

export function resumeOutcome(before: PauseState, after: PauseState): ResumeOutcome {
  const pausedBefore = before.overlay === true || before.mainPaused === true;
  const pausedAfter = after.overlay === true || after.mainPaused === true;
  const readable = (s: PauseState) => s.overlay !== null || s.mainPaused !== null;
  if (!readable(before) || !readable(after)) return 'unknown';
  if (!pausedBefore) return 'already-running';
  return pausedAfter ? 'ignored' : 'resumed';
}

export type ResumeRecord = {
  /** Milliseconds since the diagnostic started. Never a wall clock. */
  at: number;
  zone: TapZone;
  point: TapPoint;
  canvasRect: Rect | null;
  path: TargetNode[];
  before: PauseState;
  after: PauseState;
  outcome: ResumeOutcome;
  hostFocused: boolean;
};

/**
 * The reading that matters, in one line: were there canvas taps, and did the
 * engine ignore them? Everything else in the log explains this answer.
 */
export function summarise(records: ResumeRecord[]): {
  taps: number;
  byZone: Record<string, number>;
  canvasTaps: number;
  canvasTapsIgnored: number;
  verdict: string;
} {
  const byZone: Record<string, number> = {};
  for (const r of records) byZone[r.zone] = (byZone[r.zone] ?? 0) + 1;
  const canvas = records.filter((r) => r.zone === 'canvas');
  const ignored = canvas.filter((r) => r.outcome === 'ignored');
  let verdict: string;
  if (canvas.length === 0) {
    verdict = 'No tap reached the playable canvas. The overlay staying up is expected, and the question is why taps landed elsewhere.';
  } else if (ignored.length === 0) {
    verdict = 'Every canvas tap resumed the game. The resume path is not at fault.';
  } else if (ignored.length === canvas.length) {
    verdict = 'Canvas taps reached the game and none resumed it. The resume path is at fault.';
  } else {
    verdict = `${ignored.length} of ${canvas.length} canvas taps were ignored — intermittent, so capture the state around the ignored ones.`;
  }
  return { taps: records.length, byZone, canvasTaps: canvas.length, canvasTapsIgnored: ignored.length, verdict };
}
