import { describe, it, expect } from 'vitest';
import {
  initialLightboxState,
  lightboxReducer,
  keyToAction,
  isTextEntryTarget,
  shouldArmImageTimer,
  shouldAdvanceOnVideoEnd,
  shouldAutoStopSlideshow,
} from './lightbox-machine';

const div = { tagName: 'DIV' };
const input = { tagName: 'INPUT' };
const textarea = { tagName: 'TEXTAREA' };
const select = { tagName: 'SELECT' };
const editable = { tagName: 'DIV', isContentEditable: true };

describe('lightboxReducer', () => {
  it('starts in the default state', () => {
    expect(initialLightboxState).toEqual({ slideshowOn: false, delaySec: 3 });
  });

  it('TOGGLE_SLIDESHOW flips slideshowOn', () => {
    const a = lightboxReducer(initialLightboxState, { type: 'TOGGLE_SLIDESHOW' });
    expect(a.slideshowOn).toBe(true);
    const b = lightboxReducer(a, { type: 'TOGGLE_SLIDESHOW' });
    expect(b.slideshowOn).toBe(false);
  });

  it('SET_SLIDESHOW sets explicitly and is a no-op when already that value', () => {
    const a = lightboxReducer(initialLightboxState, { type: 'SET_SLIDESHOW', on: false });
    expect(a).toBe(initialLightboxState); // identity preserved
    const b = lightboxReducer(initialLightboxState, { type: 'SET_SLIDESHOW', on: true });
    expect(b.slideshowOn).toBe(true);
  });

  it('SET_DELAY changes delaySec and is a no-op when unchanged', () => {
    const a = lightboxReducer(initialLightboxState, { type: 'SET_DELAY', sec: 3 });
    expect(a).toBe(initialLightboxState);
    const b = lightboxReducer(initialLightboxState, { type: 'SET_DELAY', sec: 5 });
    expect(b.delaySec).toBe(5);
  });
});

describe('isTextEntryTarget', () => {
  it.each([
    ['input', input, true],
    ['textarea', textarea, true],
    ['select', select, true],
    ['contenteditable', editable, true],
    ['div', div, false],
    ['null', null, false],
  ])('classifies %s', (_label, target, expected) => {
    expect(isTextEntryTarget(target)).toBe(expected);
  });
});

describe('keyToAction', () => {
  it('maps navigation keys', () => {
    expect(keyToAction('ArrowRight', div)).toBe('next');
    expect(keyToAction('ArrowLeft', div)).toBe('prev');
    expect(keyToAction('Escape', div)).toBe('close');
  });
  it('maps both Space variants to slideshow toggle', () => {
    expect(keyToAction(' ', div)).toBe('toggle-slideshow');
    expect(keyToAction('Spacebar', div)).toBe('toggle-slideshow');
  });
  it('maps T to theater toggle (both cases)', () => {
    expect(keyToAction('t', div)).toBe('toggle-theater');
    expect(keyToAction('T', div)).toBe('toggle-theater');
  });
  it('maps M to mute toggle (both cases)', () => {
    expect(keyToAction('m', div)).toBe('toggle-mute');
    expect(keyToAction('M', div)).toBe('toggle-mute');
  });
  it('returns null for unrelated keys', () => {
    for (const k of ['a', 'Tab', 'Enter', 'PageUp', 'Home', 'End']) {
      expect(keyToAction(k, div)).toBe(null);
    }
  });
  it('returns null when target is a text input', () => {
    expect(keyToAction('ArrowRight', input)).toBe(null);
    expect(keyToAction(' ', input)).toBe(null);
    expect(keyToAction('Escape', textarea)).toBe(null);
    expect(keyToAction(' ', editable)).toBe(null);
    expect(keyToAction('t', input)).toBe(null);
    expect(keyToAction('m', textarea)).toBe(null);
  });
});

describe('shouldArmImageTimer', () => {
  it('arms only when slideshow is on AND current is image AND has next', () => {
    expect(shouldArmImageTimer({ slideshowOn: true, category: 'image', hasNext: true })).toBe(true);
    expect(shouldArmImageTimer({ slideshowOn: false, category: 'image', hasNext: true })).toBe(false);
    expect(shouldArmImageTimer({ slideshowOn: true, category: 'video', hasNext: true })).toBe(false);
    expect(shouldArmImageTimer({ slideshowOn: true, category: 'image', hasNext: false })).toBe(false);
  });
});

describe('shouldAdvanceOnVideoEnd', () => {
  it('advances only when slideshow is on AND has next', () => {
    expect(shouldAdvanceOnVideoEnd({ slideshowOn: true, hasNext: true })).toBe(true);
    expect(shouldAdvanceOnVideoEnd({ slideshowOn: false, hasNext: true })).toBe(false);
    expect(shouldAdvanceOnVideoEnd({ slideshowOn: true, hasNext: false })).toBe(false);
  });
});

describe('shouldAutoStopSlideshow', () => {
  it('auto-stops only at end of list with an image', () => {
    expect(shouldAutoStopSlideshow({ slideshowOn: true, hasNext: false, category: 'image' })).toBe(true);
    expect(shouldAutoStopSlideshow({ slideshowOn: true, hasNext: false, category: 'video' })).toBe(false);
    expect(shouldAutoStopSlideshow({ slideshowOn: true, hasNext: true, category: 'image' })).toBe(false);
    expect(shouldAutoStopSlideshow({ slideshowOn: false, hasNext: false, category: 'image' })).toBe(false);
  });
});

describe('end-to-end mixed sequence simulation', () => {
  type Item = { id: string; category: 'image' | 'video' };
  const items: Item[] = [
    { id: 'img-1', category: 'image' },
    { id: 'vid-1', category: 'video' },
    { id: 'img-2', category: 'image' },
    { id: 'vid-2', category: 'video' },
    { id: 'img-3', category: 'image' },
  ];

  function makeViewer() {
    let idx = 0;
    let state = initialLightboxState;
    const log: string[] = [];

    function press(key: string, target: unknown = div) {
      const action = keyToAction(key, target);
      switch (action) {
        case 'next':
          if (idx < items.length - 1) {
            idx++;
            log.push(`next→${items[idx].id}`);
          } else log.push('ignore:next-at-end');
          break;
        case 'prev':
          if (idx > 0) {
            idx--;
            log.push(`prev→${items[idx].id}`);
          } else log.push('ignore:prev-at-start');
          break;
        case 'close':
          log.push('close');
          break;
        case 'toggle-slideshow':
          state = lightboxReducer(state, { type: 'TOGGLE_SLIDESHOW' });
          log.push(`slideshow:${state.slideshowOn ? 'on' : 'off'}`);
          break;
        case 'toggle-theater':
        case 'toggle-mute':
          log.push(action);
          break;
        case null:
          log.push(`ignore:${key}`);
      }
    }

    function videoEnded() {
      const hasNext = idx < items.length - 1;
      if (shouldAdvanceOnVideoEnd({ slideshowOn: state.slideshowOn, hasNext })) {
        idx++;
        log.push(`video-end→${items[idx].id}`);
      }
    }

    function imageTimerFire() {
      const hasNext = idx < items.length - 1;
      const category = items[idx].category;
      if (shouldArmImageTimer({ slideshowOn: state.slideshowOn, category, hasNext })) {
        idx++;
        log.push(`timer→${items[idx].id}`);
      }
    }

    return {
      press,
      videoEnded,
      imageTimerFire,
      log,
      get current() { return items[idx]; },
      get state() { return state; },
    };
  }

  it('arrow navigation walks the entire sequence forwards and backwards', () => {
    const v = makeViewer();
    expect(v.current.id).toBe('img-1');
    v.press('ArrowRight'); expect(v.current.id).toBe('vid-1');
    v.press('ArrowRight'); expect(v.current.id).toBe('img-2');
    v.press('ArrowRight'); expect(v.current.id).toBe('vid-2');
    v.press('ArrowRight'); expect(v.current.id).toBe('img-3');
    v.press('ArrowRight'); expect(v.current.id).toBe('img-3'); // at end
    v.press('ArrowLeft');  expect(v.current.id).toBe('vid-2');
    v.press('ArrowLeft');  expect(v.current.id).toBe('img-2');
    v.press('ArrowLeft');  expect(v.current.id).toBe('vid-1');
    v.press('ArrowLeft');  expect(v.current.id).toBe('img-1');
    v.press('ArrowLeft');  expect(v.current.id).toBe('img-1'); // at start
  });

  it('Space toggles slideshow on and off', () => {
    const v = makeViewer();
    expect(v.state.slideshowOn).toBe(false);
    v.press(' ');
    expect(v.state.slideshowOn).toBe(true);
    v.press(' ');
    expect(v.state.slideshowOn).toBe(false);
  });

  it('Escape closes', () => {
    const v = makeViewer();
    v.press('Escape');
    expect(v.log).toEqual(['close']);
  });

  it('slideshow auto-advances images', () => {
    const v = makeViewer();
    v.press(' '); // slideshow on
    v.imageTimerFire(); // advance img-1 → vid-1
    expect(v.current.id).toBe('vid-1');
  });

  it('slideshow auto-advances videos via onEnded', () => {
    const v = makeViewer();
    v.press('ArrowRight'); // → vid-1
    v.press(' ');          // slideshow on
    v.videoEnded();
    expect(v.current.id).toBe('img-2');
  });

  it('without slideshow, video onEnded does not advance', () => {
    const v = makeViewer();
    v.press('ArrowRight'); // → vid-1
    v.videoEnded();
    expect(v.current.id).toBe('vid-1');
  });

  it('typing into an input is fully suppressed', () => {
    const v = makeViewer();
    v.press('ArrowRight', input);
    v.press(' ', input);
    v.press('Escape', input);
    expect(v.current.id).toBe('img-1');
    expect(v.state.slideshowOn).toBe(false);
    expect(v.log).toEqual(['ignore:ArrowRight', 'ignore: ', 'ignore:Escape']);
  });

  it('full slideshow run from img-1 ends naturally on img-3', () => {
    const v = makeViewer();
    v.press(' '); // slideshow on
    v.imageTimerFire(); // img-1 → vid-1
    v.videoEnded();     // vid-1 → img-2
    v.imageTimerFire(); // img-2 → vid-2
    v.videoEnded();     // vid-2 → img-3
    expect(v.current.id).toBe('img-3');
    // At end, image timer should NOT fire
    v.imageTimerFire();
    expect(v.current.id).toBe('img-3');
  });
});
