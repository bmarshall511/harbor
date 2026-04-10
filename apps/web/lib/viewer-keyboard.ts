/**
 * Viewer keyboard controller — pure, testable.
 *
 * This module owns the rule-set for what each key does inside the media
 * viewer. It deliberately knows nothing about React, the DOM, or focus.
 * The viewer component wires a real `keydown` listener to `decideKeyAction`
 * and dispatches the returned action.
 *
 * Keeping the rules pure means we can unit-test every keyboard scenario
 * (arrows, escape, space, edge of list, slideshow toggle, text-input
 * suppression) in plain Node without jsdom or a real browser.
 */

export type ViewerKeyAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'close' }
  | { type: 'toggle-slideshow' }
  | { type: 'ignore' };

/** Minimal shape we read from a KeyboardEvent. */
export interface ViewerKeyEventLike {
  key: string;
  target: { tagName?: string; isContentEditable?: boolean } | EventTarget | null;
}

/** State the controller needs to make a decision. */
export interface ViewerKeyState {
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Returns true if the event target is something we should never intercept
 * (text inputs, textareas, selects, contenteditable). Exported for tests.
 */
export function isEditableTarget(target: ViewerKeyEventLike['target']): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = target as { tagName?: string; isContentEditable?: boolean };
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Pure decision function: given a key event and the current viewer state,
 * decide what the viewer should do. Returns `ignore` for keys we don't
 * own or for events that originated in editable fields.
 */
export function decideKeyAction(
  e: ViewerKeyEventLike,
  state: ViewerKeyState,
): ViewerKeyAction {
  if (isEditableTarget(e.target)) return { type: 'ignore' };

  switch (e.key) {
    case 'ArrowRight':
      return state.hasNext ? { type: 'next' } : { type: 'ignore' };
    case 'ArrowLeft':
      return state.hasPrev ? { type: 'prev' } : { type: 'ignore' };
    case 'Escape':
      return { type: 'close' };
    case ' ':
    case 'Spacebar': // legacy IE/Edge
      return { type: 'toggle-slideshow' };
    default:
      return { type: 'ignore' };
  }
}

/**
 * Slideshow advance decision: given the current category and whether
 * the slideshow is active, return whether the timer-based image
 * advance should be armed.
 */
export function shouldArmSlideshowTimer(args: {
  slideshow: boolean;
  category: string | null;
  hasNext: boolean;
}): boolean {
  return args.slideshow && args.category === 'image' && args.hasNext;
}

/**
 * Decide whether a video that just ended should auto-advance.
 */
export function shouldAdvanceOnVideoEnd(args: {
  slideshow: boolean;
  hasNext: boolean;
}): boolean {
  return args.slideshow && args.hasNext;
}
