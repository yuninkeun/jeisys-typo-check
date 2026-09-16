// pdf.js's actual worker runs in this module worker's global scope.
// See file-preview.tsx for why this polyfill is needed — it must run here,
// not on the main thread, since a Worker has its own Uint8Array.prototype.
if (typeof Uint8Array.prototype.toHex !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value: function toHex() {
      return Array.from(this, (b) => b.toString(16).padStart(2, "0")).join("");
    },
    writable: true,
    configurable: true,
  });
}

// Same story for Map/WeakMap.prototype.getOrInsertComputed() (TC39 "Upsert"
// proposal) — pdf.worker.min.mjs uses it throughout its glyph/resource caches.
for (const proto of [Map.prototype, WeakMap.prototype]) {
  if (typeof proto.getOrInsertComputed !== "function") {
    Object.defineProperty(proto, "getOrInsertComputed", {
      value: function (key, callback) {
        if (this.has(key)) return this.get(key);
        const value = callback(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }
}

await import("/pdf.worker.min.mjs");
