import { describe, expect, it } from 'vitest';
import { mergePeopleWithUser, parsePeopleValue, type Person } from './people-merge';

const linda = { id: 'u-1', displayName: 'Aunt Linda', username: 'linda' };

describe('mergePeopleWithUser', () => {
  it('promotes a free entry that matches the user display name', () => {
    const people: Person[] = [{ kind: 'free', name: 'Aunt Linda' }];
    const { people: out, changed } = mergePeopleWithUser(people, linda);
    expect(changed).toBe(true);
    expect(out).toEqual([{ kind: 'user', id: 'u-1', name: 'Aunt Linda' }]);
  });

  it('promotes a free entry that matches the username', () => {
    const people: Person[] = [{ kind: 'free', name: 'linda' }];
    const { people: out, changed } = mergePeopleWithUser(people, linda);
    expect(changed).toBe(true);
    expect(out[0]).toEqual({ kind: 'user', id: 'u-1', name: 'Aunt Linda' });
  });

  it('matching is case-insensitive and whitespace-tolerant', () => {
    const people: Person[] = [{ kind: 'free', name: '  AUNT   linda  ' }];
    const { changed } = mergePeopleWithUser(people, linda);
    expect(changed).toBe(true);
  });

  it('leaves unrelated free entries alone', () => {
    const people: Person[] = [
      { kind: 'free', name: 'Uncle Bob' },
      { kind: 'free', name: 'Aunt Linda' },
    ];
    const { people: out } = mergePeopleWithUser(people, linda);
    expect(out).toEqual([
      { kind: 'free', name: 'Uncle Bob' },
      { kind: 'user', id: 'u-1', name: 'Aunt Linda' },
    ]);
  });

  it('dedupes when the file already had the user AND the free entry', () => {
    const people: Person[] = [
      { kind: 'user', id: 'u-1', name: 'Aunt Linda' },
      { kind: 'free', name: 'Aunt Linda' },
    ];
    const { people: out, changed } = mergePeopleWithUser(people, linda);
    expect(changed).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: 'user', id: 'u-1', name: 'Aunt Linda' });
  });

  it('reports unchanged when nothing matches', () => {
    const people: Person[] = [{ kind: 'free', name: 'Cousin Pat' }];
    const { changed, people: out } = mergePeopleWithUser(people, linda);
    expect(changed).toBe(false);
    expect(out).toEqual(people);
  });

  it('honors extra aliases', () => {
    const people: Person[] = [{ kind: 'free', name: 'Lin' }];
    const { changed, people: out } = mergePeopleWithUser(people, linda, ['Lin']);
    expect(changed).toBe(true);
    expect(out[0]).toEqual({ kind: 'user', id: 'u-1', name: 'Aunt Linda' });
  });
});

describe('parsePeopleValue', () => {
  it('parses a JSON array of mixed entries', () => {
    const raw = JSON.stringify([
      { kind: 'user', id: 'u-1', name: 'Aunt Linda' },
      { kind: 'free', name: 'Uncle Bob' },
      'Cousin Pat',
    ]);
    expect(parsePeopleValue(raw)).toEqual([
      { kind: 'user', id: 'u-1', name: 'Aunt Linda' },
      { kind: 'free', name: 'Uncle Bob' },
      { kind: 'free', name: 'Cousin Pat' },
    ]);
  });

  it('returns [] on malformed input', () => {
    expect(parsePeopleValue('not json')).toEqual([]);
    expect(parsePeopleValue('null')).toEqual([]);
    expect(parsePeopleValue('"string"')).toEqual([]);
  });
});
