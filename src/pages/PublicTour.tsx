import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import SceneViewer from '@/components/SceneViewer';
import { Home, ChevronLeft, ChevronRight, Share2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Scene, Project } from '@/lib/supabase-helpers';

export default function PublicTour() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: proj } = await supabase
        .from('projects')
        .select('*')
        .eq('published_slug', slug)
        .eq('status', 'published')
        .single();

      if (!proj) {
        setError('Tour not found');
        setLoading(false);
        return;
      }

      setProject(proj);

      const { data: sc } = await supabase
        .from('scenes')
        .select('*')
        .eq('project_id', proj.id)
        .order('sort_order');

      const readyScenes = (sc || []).filter((s: any) => s.processing_status === 'ready' && s.scene_url);
      setScenes(readyScenes);
      setLoading(false);
    })();
  }, [slug]);

  const shareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Link copied!');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <Loader2 className="h-8 w-8 text-accent animate-spin" />
      </div>
    );
  }

  if (error || !project || scenes.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Home className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">{error || 'No rooms available'}</p>
        </div>
      </div>
    );
  }

  const currentScene = scenes[currentIndex];
  const sceneUrl = (currentScene as any).scene_url as string;

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 overflow-hidden border-r bg-card flex flex-col`}>
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Home className="h-5 w-5 text-accent" />
            <h1 className="font-semibold truncate">{project.name}</h1>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <p className="text-xs text-muted-foreground px-2 py-1 mb-1">Rooms</p>
          {scenes.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentIndex(i)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                i === currentIndex
                  ? 'bg-accent/10 border border-accent/30'
                  : 'hover:bg-muted border border-transparent'
              }`}
            >
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                {(s as any).thumbnail_url ? (
                  <img src={(s as any).thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Home className="h-4 w-4 text-muted-foreground/40" />
                )}
              </div>
              <span className={`text-sm truncate ${i === currentIndex ? 'font-medium' : ''}`}>
                {s.name}
              </span>
            </button>
          ))}
        </div>

        <div className="p-3 border-t">
          <Button variant="outline" size="sm" className="w-full" onClick={shareLink}>
            <Share2 className="h-3.5 w-3.5 mr-2" /> Share Tour
          </Button>
        </div>
      </div>

      {/* Main viewer */}
      <div className="flex-1 flex flex-col relative">
        {/* Top controls */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg bg-primary/60 backdrop-blur-md text-primary-foreground hover:bg-primary/80 transition-colors"
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <div className="bg-primary/60 backdrop-blur-md text-primary-foreground px-3 py-1.5 rounded-lg">
            <span className="text-sm font-medium">{currentScene.name}</span>
          </div>
        </div>

        {/* Navigation arrows */}
        {currentIndex > 0 && (
          <button
            onClick={() => setCurrentIndex(i => i - 1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-primary/60 backdrop-blur-md text-primary-foreground hover:bg-primary/80 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {currentIndex < scenes.length - 1 && (
          <button
            onClick={() => setCurrentIndex(i => i + 1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-primary/60 backdrop-blur-md text-primary-foreground hover:bg-primary/80 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        {/* 3D Viewer */}
        <div className="flex-1">
          <SceneViewer key={currentScene.id} sceneUrl={sceneUrl} />
        </div>

        {/* Bottom room pills (mobile) */}
        <div className="sm:hidden flex gap-2 px-4 py-3 border-t bg-card overflow-x-auto">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentIndex(i)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 ${
                i === currentIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
