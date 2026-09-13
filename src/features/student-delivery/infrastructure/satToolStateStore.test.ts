import { beforeEach, describe, expect, it } from 'vitest';
import {
  SAT_TOOL_VIEW_COLLAPSED_DEFAULT,
  SAT_TOOL_VIEW_MOVED_DEFAULT,
  SAT_TOOL_VIEW_RESIZED_DEFAULT,
  SAT_TOOL_VIEW_SCALE_MODE_DEFAULT,
  createDefaultSatToolViewState,
  loadSatToolViewState,
  normalizeSatToolViewState,
  saveSatToolViewState,
  satToolViewKey,
} from './satToolStateStore';

describe('satToolStateStore', () => {
  beforeEach(() => localStorage.clear());

  it('keys view state per schedule:attempt:moduleAttempt with a versioned prefix', () => {
    expect(satToolViewKey('s', 'a', 'm')).toBe('sat-tool-view:v1:s:a:m');
  });

  it('round-trips zoom, scroll, last-focused tool, and the hint flag', () => {
    const key = satToolViewKey('s', 'a', 'm');
    const state = {
      zoom: 1.5,
      scrollTop: 240,
      collapsed: false,
      scaleMode: 'fit-width' as const,
      hasBeenMoved: false,
      hasBeenResized: false,
      lastFocusedTool: 'calculator' as const,
      toolHintSeen: { reference: true as const },
    };
    expect(saveSatToolViewState(key, state)).toBe(true);
    expect(loadSatToolViewState(key)).toEqual(state);
  });

  it('round-trips the four R-04 fields alongside the existing four plus the hint map', () => {
    const key = satToolViewKey('s', 'a', 'm');
    const state = {
      zoom: 1.5,
      scrollTop: 240,
      collapsed: true,
      scaleMode: 'fit-width' as const,
      hasBeenMoved: true,
      hasBeenResized: true,
      lastFocusedTool: 'reference' as const,
      toolHintSeen: { calculator: true as const, reference: true as const },
    };
    expect(saveSatToolViewState(key, state)).toBe(true);
    expect(loadSatToolViewState(key)).toEqual(state);
  });

  it('returns defaults on a missing entry, including an empty hint map', () => {
    expect(loadSatToolViewState(satToolViewKey('s', 'a', 'm'))).toEqual({
      zoom: 1,
      scrollTop: 0,
      collapsed: SAT_TOOL_VIEW_COLLAPSED_DEFAULT,
      scaleMode: SAT_TOOL_VIEW_SCALE_MODE_DEFAULT,
      hasBeenMoved: SAT_TOOL_VIEW_MOVED_DEFAULT,
      hasBeenResized: SAT_TOOL_VIEW_RESIZED_DEFAULT,
      lastFocusedTool: null,
      toolHintSeen: {},
    });
    expect(createDefaultSatToolViewState()).toEqual({
      zoom: 1,
      scrollTop: 0,
      collapsed: false,
      scaleMode: 'fit-width',
      hasBeenMoved: false,
      hasBeenResized: false,
      lastFocusedTool: null,
      toolHintSeen: {},
    });
  });

  it('removes corrupt entries and returns defaults', () => {
    const key = satToolViewKey('s', 'a', 'm');
    localStorage.setItem(key, '{not json');
    expect(loadSatToolViewState(key)).toEqual(createDefaultSatToolViewState());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('rejects structurally invalid records (bad lastFocusedTool) and removes them', () => {
    const key = satToolViewKey('s', 'a', 'm');
    localStorage.setItem(key, JSON.stringify({ zoom: 2, scrollTop: 10, lastFocusedTool: 'desmos', toolHintSeen: {} }));
    expect(normalizeSatToolViewState(JSON.parse(localStorage.getItem(key) as string))).toBeNull();
    expect(loadSatToolViewState(key)).toEqual(createDefaultSatToolViewState());
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('defaults a missing hint map to {} so Phase-07 reads never see undefined', () => {
    expect(normalizeSatToolViewState({ zoom: 1, scrollTop: 0, lastFocusedTool: null })).toMatchObject({ toolHintSeen: {} });
  });

  it('coerces garbage R-04 fields to defaults WITHOUT nulling or removing the record', () => {
    const key = satToolViewKey('s', 'a', 'm');
    localStorage.setItem(
      key,
      JSON.stringify({
        zoom: 1,
        scrollTop: 0,
        collapsed: 'yes',
        scaleMode: 42,
        hasBeenMoved: 1,
        hasBeenResized: 'true',
        lastFocusedTool: null,
        toolHintSeen: {},
      }),
    );
    const raw = JSON.parse(localStorage.getItem(key) as string);
    expect(normalizeSatToolViewState(raw)).toEqual({
      zoom: 1,
      scrollTop: 0,
      collapsed: false,
      scaleMode: 'fit-width',
      hasBeenMoved: false,
      hasBeenResized: false,
      lastFocusedTool: null,
      toolHintSeen: {},
    });
    // Structurally valid: the record survives (only the fields default).
    expect(loadSatToolViewState(key)).toMatchObject({ collapsed: false, scaleMode: 'fit-width' });
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('maps unknown future scaleMode values to fit-width (forward-compat, never null)', () => {
    expect(normalizeSatToolViewState({ zoom: 1, scrollTop: 0, scaleMode: 'fit-height' })).toMatchObject({
      scaleMode: 'fit-width',
    });
    expect(normalizeSatToolViewState({ zoom: 1, scrollTop: 0, scaleMode: 'fit-height' })).not.toBeNull();
  });

  it('defaults legacy pre-R-04 records with the four new-field defaults', () => {
    const key = satToolViewKey('s', 'a', 'm');
    localStorage.setItem(
      key,
      JSON.stringify({ zoom: 1.5, scrollTop: 240, lastFocusedTool: 'calculator', toolHintSeen: { reference: true } }),
    );
    expect(loadSatToolViewState(key)).toEqual({
      zoom: 1.5,
      scrollTop: 240,
      collapsed: false,
      scaleMode: 'fit-width',
      hasBeenMoved: false,
      hasBeenResized: false,
      lastFocusedTool: 'calculator',
      toolHintSeen: { reference: true },
    });
  });

  it('serializes all eight R-04 fields into the stored JSON shape', () => {
    const key = satToolViewKey('s', 'a', 'm');
    saveSatToolViewState(key, {
      zoom: 1.25,
      scrollTop: 120,
      collapsed: true,
      scaleMode: 'fit-width',
      hasBeenMoved: true,
      hasBeenResized: false,
      lastFocusedTool: 'reference',
      toolHintSeen: { reference: true },
    });
    const stored = JSON.parse(localStorage.getItem(key) as string) as Record<string, unknown>;
    expect(stored).toMatchObject({
      zoom: 1.25,
      scrollTop: 120,
      collapsed: true,
      scaleMode: 'fit-width',
      hasBeenMoved: true,
      hasBeenResized: false,
      lastFocusedTool: 'reference',
      toolHintSeen: { reference: true },
    });
  });
});
