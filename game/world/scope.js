/* ResourceScope (render-port-map section 5): everything a feature group creates is tracked here, so world.build() can
   dispose the whole group structurally (no leaked chunks, geometries, materials or textures).
   No THREE import: anything with dispose() can be tracked; Object3D children are removed from their parent. */
export class ResourceScope {
  constructor(name = 'scope') {
    this.name = name;
    this.disposables = [];
    this.objects = [];
    this.callbacks = [];
  }
  /* Track a BufferGeometry / Material / Texture / RenderTarget (anything with dispose()). Returns it. */
  track(res) { if (res) this.disposables.push(res); return res; }
  /* Add an Object3D to a parent (scene) and remember to remove it. Geometry/material are NOT disposed unless also tracked. */
  add(parent, obj) { parent.add(obj); this.objects.push(obj); return obj; }
  /* Run something on dispose (for resources that are swapped at runtime, e.g. mesh.geometry after a grow). */
  onDispose(fn) { this.callbacks.push(fn); }
  dispose() {
    for (const o of this.objects) if (o.parent) o.parent.remove(o);
    for (const fn of this.callbacks) { try { fn(); } catch (e) { /* keep disposing */ } }
    for (const d of this.disposables) { try { d.dispose(); } catch (e) { /* keep disposing */ } }
    this.objects.length = 0; this.callbacks.length = 0; this.disposables.length = 0;
  }
  get size() { return this.disposables.length + this.objects.length; }
}
