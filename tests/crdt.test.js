/* ============================================================
   Tests · crdt.js
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { LWWMap, LWWCollection } from '../crdt.js';

/* Helper: fija el reloj para tests deterministas */
function withTime(t, fn) {
  const orig = Date.now;
  Date.now = () => t;
  try { return fn(); } finally { Date.now = orig; }
}

describe('LWWMap', () => {
  it('set/get básico', () => {
    const m = new LWWMap('A');
    m.set('x', 42);
    expect(m.get('x')).toBe(42);
    expect(m.has('x')).toBe(true);
  });

  it('delete crea tombstone', () => {
    const m = new LWWMap('A');
    m.set('x', 1);
    m.delete('x');
    expect(m.get('x')).toBeUndefined();
    expect(m.has('x')).toBe(false);
  });

  it('toObject omite tombstones', () => {
    const m = new LWWMap('A');
    m.set('a', 1);
    m.set('b', 2);
    m.delete('b');
    expect(m.toObject()).toEqual({ a: 1 });
  });

  it('merge: gana el timestamp mayor', () => {
    let local, remote;
    withTime(1000, () => { local = new LWWMap('A'); local.set('x', 'viejo'); });
    withTime(2000, () => { remote = new LWWMap('B'); remote.set('x', 'nuevo'); });

    local.merge(remote.serialize());
    expect(local.get('x')).toBe('nuevo');
  });

  it('merge: mismo timestamp → gana el author lexicográfico mayor', () => {
    let a, b;
    withTime(1000, () => { a = new LWWMap('aaa'); a.set('x', 'A'); });
    withTime(1000, () => { b = new LWWMap('zzz'); b.set('x', 'B'); });

    a.merge(b.serialize());
    expect(a.get('x')).toBe('B');
  });

  it('merge es idempotente', () => {
    const a = new LWWMap('A');
    a.set('x', 1);
    const snap = a.serialize();

    const b = new LWWMap('B');
    expect(b.merge(snap)).toBe(true);
    expect(b.merge(snap)).toBe(false);   // segunda vez no cambia nada
  });

  it('diffSince devuelve sólo lo nuevo', () => {
    const a = new LWWMap('A');
    a.set('x', 1);
    const snapA = a.serialize();

    withTime(Date.now() + 1000, () => a.set('y', 2));

    const diff = a.diffSince(snapA);
    const keys = diff.map(([k]) => k);
    expect(keys).toContain('y');
    expect(keys).not.toContain('x');
  });
});

describe('LWWCollection', () => {
  it('upsert crea item y get lo devuelve con id', () => {
    const c = new LWWCollection('A');
    c.upsert('e1', { title: 'Hola', place: 'Madrid' });
    const item = c.get('e1');
    expect(item).toMatchObject({ id: 'e1', title: 'Hola', place: 'Madrid' });
  });

  it('upsert parcial sólo actualiza los campos pasados', () => {
    const c = new LWWCollection('A');
    c.upsert('e1', { title: 'Hola', place: 'Madrid' });
    withTime(Date.now() + 1000, () => c.upsert('e1', { title: 'Chau' }));
    expect(c.get('e1').title).toBe('Chau');
    expect(c.get('e1').place).toBe('Madrid');
  });

  it('remove marca como borrado', () => {
    const c = new LWWCollection('A');
    c.upsert('e1', { title: 'X' });
    c.remove('e1');
    expect(c.get('e1')).toBeNull();
    expect(c.list()).toHaveLength(0);
  });

  it('list devuelve todos los items vivos', () => {
    const c = new LWWCollection('A');
    c.upsert('a', { v: 1 });
    c.upsert('b', { v: 2 });
    c.upsert('c', { v: 3 });
    c.remove('b');
    const ids = c.list().map(x => x.id).sort();
    expect(ids).toEqual(['a', 'c']);
  });

  it('applyRemote mergea campos por separado (LWW por campo)', () => {
    const local = new LWWCollection('A');
    withTime(1000, () => local.upsert('e1', { title: 'Local', place: 'Madrid' }));

    const remote = new LWWCollection('B');
    withTime(2000, () => remote.upsert('e1', { title: 'Remoto' }));

    const [, fields] = remote.serialize()[0];
    local.applyRemote('e1', fields);

    expect(local.get('e1').title).toBe('Remoto');   // gana el más nuevo
    expect(local.get('e1').place).toBe('Madrid');   // se conserva el local
  });

  it('applyRemote en id inexistente crea el item', () => {
    const local = new LWWCollection('A');
    const remote = new LWWCollection('B');
    remote.upsert('nuevo', { title: 'X' });

    const [id, fields] = remote.serialize()[0];
    local.applyRemote(id, fields);

    expect(local.get('nuevo').title).toBe('X');
  });

  it('diff devuelve sólo lo que el peer no tiene', () => {
    const a = new LWWCollection('A');
    a.upsert('e1', { title: 'A', place: 'X' });
    const snapA = a.serialize();

    withTime(Date.now() + 1000, () => a.upsert('e1', { title: 'B' }));
    withTime(Date.now() + 2000, () => a.upsert('e2', { title: 'Nuevo' }));

    const diff = a.diff(snapA);
    const ids = diff.map(([id]) => id);
    expect(ids).toContain('e1');
    expect(ids).toContain('e2');

    const e1Diff = diff.find(([id]) => id === 'e1')[1];
    const e1Keys = e1Diff.map(([k]) => k);
    expect(e1Keys).toContain('title');
    expect(e1Keys).not.toContain('place');
  });

  it('hydrate restaura el estado serializado', () => {
    const a = new LWWCollection('A');
    a.upsert('e1', { title: 'X' });
    a.upsert('e2', { title: 'Y' });

    const b = new LWWCollection('B');
    b.hydrate(a.serialize());

    expect(b.list().map(x => x.id).sort()).toEqual(['e1', 'e2']);
    expect(b.get('e1').title).toBe('X');
  });
});