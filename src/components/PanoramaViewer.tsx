import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Maximize, Minimize } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PanoramaMode = 'panorama_360' | 'panorama_partial' | 'panorama_flat';

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
  fovMin,
  fovMax,
}: {
  yawMinRad: number;
  yawMaxRad: number;
  phiMinRad: number;
  phiMaxRad: number;
  initialYawRad: number;
  initialPhiRad: number;
  fovMin: number;
  fovMax: number;
}) {
  const { camera, gl } = useThree();
  const isDragging = useRef(false);
  const prev = useRef({ x: 0, y: 0 });
  const spherical = useRef(new THREE.Spherical(1, initialPhiRad, initialYawRad));
  const target = useRef(new THREE.Vector3());

  // Dynamically clamp theta so the camera FOV never extends past the geometry edges
  const clampWithFov = useCallback((theta: number, fov: number, aspect: number) => {
    // Half the horizontal FOV in radians
    const hFovRad = (fov * aspect * Math.PI) / 360;
    const effectiveMin = yawMinRad + hFovRad;
    const effectiveMax = yawMaxRad - hFovRad;
    if (effectiveMin >= effectiveMax) {
      return (yawMinRad + yawMaxRad) / 2;
    }
    return Math.max(effectiveMin, Math.min(effectiveMax, theta));
  }, [yawMinRad, yawMaxRad]);

  const clampPhiWithFov = useCallback((phi: number, fov: number) => {
    const halfVFovRad = (fov * Math.PI) / 360;
    const effectiveMin = phiMinRad + halfVFovRad;
    const effectiveMax = phiMaxRad - halfVFovRad;
    if (effectiveMin >= effectiveMax) {
      return (phiMinRad + phiMaxRad) / 2;
    }
    return Math.max(effectiveMin, Math.min(effectiveMax, phi));
  }, [phiMinRad, phiMaxRad]);

  useEffect(() => {
    const el = gl.domElement;
    const cam = camera as THREE.PerspectiveCamera;

    const onDown = (e: PointerEvent) => { isDragging.current = true; prev.current = { x: e.clientX, y: e.clientY }; el.style.cursor = 'grabbing'; };
    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const newTheta = spherical.current.theta - (e.clientX - prev.current.x) * 0.003;
      const newPhi = spherical.current.phi + (e.clientY - prev.current.y) * 0.003;
      spherical.current.theta = clampWithFov(newTheta, cam.fov, cam.aspect);
      spherical.current.phi = clampPhiWithFov(newPhi, cam.fov);
      prev.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => { isDragging.current = false; el.style.cursor = 'grab'; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const newFov = Math.max(fovMin, Math.min(fovMax, cam.fov + e.deltaY * 0.05));
      cam.fov = newFov;
      cam.updateProjectionMatrix();
      // Re-clamp position after zoom change
      spherical.current.theta = clampWithFov(spherical.current.theta, cam.fov, cam.aspect);
      spherical.current.phi = clampPhiWithFov(spherical.current.phi, cam.fov);
    };

    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) { isDragging.current = true; prev.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
      else if (e.touches.length === 2) { lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging.current) {
        const newTheta = spherical.current.theta - (e.touches[0].clientX - prev.current.x) * 0.003;
        const newPhi = spherical.current.phi + (e.touches[0].clientY - prev.current.y) * 0.003;
        spherical.current.theta = clampWithFov(newTheta, cam.fov, cam.aspect);
        spherical.current.phi = clampPhiWithFov(newPhi, cam.fov);
        prev.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const newFov = Math.max(fovMin, Math.min(fovMax, cam.fov - (d - lastDist) * 0.1));
        cam.fov = newFov;
        cam.updateProjectionMatrix();
        spherical.current.theta = clampWithFov(spherical.current.theta, cam.fov, cam.aspect);
        spherical.current.phi = clampPhiWithFov(spherical.current.phi, cam.fov);
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
  }, [camera, gl, clampWithFov, clampPhiWithFov, fovMin, fovMax]);

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
  verticalFovDeg,
  recommendedHfovDeg,
  minHfovDeg,
  maxHfovDeg,
}: PanoramaViewerProps) {
  const [loading, setLoading] = useState(true);
  const [resolvedMode, setResolvedMode] = useState<PanoramaMode | null>(viewerMode ?? null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-detect if no explicit mode
  useEffect(() => {
    if (viewerMode) { setResolvedMode(viewerMode); return; }
    setLoading(true);
    setResolvedMode(null);
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / img.height;
      setResolvedMode(ratio >= 1.85 && ratio <= 2.15 ? 'panorama_360' : 'panorama_flat');
    };
    img.onerror = () => setResolvedMode('panorama_flat');
    img.src = imageUrl;
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

  // Yaw bounds (Three.js theta, radians)
  const yawMinRad = ((yawMinDeg ?? -90) * Math.PI) / 180;
  const yawMaxRad = ((yawMaxDeg ?? 90) * Math.PI) / 180;
  const initialYawRad = ((initialYawDeg ?? 0) * Math.PI) / 180;

  // Pitch -> phi conversion: phi = PI/2 - pitch_rad
  const pitchMinRad = pitchMinDeg != null ? (pitchMinDeg * Math.PI) / 180 : undefined;
  const pitchMaxRad = pitchMaxDeg != null ? (pitchMaxDeg * Math.PI) / 180 : undefined;
  const phiMin = pitchMaxRad != null ? Math.max(0.05, Math.PI / 2 - pitchMaxRad) : 0.4;
  const phiMax = pitchMinRad != null ? Math.min(Math.PI - 0.05, Math.PI / 2 - pitchMinRad) : Math.PI - 0.4;
  const initialPitchRad = initialPitchDeg != null ? (initialPitchDeg * Math.PI) / 180 : 0;
  const initialPhi = Math.max(phiMin, Math.min(phiMax, Math.PI / 2 - initialPitchRad));

  // FOV limits for partial mode
  const recFov = recommendedHfovDeg ?? verticalFovDeg ?? 60;
  const cameraFov = Math.min(recFov * 0.85, 70);
  const fovMin = minHfovDeg ? Math.max(20, minHfovDeg * 0.6) : 25;
  const fovMax = maxHfovDeg ? Math.min(maxHfovDeg * 0.7, 80) : Math.min(cameraFov + 10, 80);

  // --- Geometry (texture) bounds ---------------------------------------
  // The full panorama texture spans these angles. Derived from the captured
  // CONTENT bounds (not the tighter camera clamp), so the image is never
  // squished into the small "safe" region. We fall back to the clamp bounds
  // when content bounds are absent (older rooms) to preserve prior behavior.
  const cYawMin = contentYawMinDeg ?? yawMinDeg ?? -90;
  const cYawMax = contentYawMaxDeg ?? yawMaxDeg ?? 90;
  const cPitchMin = contentPitchMinDeg ?? pitchMinDeg ?? -45;
  const cPitchMax = contentPitchMaxDeg ?? pitchMaxDeg ?? 45;
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
    'clampYaw:', yawMinDeg, '→', yawMaxDeg, 'clampPitch:', pitchMinDeg, '→', pitchMaxDeg,
    'geomYaw:', (geomYawMinRad * 180 / Math.PI).toFixed(1), '→', (geomYawMaxRad * 180 / Math.PI).toFixed(1),
    'geomPitch:', geomPitchMinDeg.toFixed(1), '→', geomPitchMaxDeg.toFixed(1),
    'fov:', cameraFov, 'fovRange:', fovMin, '-', fovMax);

  const modeLabel = resolvedMode === 'panorama_360' ? '360 View'
    : resolvedMode === 'panorama_partial' ? 'Panoramic View'
    : 'Preview';

  const dragHint = resolvedMode === 'panorama_360' ? 'Drag to look around'
    : resolvedMode === 'panorama_partial' ? 'Drag to explore panorama'
    : 'Drag to explore panorama';

  // Loading / detecting
  if (!resolvedMode) {
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
            camera={{ fov: resolvedMode === 'panorama_partial' ? cameraFov : 75, position: [0, 0, 0.1] }}
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
                  yawMinRad={yawMinRad}
                  yawMaxRad={yawMaxRad}
                  phiMinRad={phiMin}
                  phiMaxRad={phiMax}
                  initialYawRad={initialYawRad}
                  initialPhiRad={initialPhi}
                  fovMin={fovMin}
                  fovMax={fovMax}
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
