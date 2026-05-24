import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import type { ViewerConfig } from '@/lib/api';

const API_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_LOOK_AT = new THREE.Vector3(0, 0, 0);
const INITIAL_CAMERA_POSITION = new THREE.Vector3(0, 3, 10);
const FALLBACK_CAMERA_POSITION = new THREE.Vector3(0, 5, 15);

const FP_DEFAULT_POSITION: [number, number, number] = [0, 1.6, 0];
const FP_DEFAULT_TARGET: [number, number, number] = [0, 1.6, -5];
const FP_DEFAULT_MIN_POLAR = Math.PI * 0.25;
const FP_DEFAULT_MAX_POLAR = Math.PI * 0.75;
const FP_DEFAULT_NEAR = 0.1;
const FP_DEFAULT_FAR = 15;
const FP_DEFAULT_MIN_DISTANCE = 0.1;
const FP_DEFAULT_MAX_DISTANCE = 3;

function resolveSplatUrl(url: string): string {
  if (url.startsWith('http')) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function getUsableBounds(object: THREE.Object3D) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;

  const values = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
  if (values.some((value) => !Number.isFinite(value))) return null;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const minDim = Math.min(size.x, size.y, size.z);
  const isFlat = minDim < Math.max(maxDim * 0.01, 0.001);
  const isTiny = maxDim < 0.05;
  const isHuge = maxDim > 10000;

  if (maxDim < 0.001 || isTiny || isHuge || isFlat) {
    return null;
  }

  return { box, center, size, maxDim };
}

function applyCameraFrame(viewer: any, position: THREE.Vector3, target: THREE.Vector3) {
  viewer.camera.position.copy(position);
  viewer.camera.near = 0.01;
  viewer.camera.far = Math.max(viewer.camera.far ?? 0, 5000);
  viewer.camera.lookAt(target);
  viewer.camera.updateProjectionMatrix();

  if (viewer.controls) {
    viewer.controls.target.copy(target);
    viewer.controls.update();
  }
}

function applyFirstPersonConfig(viewer: any, config: ViewerConfig) {
  // Dev override: set window.__TOURGUIDE_DEV_CAMERA = { position: [x,y,z], target: [x,y,z] }
  const devOverride = (window as any).__TOURGUIDE_DEV_CAMERA as
    | { position?: [number, number, number]; target?: [number, number, number] }
    | undefined;

  let pos: [number, number, number] = config.initial_position || FP_DEFAULT_POSITION;
  let tgt: [number, number, number] = config.initial_target || FP_DEFAULT_TARGET;

  // Bounds-aware centering when backend doesn't provide explicit position/target
  if (!config.initial_position && !config.initial_target) {
    const splatMesh = viewer.getSplatMesh?.();
    if (splatMesh) {
      const bounds = getUsableBounds(splatMesh);
      if (bounds) {
        pos = [bounds.center.x, bounds.center.y + 1.6, bounds.center.z];
        tgt = [bounds.center.x, bounds.center.y + 1.6, bounds.center.z - 5];
        console.log('GaussianSplatViewer [FP bounds-aware centering]:', { center: bounds.center.toArray() });
      }
    }
  }

  // Dev override wins over everything
  if (devOverride) {
    if (devOverride.position) pos = devOverride.position;
    if (devOverride.target) tgt = devOverride.target;
    console.log('GaussianSplatViewer [DEV OVERRIDE]:', { pos, tgt });
  }

  const near = config.near_plane ?? FP_DEFAULT_NEAR;
  const far = config.far_plane ?? FP_DEFAULT_FAR;

  viewer.camera.position.set(...pos);
  viewer.camera.near = near;
  viewer.camera.far = far;
  viewer.camera.lookAt(new THREE.Vector3(...tgt));
  viewer.camera.updateProjectionMatrix();

  if (viewer.controls) {
    viewer.controls.target.set(...tgt);
    viewer.controls.minDistance = config.min_distance ?? FP_DEFAULT_MIN_DISTANCE;
    viewer.controls.maxDistance = config.max_distance ?? FP_DEFAULT_MAX_DISTANCE;
    viewer.controls.minPolarAngle = config.min_polar_angle ?? FP_DEFAULT_MIN_POLAR;
    viewer.controls.maxPolarAngle = config.max_polar_angle ?? FP_DEFAULT_MAX_POLAR;
    viewer.controls.update();
  }

  console.log('GaussianSplatViewer [Path A - first_person]:', { pos, tgt, near, far });
}

function applyConfiguredOrbit(viewer: any, config: ViewerConfig) {
  // Run normal bounds-fit first
  fitViewerCamera(viewer);

  // Then override with any config values
  if (config.initial_position) {
    viewer.camera.position.set(...config.initial_position);
  }
  if (config.near_plane != null) viewer.camera.near = config.near_plane;
  if (config.far_plane != null) viewer.camera.far = config.far_plane;
  viewer.camera.updateProjectionMatrix();

  if (viewer.controls) {
    if (config.initial_target) viewer.controls.target.set(...config.initial_target);
    if (config.min_distance != null) viewer.controls.minDistance = config.min_distance;
    if (config.max_distance != null) viewer.controls.maxDistance = config.max_distance;
    if (config.min_polar_angle != null) viewer.controls.minPolarAngle = config.min_polar_angle;
    if (config.max_polar_angle != null) viewer.controls.maxPolarAngle = config.max_polar_angle;
    viewer.controls.update();
  }

  console.log('GaussianSplatViewer [Path B - configured orbit]:', config);
}

function fitViewerCamera(viewer: any) {
  const splatMesh = viewer.getSplatMesh?.();
  if (!splatMesh) {
    console.log('GaussianSplatViewer: no splat mesh exposed, using fallback framing');
    applyCameraFrame(viewer, FALLBACK_CAMERA_POSITION, DEFAULT_LOOK_AT);
    return;
  }

  const bounds = getUsableBounds(splatMesh);

  if (!bounds) {
    console.log('GaussianSplatViewer: invalid or unusable bounds, using fallback framing');
    applyCameraFrame(viewer, FALLBACK_CAMERA_POSITION, DEFAULT_LOOK_AT);
    return;
  }

  const { box, center, size, maxDim } = bounds;
  const cameraPosition = new THREE.Vector3(
    center.x + maxDim * 0.7,
    center.y + maxDim * 0.5,
    center.z + maxDim * 2.5,
  );

  console.log('GaussianSplatViewer [Path C - bounds fit]:', {
    min: box.min.toArray(),
    max: box.max.toArray(),
    center: center.toArray(),
    size: size.toArray(),
    cameraPosition: cameraPosition.toArray(),
  });

  viewer.camera.far = Math.max(maxDim * 50, 5000);
  applyCameraFrame(viewer, cameraPosition, center);
}

function applyViewerConfig(viewer: any, viewerConfig?: ViewerConfig) {
  if (viewerConfig?.mode === 'first_person') {
    applyFirstPersonConfig(viewer, viewerConfig);
  } else if (viewerConfig) {
    applyConfiguredOrbit(viewer, viewerConfig);
  } else {
    fitViewerCamera(viewer);
    console.log('GaussianSplatViewer [Path C - no config, default orbit]');
  }
}

interface GaussianSplatViewerProps {
  splatUrl: string;
  roomName?: string;
  viewerConfig?: ViewerConfig;
}

export default function GaussianSplatViewer({ splatUrl, roomName, viewerConfig }: GaussianSplatViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const resolvedUrl = resolveSplatUrl(splatUrl);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    container.replaceChildren();
    setLoading(true);
    setError(null);

    const viewer = new GaussianSplats3D.Viewer({
      rootElement: container,
      selfDrivenMode: true,
      useBuiltInControls: true,
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
      initialCameraPosition: INITIAL_CAMERA_POSITION.toArray(),
      initialCameraLookAt: DEFAULT_LOOK_AT.toArray(),
    });

    viewerRef.current = viewer;

    console.log('GaussianSplatViewer: loading splat from', resolvedUrl);

    viewer
      .addSplatScene(resolvedUrl, {
        showLoadingUI: false,
        progressiveLoad: false,
      })
      .then(() => {
        if (disposed) return;

        console.log('GaussianSplatViewer: splat loaded successfully');
        applyViewerConfig(viewer, viewerConfig);
        viewer.start?.();
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (disposed) return;

        console.error('GaussianSplatViewer: failed to load splat', loadError);
        setError('Failed to load 3D reconstruction.');
        setLoading(false);
      });

    return () => {
      disposed = true;

      const activeViewer = viewerRef.current;
      viewerRef.current = null;

      if (activeViewer) {
        try {
          activeViewer.stop?.();
        } catch (cleanupError) {
          console.warn('GaussianSplatViewer: failed to stop viewer cleanly', cleanupError);
        }

        void Promise.resolve(activeViewer.dispose?.()).catch((cleanupError) => {
          console.warn('GaussianSplatViewer: failed to dispose viewer cleanly', cleanupError);
        });
      }

      container.replaceChildren();
    };
  }, [resolvedUrl, viewerConfig]);

  return (
    <div className="absolute inset-0 bg-background">
      <div ref={containerRef} className="absolute inset-0" />

      {loading && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">Loading 3D scene…</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border/40 bg-card/80 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
        {viewerConfig?.mode === 'first_person' ? 'Drag to look around · Scroll to move' : 'Drag to rotate · Scroll to zoom'}
      </div>

      {roomName && (
        <div className="pointer-events-none absolute left-4 top-4 z-10">
          <div className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/80 px-3 py-1.5 backdrop-blur-md">
            <div className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="text-[11px] font-medium text-foreground/70">{roomName}</span>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute right-4 top-4 z-10">
        <span className="rounded border border-border/30 bg-card/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          3D Reconstruction
        </span>
      </div>
    </div>
  );
}