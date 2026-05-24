import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import AppShell from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Plus, Trash2, Target } from 'lucide-react';
import { toast } from 'sonner';
import { getPanoramaUrl } from '@/lib/supabase-helpers';
import type { Scene, Hotspot } from '@/lib/supabase-helpers';

export default function HotspotEditor() {
  const { projectId, sceneId } = useParams<{ projectId: string; sceneId: string }>();
  const navigate = useNavigate();
  const [scene, setScene] = useState<Scene | null>(null);
  const [allScenes, setAllScenes] = useState<Scene[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [placing, setPlacing] = useState<string | null>(null); // target scene id being placed
  const imgRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    if (!sceneId || !projectId) return;
    const [{ data: sc }, { data: all }, { data: hs }] = await Promise.all([
      supabase.from('scenes').select('*').eq('id', sceneId).single(),
      supabase.from('scenes').select('*').eq('project_id', projectId).order('sort_order'),
      supabase.from('hotspots').select('*').eq('source_scene_id', sceneId),
    ]);
    setScene(sc);
    setAllScenes(all || []);
    setHotspots(hs || []);
  }, [sceneId, projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const otherScenes = allScenes.filter(s => s.id !== sceneId && s.image_path);
  const linkedIds = new Set(hotspots.map(h => h.target_scene_id));

  const handleImageClick = async (e: React.MouseEvent) => {
    if (!placing || !sceneId || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const targetScene = allScenes.find(s => s.id === placing);
    const { error } = await supabase.from('hotspots').insert({
      source_scene_id: sceneId,
      target_scene_id: placing,
      position_x: x,
      position_y: y,
      label: targetScene?.name || '',
    });
    if (error) { toast.error(error.message); return; }
    setPlacing(null);
    fetchData();
    toast.success('Hotspot added');
  };

  const deleteHotspot = async (id: string) => {
    await supabase.from('hotspots').delete().eq('id', id);
    fetchData();
    toast.success('Hotspot removed');
  };

  if (!scene) {
    return (
      <AppShell>
        <div className="container py-12 text-center text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  const imageUrl = scene.image_path ? getPanoramaUrl(scene.image_path) : null;

  return (
    <AppShell>
      <div className="container max-w-4xl py-8 animate-fade-in-up">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to project
        </Button>

        <h1 className="text-xl font-bold mt-4 mb-2">Hotspots: {scene.name}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Click a room below to start placing, then click on the panorama to position the hotspot.
        </p>

        {/* Available rooms to link */}
        <div className="flex flex-wrap gap-2 mb-4">
          {otherScenes.map(s => (
            <Button
              key={s.id}
              variant={placing === s.id ? 'default' : linkedIds.has(s.id) ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setPlacing(placing === s.id ? null : s.id)}
              disabled={linkedIds.has(s.id)}
            >
              <Target className="h-3 w-3 mr-1" />
              {s.name}
              {linkedIds.has(s.id) && ' ✓'}
            </Button>
          ))}
          {otherScenes.length === 0 && (
            <p className="text-sm text-muted-foreground">Add more scenes with panoramas to create links.</p>
          )}
        </div>

        {placing && (
          <div className="mb-4 p-2 rounded-lg bg-accent/10 text-accent text-sm font-medium text-center animate-fade-in">
            Click on the panorama below to place a hotspot to "{allScenes.find(s => s.id === placing)?.name}"
          </div>
        )}

        {/* Panorama with hotspots */}
        {imageUrl && (
          <div
            ref={imgRef}
            className={`relative rounded-xl overflow-hidden border ${placing ? 'cursor-crosshair' : ''}`}
            onClick={placing ? handleImageClick : undefined}
          >
            <img src={imageUrl} alt={scene.name} className="w-full" draggable={false} />
            {/* Render existing hotspots */}
            {hotspots.map(h => (
              <div
                key={h.id}
                className="absolute group"
                style={{ left: `${h.position_x}%`, top: `${h.position_y}%`, transform: 'translate(-50%, -50%)' }}
              >
                <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-primary/80 text-primary-foreground text-xs font-medium shadow-lg backdrop-blur-sm whitespace-nowrap">
                  {h.label || 'Hotspot'}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteHotspot(h.id); }}
                    className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hotspot list */}
        {hotspots.length > 0 && (
          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Active Hotspots</h3>
            {hotspots.map(h => {
              const target = allScenes.find(s => s.id === h.target_scene_id);
              return (
                <div key={h.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <span className="text-sm">→ {target?.name || 'Unknown'}</span>
                  <Button variant="ghost" size="sm" onClick={() => deleteHotspot(h.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
