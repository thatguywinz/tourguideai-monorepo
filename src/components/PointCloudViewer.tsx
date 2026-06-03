import { Suspense, useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { Loader2, AlertCircle } from 'lucide-react';
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

function resolvePlyUrl(pointcloudUrl: string): string {
  if (pointcloudUrl.startsWith('http')) return pointcloudUrl;
  return `${API_BASE_URL}${pointcloudUrl.startsWith('/') ? '' : '/'}${pointcloudUrl}`;
}

function PointCloud({ url }: { url: string }) {
  const geometry = useLoader(PLYLoader, url);
  const { camera } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const controlsRef = useRef<any>(null);

  const { processedGeometry, hasColors, pointCount, error } = useMemo(() => {
    console.log("PLY geometry", geometry);
    console.log("Has positions", !!geometry.attributes.position);
    console.log("Has colors", !!geometry.attributes.color);
    console.log("Point count", geometry.attributes.position?.count);

    if (!geometry.attributes.position || geometry.attributes.position.count === 0) {
      return { processedGeometry: null, hasColors: false, pointCount: 0, error: "Loaded PLY has no visible point positions." };
    }

    const geo = geometry.clone();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    console.log("Bounding box", box.min, box.max);
    console.log("Center", center);
    console.log("Size", size);

    geo.translate(-center.x, -center.y, -center.z);
    geo.computeBoundingBox();

    const colors = !!geo.attributes.color && geo.attributes.color.count === geo.attributes.position.count;

    return { processedGeometry: geo, hasColors: colors, pointCount: geo.attributes.position.count, error: null };
  }, [geometry]);

  useEffect(() => {
    if (!processedGeometry) return;

    processedGeometry.computeBoundingBox();
    const box = processedGeometry.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const safeDistance = Math.max(maxDim * 2.5, 5);

    console.log("Camera fit — maxDim:", maxDim, "safeDistance:", safeDistance);

    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(safeDistance, safeDistance * 0.6, safeDistance);
    cam.near = 0.001;
    cam.far = Math.max(10000, safeDistance * 20);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [processedGeometry, camera]);

  if (error) {
    return (
      <Html center>
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="text-sm text-white/60">{error}</p>
        </div>
      </Html>
    );
  }

  console.log("Rendering points — count:", pointCount, "hasColors:", hasColors);

  return (
    <>
      <points ref={pointsRef} geometry={processedGeometry!}>
        <pointsMaterial
          size={0.05}
          sizeAttenuation
          vertexColors={hasColors}
          color={hasColors ? undefined : '#ffffff'}
        />
      </points>
      <axesHelper args={[2]} />
      <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate target={[0, 0, 0]} />
    </>
  );
}

function LoadingFallback() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
        <p className="text-sm text-white/50">Loading point cloud…</p>
      </div>
    </Html>
  );
}

function ErrorFallback({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <AlertCircle className="h-8 w-8 text-destructive/70" />
        <p className="text-sm text-white/50">{message}</p>
      </div>
    </div>
  );
}

interface PointCloudViewerProps {
  pointcloudUrl: string;
  roomName?: string;
}

export default function PointCloudViewer({ pointcloudUrl, roomName }: PointCloudViewerProps) {
  const [error, setError] = useState<string | null>(null);
  const resolvedUrl = resolvePlyUrl(pointcloudUrl);

  if (error) {
    return (
      <div className="relative w-full h-full bg-[hsl(225,20%,6%)]">
        <ErrorFallback message={error} />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[hsl(225,20%,6%)]">
      <Canvas
        camera={{ position: [10, 6, 10], fov: 50 }}
        gl={{ antialias: true }}
        onCreated={() => console.log('PointCloudViewer canvas ready, loading:', resolvedUrl)}
      >
        <ambientLight intensity={0.4} />
        <Suspense fallback={<LoadingFallback />}>
          <PointCloudErrorBoundary onError={(msg) => setError(msg)}>
            <PointCloud url={resolvedUrl} />
          </PointCloudErrorBoundary>
        </Suspense>
      </Canvas>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm text-white/50 text-xs px-3 py-1.5 rounded-full pointer-events-none">
        Drag to rotate · Scroll to zoom
      </div>

      {roomName && (
        <div className="absolute top-4 left-4 z-10">
          <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md border border-white/[0.08] rounded-lg px-3 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            <span className="text-[11px] text-white/70 font-medium">{roomName}</span>
          </div>
        </div>
      )}

      <div className="absolute top-4 right-4 z-10">
        <span className="text-[10px] text-white/30 bg-black/30 backdrop-blur-sm rounded px-2 py-1">
          3D Reconstruction
        </span>
      </div>
    </div>
  );
}

/* Simple error boundary for the R3F subtree */
import { Component, type ReactNode, type ErrorInfo } from 'react';

interface EBProps { children: ReactNode; onError: (msg: string) => void; }
interface EBState { hasError: boolean; }

class PointCloudErrorBoundary extends Component<EBProps, EBState> {
  state: EBState = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(_: Error, info: ErrorInfo) {
    console.error('PointCloud load error:', _, info);
    this.props.onError('Failed to load point cloud file.');
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
