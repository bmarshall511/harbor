/**
 * Runtime-verification tests for the viewer keyboard controller.
 *
 * These exercise the exact rules the real <MediaViewer> uses for arrow
 * navigation, Escape, Spacebar slideshow, slideshow timer arming, and
 * video auto-advance. Because the controller is pure, these tests are
 * the source of truth for what the viewer must do for any keypress —
 * no React, no jsdom, no mocking required.
 */
import { describe, it, expect } from 'vitest';
import {
  decideKeyAction,
  isEditableTarget,
  shouldArmSlideshowTimer,
  shouldAdvanceOnVideoEnd,
} from './viewer-keyboard';

const div = { tagName: 'DIV' };
const input = { tagName: 'INPUT' };
const textarea = { tagName: 'TEXTAREA' };
const select = { tagName: 'SELECT' };
const editable = { tagName: 'DIV', isContentEditable: true };

const both = { hasPrev: true, hasNext: true };
const firstItem = { hasPrev: false, hasNext: true };
const lastItem = { hasPrev: true, hasNext: false };
const onlyItem = { hasPrev: false, hasNext: false };

describe('isEditableTarget', () => {
  it('treats inputs/textareas/selects/contenteditable as editable', () => {
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
    expect(isEditableTarget(editable)).toBe(true);
  });
  it('treats other elements as non-editable', () => {
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('decideKeyAction — navigation', () => {
  it('ArrowRight goes next when hasNext', () => {
    expect(decideKeyAction({ key: 'ArrowRight', target: div }, both))
      .toEqual({ type: 'next' });
  });
  it('ArrowRight is ignored at end of list', () => {
    expect(decideKeyAction({ key: 'ArrowRight', target: div }, lastItem))
      .toEqual({ type: 'ignore' });
  });
  it('ArrowLeft goes prev when hasPrev', () => {
    expect(decideKeyAction({ key: 'ArrowLeft', target: div }, both))
      .toEqual({ type: 'prev' });
  });
  it('ArrowLeft is ignored at start of list', () => {
    expect(decideKeyAction({ key: 'ArrowLeft', target: div }, firstItem))
      .toEqual({ type: 'ignore' });
  });
});

describe('decideKeyAction — Escape', () => {
  it('Escape always closes', () => {
    expect(decideKeyAction({ key: 'Escape', target: div }, both))
      .toEqual({ type: 'close' });
    expect(decideKeyAction({ key: 'Escape', target: div }, onlyItem))
      .toEqual({ type: 'close' });
  });
});

describe('decideKeyAction — Spacebar slideshow', () => {
  it('Space toggles slideshow', () => {
    expect(decideKeyAction({ key: ' ', target: div }, both))
      .toEqual({ type: 'toggle-slideshow' });
  });
  it('legacy "Spacebar" key is also accepted', () => {
    expect(decideKeyAction({ key: 'Spacebar', target: div }, both))
      .toEqual({ type: 'toggle-slideshow' });
  });
  it('Space toggles even at the end of the list (so user can pause)', () => {
    expect(decideKeyAction({ key: ' ', target: div }, onlyItem))
      .toEqual({ type: 'toggle-slideshow' });
  });
});

describe('decideKeyAction — text input suppression', () => {
  it.each([input, textarea, select, editable])(
    'ignores keys whose target is editable (%o)',
    (target) => {
      expect(decideKeyAction({ key: 'ArrowRight', target }, both)).toEqual({ type: 'ignore' });
      expect(decideKeyAction({ key: 'ArrowLeft', target }, both)).toEqual({ type: 'ignore' });
      expect(decideKeyAction({ key: 'Escape', target }, both)).toEqual({ type: 'ignore' });
      expect(decideKeyAction({ key: ' ', target }, both)).toEqual({ type: 'ignore' });
    },
  );
});

describe('decideKeyAction — unrelated keys', () => {
  it('ignores unrelated keys', () => {
    for (const k of ['a', 'Tab', 'Enter', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(decideKeyAction({ key: k, target: div }, both)).toEqual({ type: 'ignore' });
    }
  });
});

describe('shouldArmSlideshowTimer', () => {
  it('arms when slideshow is on, image, and has next', () => {
    expect(shouldArmSlideshowTimer({ slideshow: true, category: 'image', hasNext: true })).toBe(true);
  });
  it('does not arm when slideshow is off', () => {
    expect(shouldArmSlideshowTimer({ slideshow: false, category: 'image', hasNext: true })).toBe(false);
  });
  it('does not arm for videos (videos rely on onEnded, not a timer)', () => {
    expect(shouldArmSlideshowTimer({ slideshow: true, category: 'video', hasNext: true })).toBe(false);
  });
  it('does not arm at end of list', () => {
    expect(shouldArmSlideshowTimer({ slideshow: true, category: 'image', hasNext: false })).toBe(false);
  });
});

describe('shouldAdvanceOnVideoEnd', () => {
  it('advances when slideshow is active and there is a next item', () => {
    expect(shouldAdvanceOnVideoEnd({ slideshow: true, hasNext: true })).toBe(true);
  });
  it('does not advance when slideshow is off', () => {
    expect(shouldAdvanceOnVideoEnd({ slideshow: false, hasNext: true })).toBe(false);
  });
  it('does not advance at end of list', () => {
    expect(shouldAdvanceOnVideoEnd({ slideshow: true, hasNext: false })).toBe(false);
  });
});

/**
 * End-to-end keyboard scenario: simulate a mixed image/video sequence
 * being navigated entirely by the controller. This is the most direct
 * regression test for the bug the user keeps hitting in real runtime.
 */
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
    let slideshow = false;
    const log: string[] = [];

    function state() {
      return { hasPrev: idx > 0, hasNext: idx < items.length - 1 };
    }
    function press(key: string, target: { tagName?: string } = div) {
      const action = decideKeyAction({ key, target }, state());
      switch (action.type) {
        case 'next': idx++; log.push(`next→${items[idx].id}`); break;
        case 'prev': idx--; log.push(`prev→${items[idx].id}`); break;
        case 'close': log.push('close'); break;
        case 'toggle-slideshow':
          slideshow = !slideshow;
          log.push(`slideshow:${slideshow ? 'on' : 'off'}`);
          break;
        case 'ignore': log.push(`ignore:${key}`); break;
      }
    }
    function videoEnded() {
      if (shouldAdvanceOnVideoEnd({ slideshow, hasNext: state().hasNext })) {
        idx++;
        log.push(`video-end→${items[idx].id}`);
      }
    }
    return {
      press,
      videoEnded,
      log,
      get current() { return items[idx]; },
      get slideshow() { return slideshow; },
    };
  }

  it('ArrowRight walks the whole sequence and stops at the end', () => {
    const v = makeViewer();
    expect(v.current.id).toBe('img-1');
    v.press('ArrowRight');
    expect(v.current.id).toBe('vid-1');
    v.press('ArrowRight');
    expect(v.current.id).toBe('img-2');
    v.press('ArrowRight');
    expect(v.current.id).toBe('vid-2');
    v.press('ArrowRight');
    expect(v.current.id).toBe('img-3');
    v.press('ArrowRight'); // at end — no movement
    expect(v.current.id).toBe('img-3');
    expect(v.log).toEqual([
      'next→vid-1', 'next→img-2', 'next→vid-2', 'next→img-3', 'ignore:ArrowRight',
    ]);
  });

  it('ArrowLeft walks back from the middle', () => {
    const v = makeViewer();
    v.press('ArrowRight');
    v.press('ArrowRight');
    expect(v.current.id).toBe('img-2');
    v.press('ArrowLeft');
    expect(v.current.id).toBe('vid-1');
    v.press('ArrowLeft');
    expect(v.current.id).toBe('img-1');
    v.press('ArrowLeft'); // at start — no movement
    expect(v.current.id).toBe('img-1');
  });

  it('Space toggles slideshow on and off', () => {
    const v = makeViewer();
    expect(v.slideshow).toBe(false);
    v.press(' ');
    expect(v.slideshow).toBe(true);
    v.press(' ');
    expect(v.slideshow).toBe(false);
  });

  it('Escape closes', () => {
    const v = makeViewer();
    v.press('Escape');
    expect(v.log).toEqual(['close']);
  });

  it('with slideshow active, video onEnded advances to the next item', () => {
    const v = makeViewer();
    v.press('ArrowRight'); // at vid-1
    expect(v.current.id).toBe('vid-1');
    v.press(' '); // slideshow on
    expect(v.slideshow).toBe(true);
    v.videoEnded();
    expect(v.current.id).toBe('img-2');
  });

  it('without slideshow, video onEnded does NOT advance', () => {
    const v = makeViewer();
    v.press('ArrowRight'); // at vid-1
    v.videoEnded();
    expect(v.current.id).toBe('vid-1');
  });

  it('typing in an input is fully suppressed', () => {
    const v = makeViewer();
    v.press('ArrowRight', input);
    v.press(' ', input);
    v.press('Escape', input);
    expect(v.current.id).toBe('img-1');
    expect(v.slideshow).toBe(false);
    expect(v.log).toEqual(['ignore:ArrowRight', 'ignore: ', 'ignore:Escape']);
  });
});
