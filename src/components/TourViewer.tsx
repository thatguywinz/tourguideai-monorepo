import { useState, useCallback } from 'react';
import PanoramaViewer from '@/components/PanoramaViewer';
import DollhouseNav from '@/components/DollhouseNav';
import { getPanoramaUrl } from '@/lib/supabase-helpers';
import type { Scene, Hotspot } from '@/lib/supabase-helpers';
import * as THREE from 'three';
interface ViewerHotspot {
  id: string;
  label: string;
  position: THREE.Vector3;
  onClick: () => void;
  direction: 'next' | 'prev';
}

interface TourViewerProps {
  scenes: Scene[];
  hotspots: Hotspot[];
}

export default function TourViewer({ scenes, hotspots }: TourViewerProps) {
  const [currentSceneId, setCurrentSceneId] = useState(scenes[0]?.id || '');
  const [transitioning, setTransitioning] = useState(false);

  const navigateToScene = useCallback((targetId: string) => {
    if (targetId === currentSceneId) return;
    setTransitioning(true);
    setTimeout(() => {
      setCurrentSceneId(targetId);
      setTimeout(() => setTransitioning(false), 100);
    }, 300);
  }, [currentSceneId]);

  const currentScene = scenes.find(s => s.id === currentSceneId) || scenes[0];
  if (!currentScene?.image_path) return null;

  const sceneHotspots = hotspots.filter(h => h.source_scene_id === currentSceneId);

  const viewerHotspots: ViewerHotspot[] = sceneHotspots.map(h => {
    const targetScene = scenes.find(s => s.id === h.target_scene_id);
    // The sphere is rendered with scale=[-1,1,1] (X-mirrored), so negate theta
    const theta = -(((h.position_x / 100) * Math.PI * 2) - Math.PI);
    const phi = (h.position_y / 100) * Math.PI;
    const radius = 40;
    const position = new THREE.Vector3(
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta),
    );
    return {
      id: h.id,
      label: h.label || targetScene?.name || 'Go',
      position,
      onClick: () => navigateToScene(h.target_scene_id),
      direction: 'next' as const,
    };
  });

  return (
    <div className="relative w-full h-full">
      {/* Transition overlay */}
      <div className={`absolute inset-0 z-20 bg-primary pointer-events-none transition-opacity duration-300 ${transitioning ? 'opacity-100' : 'opacity-0'}`} />

      {/* Panorama */}
      <PanoramaViewer key={currentSceneId} imageUrl={getPanoramaUrl(currentScene.image_path!)} />

      {/* Dollhouse navigation */}
      <DollhouseNav
        scenes={scenes}
        hotspots={hotspots}
        currentSceneId={currentSceneId}
        onNavigate={navigateToScene}
      />

      {/* Room pills - responsive: bottom on mobile, right side on desktop */}
      <div className="absolute right-2 sm:right-4 bottom-16 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 z-10 flex sm:flex-col flex-row gap-1.5 max-w-[calc(100%-1rem)] sm:max-w-none overflow-x-auto sm:overflow-x-visible pb-1 sm:pb-0">
        {scenes.map(s => (
          <button
            key={s.id}
            onClick={() => navigateToScene(s.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap backdrop-blur-md flex-shrink-0 ${
              s.id === currentSceneId ? 'bg-accent text-accent-foreground shadow-lg' : 'bg-primary/50 text-primary-foreground/70 hover:bg-primary/70'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* Current room label */}
      <div className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4 z-10 bg-primary/60 backdrop-blur-md text-primary-foreground px-3 py-1.5 rounded-lg">
        <span className="text-sm font-medium">{currentScene.name}</span>
      </div>
    </div>
  );
}
