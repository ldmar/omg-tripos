/* ============================================================
   OhMyGoch Trip OS · crdt.js
   CRDT minimalista: LWW por campo (no por registro).
   - Cada campo: { value, ts, author }
   - Merge: gana el mayor (ts, author) lexicográfico
   - Tombstones para borrados
   Sin Yjs, sin dependencias, ~3KB.
   ============================================================ */

export class LWWMap {
  constructor(authorId) {
    this.authorId = authorId;
    this.fields = new Map();          // key → { value, ts, author, tomb? }
  }

  set(key, value) {
    this.fields.set(key, {
      value,
      ts: Date.now(),
      author: this.authorId,
    });
  }

  /** Borrado lógico: se conserva el tombstone para que gane el merge. */
  delete(key) {
    this.fields.set(key, {
      value: null,
      ts: Date.now(),
      author: this.authorId,
      tomb: true,
    });
  }

  get(key) {
    const f = this.fields.get(key);
    return f && !f.tomb ? f.value : undefined;
  }

  has(key) {
    const f = this.fields.get(key);
    return !!f && !f.tomb;
  }

  /** Fusiona el estado remoto. Devuelve true si algo cambió. */
  merge(remoteFields) {
    let changed = false;
    const remote = remoteFields instanceof Map
      ? remoteFields
      : new Map(remoteFields);
    for (const [k, rf] of remote) {
      const lf = this.fields.get(k);
      if (!lf || win(rf, lf)) {
        this.fields.set(k, rf);
        changed = true;
      }
    }
    return changed;
  }

  toObject() {
    const out = {};
    for (const [k, f] of this.fields) {
      if (!f.tomb) out[k] = f.value;
    }
    return out;
  }

  /** Serializa para enviar por el DataChannel. */
  serialize() {
    return [...this.fields.entries()];
  }

  /** Diff mínimo: sólo los campos que el peer no tiene o son más viejos. */
  diffSince(remoteFields) {
    const remote = remoteFields instanceof Map
      ? remoteFields
      : new Map(remoteFields);
    const out = [];
    for (const [k, lf] of this.fields) {
      const rf = remote.get(k);
      if (!rf || win(lf, rf)) out.push([k, lf]);
    }
    return out;
  }
}

/** Devuelve true si `a` gana a `b`. */
function win(a, b) {
  if (a.ts !== b.ts) return a.ts > b.ts;
  return String(a.author || '').localeCompare(String(b.author || '')) > 0;
}

/* ============================================================
   Colección tipada de LWWMap por id de entidad
   ============================================================ */
export class LWWCollection {
  constructor(authorId) {
    this.authorId = authorId;
    this.items = new Map();       // id → LWWMap
  }

  upsert(id, patch) {
    let map = this.items.get(id);
    if (!map) {
      map = new LWWMap(this.authorId);
      this.items.set(id, map);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (v === null) map.delete(k);
      else map.set(k, v);
    }
    return map;
  }

  /* Borrado lógico: se conserva el flag como campo normal (LWW)
     para que gane el merge contra peers. */
  remove(id) {
    const map = this.items.get(id);
    if (!map) return false;
    map.set('__deleted', true);
    return true;
  }

  get(id) {
    const map = this.items.get(id);
    if (!map) return null;
    if (map.get('__deleted')) return null;
    return { id, ...map.toObject() };
  }

  list() {
    const out = [];
    for (const [id, map] of this.items) {
      if (map.get('__deleted')) continue;
      out.push({ id, ...map.toObject() });
    }
    return out;
  }

  applyRemote(id, remoteFields) {
    let map = this.items.get(id);
    if (!map) {
      map = new LWWMap(this.authorId);
      this.items.set(id, map);
    }
    return map.merge(remoteFields);
  }

  serialize() {
    return [...this.items.entries()].map(([id, map]) => [id, map.serialize()]);
  }

  diff(remoteState) {
    const remote = new Map(remoteState);
    const out = [];
    for (const [id, map] of this.items) {
      const remoteFields = remote.get(id);
      const diff = remoteFields ? map.diffSince(remoteFields) : map.serialize();
      if (diff.length) out.push([id, diff]);
    }
    return out;
  }

  hydrate(serialized) {
    this.items = new Map();
    for (const [id, fields] of serialized) {
      const map = new LWWMap(this.authorId);
      map.fields = new Map(fields);
      this.items.set(id, map);
    }
  }
}
