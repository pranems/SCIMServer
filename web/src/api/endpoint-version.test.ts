/**
 * C - remembers the ETag the operator's view was built from.
 *
 * The version has to be the one that was on screen when they started editing,
 * not one read at save time - a fresh read would always match and the check
 * would be decorative.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rememberEndpointVersion, getEndpointVersion, forgetEndpointVersion } from './endpoint-version';

describe('endpoint version store', () => {
  beforeEach(() => forgetEndpointVersion('ep-1'));

  it('C-T1: returns the version last seen for an endpoint', () => {
    rememberEndpointVersion('ep-1', 'W/"abc"');
    expect(getEndpointVersion('ep-1')).toBe('W/"abc"');
  });

  it('C-T2: is per endpoint', () => {
    rememberEndpointVersion('ep-1', 'W/"one"');
    rememberEndpointVersion('ep-2', 'W/"two"');
    expect(getEndpointVersion('ep-1')).toBe('W/"one"');
    expect(getEndpointVersion('ep-2')).toBe('W/"two"');
  });

  it('C-T3: an unknown endpoint has no version', () => {
    expect(getEndpointVersion('never-seen')).toBeUndefined();
  });

  it('C-T4: a refetch replaces the remembered version', () => {
    rememberEndpointVersion('ep-1', 'W/"old"');
    rememberEndpointVersion('ep-1', 'W/"new"');
    expect(getEndpointVersion('ep-1')).toBe('W/"new"');
  });

  it('C-T5: a null/absent header does not overwrite a known version with garbage', () => {
    rememberEndpointVersion('ep-1', 'W/"known"');
    rememberEndpointVersion('ep-1', null);
    // A server that stops sending the header should degrade to no check rather
    // than send `If-Match: null` and turn every save into a 412.
    expect(getEndpointVersion('ep-1')).toBeUndefined();
  });
});
