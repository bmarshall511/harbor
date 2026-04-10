/**
 * Lightbox state machine — pure, framework-free.
 *
 * The Lightbox component delegates every keyboard decision and every
 * slideshow timing decision to the helpers in this file. Because they
 * are pure functions over plain inputs, every behaviour the Lightbox
 * needs in the real running app can be unit-tested in plain Node.
 */

// ─── Reducer ──────────────────────────────────────────────────────

export interface LightboxState {
  slideshowOn: boolean;
  delaySec: number;
}

export type LightboxAction =
  | { type: 'TOGGLE_SLIDESHOW' }
  | { type: 'SET_SLIDESHOW'; on: boolean }
  | { type: 'SET_DELAY'; sec: number };

export const initialLightboxState: LightboxState = {
  slideshowOn: false,
  delaySec: 3,
};

export function lightboxReducer(state: LightboxState, action: LightboxAction): LightboxState {
  switch (action.type) {
    case 'TOGGLE_SLIDESHOW':
      return { ...state, slideshowOn: !state.slideshowOn };
    case 'SET_SLIDESHOW':
      return state.slideshowOn === action.on ? state : { ...state, slideshowOn: action.on };
    case 'SET_DELAY':
      return state.delaySec === action.sec ? state : { ...state, delaySec: action.sec };
    default:
      return state;
  }
}

// ─── Keyboard ─────────────────────────────────────────────────────

export type LightboxKeyAction =
  | 'next'
  | 'prev'
  | 'close'
  | 'toggle-slideshow'
  | 'toggle-theater'
  | 'toggle-mute'
  | null;

/** Minimal structural shape we read off a keyboard event target. */
export type KeyEventTargetLike = { tagName?: string; isContentEditable?: boolean } | null;

/**
 * True if the event target is a text-entry element we should never
 * intercept (so users can type into search boxes, collection-name
 * fields, etc.).
 */
export function isTextEntryTarget(target: KeyEventTargetLike | EventTarget | unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Map a raw keyboard key plus its target to a Lightbox action.
 * Returns `null` for keys we should not handle (so the caller knows
 * to leave the event alone).
 */
export function keyToAction(
  key: string,
  target: KeyEventTargetLike | EventTarget | unknown,
): LightboxKeyAction {
  if (isTextEntryTarget(target)) return null;
  switch (key) {
    case 'ArrowRight':
      return 'next';
    case 'ArrowLeft':
      return 'prev';
    case 'Escape':
      return 'close';
    case ' ':
    case 'Spacebar':
      return 'toggle-slideshow';
    case 't':
    case 'T':
      return 'toggle-theater';
    case 'm':
    case 'M':
      return 'toggle-mute';
    default:
      return null;
  }
}

// ─── Slideshow timing ─────────────────────────────────────────────

/**
 * Should the image-advance timer be armed right now?
 * Videos do NOT use this timer — they advance via `onEnded`.
 */
export function shouldArmImageTimer(args: {
  slideshowOn: boolean;
  category: string | null;
  hasNext: boolean;
}): boolean {
  return args.slideshowOn && args.category === 'image' && args.hasNext;
}

/**
 * When a video finishes playing, should we auto-advance to the next item?
 */
export function shouldAdvanceOnVideoEnd(args: {
  slideshowOn: boolean;
  hasNext: boolean;
}): boolean {
  return args.slideshowOn && args.hasNext;
}

/**
 * Should the slideshow auto-stop right now? (Reached the end of the
 * list with an image — there is nothing further to advance to.)
 */
export function shouldAutoStopSlideshow(args: {
  slideshowOn: boolean;
  hasNext: boolean;
  category: string | null;
}): boolean {
  return args.slideshowOn && !args.hasNext && args.category === 'image';
}
