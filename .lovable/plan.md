

## Fix First-Person Viewpoint and Add Dev Override

**Single file changed:** `src/components/GaussianSplatViewer.tsx`

### Problem
The default first-person target `[0, 1.6, -1]` aims the camera slightly downward. The OrbitControls built into the GaussianSplats3D viewer don't have polar angle constraints applied when `viewer_config` omits them, so users can easily get stuck looking at the floor.

### Changes

**1. Better first-person defaults**
- Change `FP_DEFAULT_TARGET` from `[0, 1.6, -1]` to `[0, 1.6, -5]` — same Y as eye height, farther forward, guaranteeing a horizontal gaze
- Always apply polar angle constraints in first-person mode: `minPolarAngle` default `Math.PI * 0.25` (45 deg from zenith), `maxPolarAngle` default `Math.PI * 0.75` (135 deg) — prevents looking straight up or down
- Backend values override these defaults when present

**2. Bounds-aware first-person fallback**
In `applyFirstPersonConfig`, after setting up from config defaults, attempt to improve the starting point if no explicit `initial_position`/`initial_target` were provided:
- Call `viewer.getSplatMesh()` → `getUsableBounds()`
- If valid bounds exist: place camera at `(center.x, center.y + 1.6, center.z)` looking at `(center.x, center.y + 1.6, center.z - 5)` — this centers the user inside the room at eye height instead of at the origin
- If bounds are unusable: keep the static defaults
- Backend-provided position/target always win over this heuristic

**3. Dev override via `window.__TOURGUIDE_DEV_CAMERA`**
At the top of `applyFirstPersonConfig`, check for a global override:
```typescript
const devOverride = (window as any).__TOURGUIDE_DEV_CAMERA;
// shape: { position?: [x,y,z], target?: [x,y,z] }
```
If present, use those values instead of config/defaults and log `[DEV OVERRIDE]`. This lets you paste into the browser console to test positions without backend changes:
```js
window.__TOURGUIDE_DEV_CAMERA = { position: [1, 1.6, 2], target: [1, 1.6, -3] }
```

**4. No WASD/pointer-lock for now**
The GaussianSplats3D standalone viewer uses its own built-in OrbitControls. Adding pointer-lock or WASD would require either monkey-patching those controls or replacing them entirely — too risky for a minimal fix. The constrained orbit with horizontal gaze and polar limits will feel like a stationary look-around, which is the right intermediate step.

### What stays unchanged
- Splat loading logic, URL resolution, error handling — untouched
- Viewer page layout, routing, sparse fallback — untouched
- Path B (configured orbit) and Path C (no config) — untouched
- No new dependencies

