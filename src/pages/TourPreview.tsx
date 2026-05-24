import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import AppShell from '@/components/AppShell';
import SceneViewer from '@/components/SceneViewer';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { Scene } from '@/lib/supabase-helpers';

export default function TourPreview() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data: sc } = await supabase
        .from('scenes')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order');

      const readyScenes = (sc || []).filter((s: any) => s.processing_status === 'ready' && s.scene_url);
      setScenes(readyScenes);
      setLoading(false);
    })();
  }, [projectId]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-[80vh]">
          <Loader2 className="h-8 w-8 text-accent animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (scenes.length === 0) {
    return (
      <AppShell>
        <div className="container py-12 text-center text-muted-foreground">
          <p>No rooms are ready for preview yet. Process some rooms first.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(`/project/${projectId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to project
          </Button>
        </div>
      </AppShell>
    );
  }

  const currentScene = scenes[currentIndex];
  const sceneUrl = (currentScene as any).scene_url as string;

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-3.5rem)]">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-card/80 backdrop-blur-md">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex(i => i - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {currentScene.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={currentIndex === scenes.length - 1}
              onClick={() => setCurrentIndex(i => i + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1}/{scenes.length}
          </span>
        </div>

        {/* 3D Viewer */}
        <div className="flex-1 relative">
          <SceneViewer key={currentScene.id} sceneUrl={sceneUrl} />
        </div>

        {/* Room pills */}
        <div className="flex gap-2 px-4 py-3 border-t bg-card/80 backdrop-blur-md overflow-x-auto">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentIndex(i)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                i === currentIndex
                  ? 'bg-accent text-accent-foreground shadow-lg'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
