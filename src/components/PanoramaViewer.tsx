import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Maximize, Minimize } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PanoramaMode = 'panorama_360' | 'panorama_partial' | 'panorama_flat';

/** Assumed vertical coverage of a handheld sweep panorama (used when the
 *  backend supplies no angular bounds — the horizontal sweep then follows
 *  from the image aspect ratio). */
const ASSUMED_SWEEP_VFOV_DEG = 60;

/** Convert a horizontal FOV to the vertical FOV three.js cameras use. */
function hfovToVfovDeg(hfovDeg: number, aspect: number): number {
  const halfH = (hfovDeg * Math.PI) / 360;
  return (2 * Math.atan(Math.tan(halfH) / Math.max(aspect, 0.1)) * 180) / Math.PI;
}

export interface PanoramaViewerProps {
  imageUrl: string;
  className?: string;
  viewerMode?: PanoramaMode;
  /** Safe/clamp bounds — where the camera center may point */
  yawMinDeg?: number;
  yawMaxDeg?: number;
  pitchMinDeg?: number;
  pitchMaxDeg?: number;
  /** Content bounds — angular extent the actual captured pixels occupy (drives geometry) */
  contentYawMinDeg?: number;
  contentYawMaxDeg?: number;
  contentPitchMinDeg?: number;
  contentPitchMaxDeg?: number;
  /** Where the content sits within the texture (0..1); padding lies outside this region */
  contentLeftNorm?: number;
  contentRightNorm?: number;
  contentTopNorm?: number;
  contentBottomNorm?: number;
  initialYawDeg?: number;
  initialPitchDeg?: number;
  verticalFovDeg?: number;
  /** Recommended horizontal FOV for the camera */
  recommendedHfovDeg?: number;
  /** Min HFOV (max zoom in) */
  minHfovDeg?: number;
  /** Max HFOV (max zoom out — never show padding) */
  maxHfovDeg?: number;
}

/* ------------------------------------------------------------------ */
/*  360 Sphere                                                         */
/* ------------------------------------------------------------------ */

function PanoramaSphere({ imageUrl, onLoaded }: { imageUrl: string; onLoaded?: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    const loader = new THREE.TextureLoader();
    loader.load(
      imageUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        textureRef.current = tex;
        setTexture(tex);
        onLoaded?.();
      },
      undefined,
      () => onLoaded?.()
    );
    return () => { textureRef.current?.dispose(); textureRef.current = null; };
  }, [imageUrl]);

  if (!texture) return null;
  return (
    <mesh ref={meshRef} scale={[-1, 1, 1]}>
      <sphereGeometry args={[50, 64, 32]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Partial Cylinder — only covers the captured arc                    */
/* ------------------------------------------------------------------ */

function PartialCylinder({
  imageUrl,
  thetaStart,
  thetaLength,
  phiMin,
  phiMax,
  onLoaded,
}: {
  imageUrl: string;
  thetaStart: number;
  thetaLength: number;
  phiMin: number;
  phiMax: number;
  onLoaded?: () => void;
}) {
  const textureRef = useRef<THREE.Texture | null>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    textureRef.current?.dispose();
    textureRef.current = null;
    const loader = new THREE.TextureLoader();
    loader.load(
      imageUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        textureRef.current = tex;
        setTexture(tex);
        onLoaded?.();
      },
      undefined,
      () => onLoaded?.()
    );
    return () => { textureRef.current?.dispose(); textureRef.current = null; };
  }, [imageUrl]);

  // Build a partial sphere geometry that only covers the captured arc
  const geometry = useMemo(() => {
    const radius = 50;
    const widthSegs = 64;
    const heightSegs = 32;

    // phiStart/phiLength control vertical coverage on SphereGeometry
    // SphereGeometry phi: 0 = top pole, PI = bottom pole
    const phiStart = phiMin;
    const phiLength = phiMax - phiMin;

    const geo = new THREE.SphereGeometry(
      radius,
      widthSegs,
      heightSegs,
      thetaStart,   // horizontal start
      thetaLength,  // horizontal sweep
      phiStart,     // vertical start
      phiLength     // vertical sweep
    );
    return geo;
  }, [thetaStart, thetaLength, phiMin, phiMax]);

  if (!texture) return null;
  return (
    <mesh scale={[-1, 1, 1]} geometry={geometry}>
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Camera controls — full 360 (no yaw clamp)                         */
/* ------------------------------------------------------------------ */

function CameraControls360() {
  const { camera, gl } = useThree();
  const isDragging = useRef(false);
  const prev = useRef({ x: 0, y: 0 });
  const spherical = useRef(new THREE.Spherical(1, Math.PI / 2, 0));
  const target = useRef(new THREE.Vector3());

  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => { isDragging.current = true; prev.current = { x: e.clientX, y: e.clientY }; el.style.cursor = 'grabbing'; };
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      spherical.current.theta -= (e.clientX - prev.current.x) * 0.003;
      spherical.current.phi = Math.max(0.4, Math.min(Math.PI - 0.4, spherical.current.phi + (e.clientY - prev.current.y) * 0.003));
      prev.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { isDragging.current = false; el.style.cursor = 'grab'; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camera as THREE.PerspectiveCamera;
      cam.fov = Math.max(30, Math.min(90, cam.fov + e.deltaY * 0.05));
      cam.updateProjectionMatrix();
    };

    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) { isDragging.current = true; prev.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
      else if (e.touches.length === 2) { lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging.current) {
        spherical.current.theta -= (e.touches[0].clientX - prev.current.x) * 0.003;
        spherical.current.phi = Math.max(0.4, Math.min(Math.PI - 0.4, spherical.current.phi + (e.touches[0].clientY - prev.current.y) * 0.003));
        prev.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const cam = camera as THREE.PerspectiveCamera;
        cam.fov = Math.max(30, Math.min(90, cam.fov - (d - lastDist) * 0.1));
        cam.updateProjectionMatrix();
        lastDist = d;
      }
    };
    const onTouchEnd = () => { isDragging.current = false; };

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [camera, gl]);

  useFrame(() => { target.current.setFromSpherical(spherical.current); camera.lookAt(target.current); });
  return null;
}

/* ------------------------------------------------------------------ */
/*  Camera controls — partial (yaw + pitch clamped, FOV clamped)       */
/* ------------------------------------------------------------------ */

function CameraControlsPartial({
  yawMinRad,
  yawMaxRad,
  phiMinRad,
  phiMaxRad,
  initialYawRad,
  initialPhiRad,
  hfovDeg,
  hfovMinDeg,
  hfovMaxDeg,
}: {
  yawMinRad: number;
  yawMaxRad: number;
  phiMinRad: number;
  phiMaxRad: number;
  initialYawRad: number;
  initialPhiRad: number;
  hfovDeg: number;
  hfovMinDeg: number;
  hfovMaxDeg: number;
}) {
  const { camera, gl, size } = useThree();
  const isDragging = useRef(false);
  const prev = useRef({ x: 0, y: 0 });
  const spherical = useRef(new THREE.Spherical(1, initialPhiRad, initialYawRad));
  const target = useRef(new THREE.Vector3());
  const hfov = useRef(Math.max(hfovMinDeg, Math.min(hfovMaxDeg, hfovDeg)));

  // The camera's vertical FOV may never exceed the captured vertical span,
  // otherwise empty space above/below the panorama is always in view.
  const vfovCapDeg = Math.max(20, ((phiMaxRad - phiMinRad) * 180) / Math.PI * 0.95);

  // Clamp theta so the camera frustum never extends past the geometry edges
  const clampThetaWithFov = useCallback((theta: number) => {
    const cam = camera as THREE.PerspectiveCamera;
    const halfHRad = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
    const effectiveMin = yawMinRad + halfHRad;
    const effectiveMax = yawMaxRad - halfHRad;
    if (effectiveMin >= effectiveMax) {
      return (yawMinRad + yawMaxRad) / 2;
    }
    return Math.max(effectiveMin, Math.min(effectiveMax, theta));
  }, [camera, yawMinRad, yawMaxRad]);

  const clampPhiWithFov = useCallback((phi: number) => {
    const cam = camera as THREE.PerspectiveCamera;
    const halfVRad = (cam.fov * Math.PI) / 360;
    const effectiveMin = phiMinRad + halfVRad;
    const effectiveMax = phiMaxRad - halfVRad;
    if (effectiveMin >= effectiveMax) {
      return (phiMinRad + phiMaxRad) / 2;
    }
    return Math.max(effectiveMin, Math.min(effectiveMax, phi));
  }, [camera, phiMinRad, phiMaxRad]);

  const applyHfov = useCallback(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = Math.min(hfovToVfovDeg(hfov.current, cam.aspect), vfovCapDeg);
    cam.updateProjectionMatrix();
    spherical.current.theta = clampThetaWithFov(spherical.current.theta);
    spherical.current.phi = clampPhiWithFov(spherical.current.phi);
  }, [camera, vfovCapDeg, clampThetaWithFov, clampPhiWithFov]);

  // Apply FOV on mount and whenever the viewport aspect changes
  useEffect(() => { applyHfov(); }, [applyHfov, size.width, size.height]);

  useEffect(() => {
    const el = gl.domElement;
    const cam = camera as THREE.PerspectiveCamera;
    // Pixel movement -> rotation matched to the visible FOV, so dragging
    // feels like grabbing the scene at any zoom level
    const radPerPx = () => ((cam.fov * Math.PI) / 180) / Math.max(el.clientHeight, 1);

    const onDown = (e: PointerEvent) => { isDragging.current = true; prev.current = { x: e.clientX, y: e.clientY }; el.style.cursor = 'grabbing'; };
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const k = radPerPx();
      spherical.current.theta = clampThetaWithFov(spherical.current.theta - (e.clientX - prev.current.x) * k);
      spherical.current.phi = clampPhiWithFov(spherical.current.phi + (e.clientY - prev.current.y) * k);
      prev.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { isDragging.current = false; el.style.cursor = 'grab'; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      hfov.current = Math.max(hfovMinDeg, Math.min(hfovMaxDeg, hfov.current + e.deltaY * 0.05));
      applyHfov();
    };

    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) { isDragging.current = true; prev.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
      else if (e.touches.length === 2) { lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging.current) {
        const k = radPerPx();
        spherical.current.theta = clampThetaWithFov(spherical.current.theta - (e.touches[0].clientX - prev.current.x) * k);
        spherical.current.phi = clampPhiWithFov(spherical.current.phi + (e.touches[0].clientY - prev.current.y) * k);
        prev.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        hfov.current = Math.max(hfovMinDeg, Math.min(hfovMaxDeg, hfov.current - (d - lastDist) * 0.1));
        applyHfov();
        lastDist = d;
      }
    };
    const onTouchEnd = () => { isDragging.current = false; };

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [camera, gl, clampThetaWithFov, clampPhiWithFov, applyHfov, hfovMinDeg, hfovMaxDeg]);

  useFrame(() => { target.current.setFromSpherical(spherical.current); camera.lookAt(target.current); });
  return null;
}

/* ------------------------------------------------------------------ */
/*  Edge-fade overlay for partial panoramas                           */
/* ------------------------------------------------------------------ */

function EdgeFadeOverlay() {
  return (
    <div className="absolute inset-0 pointer-events-none z-[5]">
      <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-black/60 to-transparent" />
      <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-black/60 to-transparent" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Flat Pan/Zoom Viewer                                               */
/* ------------------------------------------------------------------ */

function FlatPanoViewer({ imageUrl, onLoaded }: { imageUrl: string; onLoaded?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const onDown = useCallback((cx: number, cy: number) => {
    drag.current = { active: true, startX: cx, startY: cy, origX: transform.x, origY: transform.y };
  }, [transform.x, transform.y]);

  const onMove = useCallback((cx: number, cy: number) => {
    if (!drag.current.active) return;
    setTransform(t => ({ ...t, x: drag.current.origX + (cx - drag.current.startX), y: drag.current.origY + (cy - drag.current.startY) }));
  }, []);

  const onUp = useCallback(() => { drag.current.active = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setTransform(t => ({ ...t, scale: Math.max(0.5, Math.min(4, t.scale - e.deltaY * 0.002)) }));
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ cursor: drag.current.active ? 'grabbing' : 'grab', background: 'hsl(220,15%,8%)' }}
      onPointerDown={e => onDown(e.clientX, e.clientY)}
      onPointerMove={e => onMove(e.clientX, e.clientY)}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onWheel={onWheel}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Panoramic preview"
        onLoad={onLoaded}
        onError={onLoaded}
        draggable={false}
        className="absolute top-1/2 left-1/2 max-h-full select-none"
        style={{
          transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
          maxWidth: 'none',
          width: 'auto',
          height: '100%',
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main PanoramaViewer                                               */
/* ------------------------------------------------------------------ */

export default function PanoramaViewer({
  imageUrl,
  className = '',
  viewerMode,
  yawMinDeg,
  yawMaxDeg,
  pitchMinDeg,
  pitchMaxDeg,
  contentYawMinDeg,
  contentYawMaxDeg,
  contentPitchMinDeg,
  contentPitchMaxDeg,
  contentLeftNorm,
  contentRightNorm,
  contentTopNorm,
  contentBottomNorm,
  initialYawDeg,
  initialPitchDeg,
  recommendedHfovDeg,
  minHfovDeg,
  maxHfovDeg,
}: PanoramaViewerProps) {
  const [loading, setLoading] = useState(true);
  const [resolvedMode, setResolvedMode] = useState<PanoramaMode | null>(viewerMode ?? null);
  // Aspect ratio of the loaded image: null = probing, 0 = failed to load
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Probe image dimensions (needed to derive angular bounds when the backend
  // supplies none) and auto-detect the mode if none was given explicitly.
  useEffect(() => {
    let cancelled = false;
    if (viewerMode) {
      setResolvedMode(viewerMode);
    } else {
      setLoading(true);
      setResolvedMode(null);
    }
    setImageAspect(null);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
      setImageAspect(ratio);
      if (!viewerMode) {
        setResolvedMode(
          ratio >= 1.8 && ratio <= 2.2 ? 'panorama_360'
          : ratio >= 1.35 ? 'panorama_partial'
          : 'panorama_flat'
        );
      }
    };
    img.onerror = () => {
      if (cancelled) return;
      setImageAspect(0);
      if (!viewerMode) setResolvedMode('panorama_flat');
    };
    img.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl, viewerMode]);

  const handleLoaded = useCallback(() => setLoading(false), []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  /* ---- Partial panorama geometry & control params ---- */

  // Estimated angular coverage from the image aspect ratio, used when the
  // backend supplied no content bounds (auto-detected images, legacy rooms).
  const derived = imageAspect && imageAspect > 0
    ? (() => {
        const hfov = Math.min(360, ASSUMED_SWEEP_VFOV_DEG * imageAspect);
        const vfov = Math.min(90, Math.max(30, hfov / imageAspect));
        return { halfYaw: hfov / 2, halfPitch: vfov / 2 };
      })()
    : null;

  // --- Geometry (texture) bounds ---------------------------------------
  // The full panorama texture spans these angles. Derived from the captured
  // CONTENT bounds (not the tighter camera clamp), so the image is never
  // squished into the small "safe" region.
  const cYawMin = contentYawMinDeg ?? (derived ? -derived.halfYaw : yawMinDeg ?? -90);
  const cYawMax = contentYawMaxDeg ?? (derived ? derived.halfYaw : yawMaxDeg ?? 90);
  const cPitchMin = contentPitchMinDeg ?? (derived ? -derived.halfPitch : pitchMinDeg ?? -45);
  const cPitchMax = contentPitchMaxDeg ?? (derived ? derived.halfPitch : pitchMaxDeg ?? 45);

  // --- Camera clamp bounds ----------------------------------------------
  // Clamp directly against the content bounds: the controls subtract half the
  // camera FOV from these, which is what actually keeps padding out of view.
  // Stored "safe" bounds from older rooms already had FOV-sized margins baked
  // in, so clamping against them would double-clamp and freeze the camera.
  const clampYawMinRad = (cYawMin * Math.PI) / 180;
  const clampYawMaxRad = (cYawMax * Math.PI) / 180;
  const clampPhiMin = Math.max(0.02, Math.PI / 2 - (cPitchMax * Math.PI) / 180);
  const clampPhiMax = Math.min(Math.PI - 0.02, Math.PI / 2 - (cPitchMin * Math.PI) / 180);

  const initialYawRad = ((initialYawDeg ?? 0) * Math.PI) / 180;
  const initialPitchRad = ((initialPitchDeg ?? 0) * Math.PI) / 180;
  const initialPhi = Math.max(clampPhiMin, Math.min(clampPhiMax, Math.PI / 2 - initialPitchRad));

  // FOV limits in horizontal degrees; the controls convert them to the
  // vertical FOV three.js needs using the live viewport aspect.
  const contentHfovDeg = Math.max(20, cYawMax - cYawMin);
  const recHfov = recommendedHfovDeg
    ?? Math.min(75, Math.max(45, contentHfovDeg * 0.4), contentHfovDeg * 0.85);
  const minHfov = minHfovDeg ?? 30;
  const maxHfov = Math.max(recHfov, maxHfovDeg ?? Math.min(100, contentHfovDeg * 0.9));
  const lNorm = contentLeftNorm ?? 0;
  const rNorm = contentRightNorm ?? 1;
  const tNorm = contentTopNorm ?? 0;
  const bNorm = contentBottomNorm ?? 1;

  // Map full-texture U:[0,1] -> yaw and V:[0,1] -> pitch so the content
  // sub-region [lNorm,rNorm] x [tNorm,bNorm] lines up with the content angles.
  // Any baked-in padding (outside that sub-region) maps beyond the content
  // angles and stays hidden behind the camera clamp.
  const uSpan = Math.max(0.01, rNorm - lNorm);
  const yawPerU = (cYawMax - cYawMin) / uSpan;
  const geomYawMinRad = ((cYawMin - lNorm * yawPerU) * Math.PI) / 180;
  const geomYawMaxRad = ((cYawMax + (1 - rNorm) * yawPerU) * Math.PI) / 180;

  const vSpan = Math.max(0.01, bNorm - tNorm);
  const pitchPerV = (cPitchMax - cPitchMin) / vSpan;
  const geomPitchMaxDeg = cPitchMax + tNorm * pitchPerV;       // texture top (V=0) = highest pitch
  const geomPitchMinDeg = cPitchMin - (1 - bNorm) * pitchPerV; // texture bottom (V=1) = lowest pitch

  // SphereGeometry thetaStart is measured from +X axis going counterclockwise when viewed from above.
  // Our spherical.theta: 0 = +Z, increases counterclockwise. Mapping: geoTheta = PI/2 - yaw.
  const geoThetaStart = Math.PI / 2 - geomYawMaxRad;
  const geoThetaLength = geomYawMaxRad - geomYawMinRad;
  // SphereGeometry phi: 0 = top pole, PI = bottom pole; phi = PI/2 - pitch.
  const geomPhiMin = Math.max(0.001, Math.PI / 2 - (geomPitchMaxDeg * Math.PI) / 180);
  const geomPhiMax = Math.min(Math.PI - 0.001, Math.PI / 2 - (geomPitchMinDeg * Math.PI) / 180);

  console.log('[PanoramaViewer] mode:', resolvedMode,
    'contentYaw:', cYawMin.toFixed(1), '→', cYawMax.toFixed(1),
    'contentPitch:', cPitchMin.toFixed(1), '→', cPitchMax.toFixed(1),
    'geomYaw:', (geomYawMinRad * 180 / Math.PI).toFixed(1), '→', (geomYawMaxRad * 180 / Math.PI).toFixed(1),
    'geomPitch:', geomPitchMinDeg.toFixed(1), '→', geomPitchMaxDeg.toFixed(1),
    'hfov:', recHfov.toFixed(1), 'hfovRange:', minHfov, '-', maxHfov.toFixed(1),
    'imageAspect:', imageAspect?.toFixed(3));

  const modeLabel = resolvedMode === 'panorama_360' ? '360 View'
    : resolvedMode === 'panorama_partial' ? 'Panoramic View'
    : 'Preview';

  const dragHint = resolvedMode === 'panorama_360' ? 'Drag to look around'
    : resolvedMode === 'panorama_partial' ? 'Drag to explore panorama'
    : 'Drag to explore panorama';

  // Partial mode without explicit bounds needs the image aspect probe to finish
  // before geometry can be built (null = still probing).
  const awaitingAspect =
    resolvedMode === 'panorama_partial' && contentYawMinDeg == null && imageAspect === null;

  // Loading / detecting
  if (!resolvedMode || awaitingAspect) {
    return (
      <div className={`relative w-full h-full ${className}`}>
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'hsl(220,15%,8%)' }}>
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 border-2 border-muted-foreground/30 border-t-accent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground/60">Detecting panorama type…</p>
          </div>
        </div>
      </div>
    );
  }

  const isImmersive = resolvedMode === 'panorama_360' || resolvedMode === 'panorama_partial';

  return (
    <div ref={containerRef} className={`relative w-full h-full ${className}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'hsl(220,15%,8%)' }}>
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 border-2 border-muted-foreground/30 border-t-accent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground/60">Loading panorama…</p>
          </div>
        </div>
      )}

      {isImmersive ? (
        <>
          <Canvas
            camera={{ fov: resolvedMode === 'panorama_partial' ? 60 : 75, position: [0, 0, 0.1] }}
            gl={{ antialias: true }}
            style={{ background: 'hsl(220,15%,8%)' }}
          >
            {resolvedMode === 'panorama_360' ? (
              <>
                <PanoramaSphere imageUrl={imageUrl} onLoaded={handleLoaded} />
                <CameraControls360 />
              </>
            ) : (
              <>
                <PartialCylinder
                  imageUrl={imageUrl}
                  thetaStart={geoThetaStart}
                  thetaLength={geoThetaLength}
                  phiMin={geomPhiMin}
                  phiMax={geomPhiMax}
                  onLoaded={handleLoaded}
                />
                <CameraControlsPartial
                  yawMinRad={clampYawMinRad}
                  yawMaxRad={clampYawMaxRad}
                  phiMinRad={clampPhiMin}
                  phiMaxRad={clampPhiMax}
                  initialYawRad={initialYawRad}
                  initialPhiRad={initialPhi}
                  hfovDeg={recHfov}
                  hfovMinDeg={minHfov}
                  hfovMaxDeg={maxHfov}
                />
              </>
            )}
          </Canvas>
          {resolvedMode === 'panorama_partial' && !loading && <EdgeFadeOverlay />}
        </>
      ) : (
        <FlatPanoViewer imageUrl={imageUrl} onLoaded={handleLoaded} />
      )}

      {!loading && (
        <div className="absolute bottom-0 inset-x-0 flex items-center justify-between px-4 py-2.5 pointer-events-none z-10">
          <span className="text-xs text-white/50 bg-black/40 backdrop-blur-sm px-3 py-1 rounded-full pointer-events-none">
            {dragHint}
          </span>
          <button
            onClick={toggleFullscreen}
            className="pointer-events-auto p-2 rounded-lg bg-black/40 backdrop-blur-sm text-white/60 hover:text-white/90 transition-colors"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      )}

      {!loading && (
        <div className="absolute top-3 left-3 z-10">
          <span className="text-[11px] text-white/50 bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded-full">
            {modeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
