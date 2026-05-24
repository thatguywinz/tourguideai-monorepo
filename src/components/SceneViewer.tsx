import { Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Html } from '@react-three/drei';
import { Maximize2, Minimize2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

function GLBModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function LoadingFallback() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
        <p className="text-sm text-muted-foreground">Loading 3D scene…</p>
      </div>
    </Html>
  );
}

interface SceneViewerProps {
  sceneUrl: string;
  className?: string;
  showFullscreen?: boolean;
}

export default function SceneViewer({ sceneUrl, className = '', showFullscreen = true }: SceneViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full h-full bg-primary ${className}`}>
      <Canvas
        camera={{ position: [3, 2, 3], fov: 50 }}
        gl={{ antialias: true }}
        style={{ background: 'hsl(210, 45%, 10%)' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <Suspense fallback={<LoadingFallback />}>
          <GLBModel url={sceneUrl} />
          <Environment preset="apartment" />
        </Suspense>
        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={0.5}
          maxDistance={20}
          autoRotate={false}
        />
      </Canvas>

      {showFullscreen && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 right-3 z-10 bg-primary/60 backdrop-blur-md text-primary-foreground hover:bg-primary/80"
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      )}

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-primary/50 backdrop-blur-sm text-primary-foreground/70 text-xs px-3 py-1.5 rounded-full pointer-events-none">
        Drag to rotate · Scroll to zoom · Right-drag to pan
      </div>
    </div>
  );
}
