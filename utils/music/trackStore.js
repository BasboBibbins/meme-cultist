// The upcoming-tracks list. Deliberately shaped like the @discord-player/utils Queue the
// panel, controls, and commands already read, so replacing the player underneath them did
// not mean rewriting every caller.

class TrackStore {
  constructor() {
    this.store = [];
  }

  get size() {
    return this.store.length;
  }

  get data() {
    return this.store;
  }

  toArray() {
    return [...this.store];
  }

  at(index) {
    return this.store[index] ?? null;
  }

  add(track) {
    if (Array.isArray(track)) this.store.push(...track);
    else this.store.push(track);
    return this;
  }

  // Callers pass either the track object or its position, and both read naturally at the call site.
  remove(resolvable) {
    const index = typeof resolvable === "number"
      ? resolvable
      : this.store.indexOf(resolvable);
    if (index < 0 || index >= this.store.length) return null;
    return this.store.splice(index, 1)[0] ?? null;
  }

  shift() {
    return this.store.shift() ?? null;
  }

  clear() {
    this.store.length = 0;
  }

  // Fisher-Yates rather than a sort with a random comparator, which is biased and can throw in V8.
  shuffle() {
    for (let i = this.store.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.store[i], this.store[j]] = [this.store[j], this.store[i]];
    }
    return this;
  }

  map(fn) {
    return this.store.map(fn);
  }

  filter(fn) {
    return this.store.filter(fn);
  }

  find(fn) {
    return this.store.find(fn);
  }
}

module.exports = { TrackStore };
