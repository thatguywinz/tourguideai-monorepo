import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Plus, Trash2, ArrowLeft, Camera, Globe,
  Link as LinkIcon, Eye, Loader2, CheckCircle2, Clock,
} from 'lucide-react';
import type { Project, Scene } from '@/lib/supabase-helpers';

export default function ProjectEditor() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSceneName, setNewSceneName] = useState('');
  const [publishing, setPublishing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    const [{ data: proj }, { data: sc }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('scenes').select('*').eq('project_id', projectId).order('sort_order'),
    ]);
    setProject(proj);
    setScenes(sc || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addScene = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSceneName.trim() || !projectId) return;
    const { error } = await supabase.from('scenes').insert({
      project_id: projectId,
      name: newSceneName.trim(),
      sort_order: scenes.length,
    });
    if (error) { toast.error(error.message); return; }
    setNewSceneName('');
    fetchData();
  };

  const deleteScene = async (scene: Scene) => {
    if (!confirm(`Delete "${scene.name}"?`)) return;
    await supabase.from('scenes').delete().eq('id', scene.id);
    fetchData();
    toast.success('Room deleted');
  };

  const publishProject = async () => {
    if (!project || !projectId) return;
    setPublishing(true);
    const slug = project.published_slug || crypto.randomUUID().slice(0, 8);
    const { error } = await supabase.from('projects').update({
      status: 'published',
      published_slug: slug,
    }).eq('id', projectId);
    setPublishing(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Tour published!');
    fetchData();
  };

  const copyShareLink = () => {
    if (!project?.published_slug) return;
    const url = `${window.location.origin}/tour/${project.published_slug}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copied!');
  };

  if (loading) {
    return (
      <AppShell>
        <div className="container max-w-3xl py-12">
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
          </div>
        </div>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <div className="container py-12 text-center text-muted-foreground">Project not found.</div>
      </AppShell>
    );
  }

  const readyScenes = scenes.filter(s => (s as any).processing_status === 'ready' || s.scene_url);

  return (
    <AppShell>
      <div className="container max-w-3xl py-8 md:py-12 animate-fade-in-up">
        <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="mb-6">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {scenes.length} room{scenes.length !== 1 ? 's' : ''} · {readyScenes.length} ready
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {readyScenes.length >= 1 && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/project/${projectId}/preview`)}>
                <Eye className="h-4 w-4 mr-1" /> Preview
              </Button>
            )}
            {readyScenes.length >= 1 && (
              <Button size="sm" onClick={publishProject} disabled={publishing}>
                <Globe className="h-4 w-4 mr-1" /> {project.status === 'published' ? 'Republish' : 'Publish'}
              </Button>
            )}
          </div>
        </div>

        {project.status === 'published' && project.published_slug && (
          <div className="mb-6 p-3 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-between">
            <span className="text-sm text-accent font-medium">Tour is live!</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyShareLink}>
                <LinkIcon className="h-3 w-3 mr-1" /> Copy Link
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/tour/${project.published_slug}`} target="_blank">
                  <Globe className="h-3 w-3 mr-1" /> View
                </a>
              </Button>
            </div>
          </div>
        )}

        {/* Add room form */}
        <form onSubmit={addScene} className="mb-6 flex gap-2">
          <Input
            placeholder="Add a room (e.g. Living Room, Kitchen…)"
            value={newSceneName}
            onChange={e => setNewSceneName(e.target.value)}
          />
          <Button type="submit" variant="outline">
            <Plus className="h-4 w-4" />
          </Button>
        </form>

        {/* Rooms list */}
        {scenes.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground space-y-4">
            <p>Add rooms to start building your 3D tour.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {scenes.map(scene => (
              <RoomCard
                key={scene.id}
                scene={scene}
                projectId={projectId!}
                onDelete={deleteScene}
                onNavigate={navigate}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function RoomCard({
  scene,
  projectId,
  onDelete,
  onNavigate,
}: {
  scene: Scene;
  projectId: string;
  onDelete: (scene: Scene) => void;
  onNavigate: (path: string) => void;
}) {
  const status = (scene as any).processing_status as string || 'pending';
  const sceneUrl = (scene as any).scene_url as string | null;
  const thumbnailUrl = (scene as any).thumbnail_url as string | null;
  const mediaCount = (scene as any).media_count as number || 0;

  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    pending: { label: 'No media', color: 'text-muted-foreground', icon: <Clock className="h-3.5 w-3.5" /> },
    uploading: { label: 'Uploading', color: 'text-amber-500', icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    estimating: { label: 'Processing', color: 'text-amber-500', icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    building: { label: 'Building 3D', color: 'text-amber-500', icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    optimizing: { label: 'Optimizing', color: 'text-amber-500', icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    ready: { label: 'Ready', color: 'text-accent', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    failed: { label: 'Failed', color: 'text-destructive', icon: null },
  };

  const s = statusConfig[status] || statusConfig.pending;
  const isProcessing = ['uploading', 'estimating', 'building', 'optimizing'].includes(status);

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border bg-card">
      <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={scene.name} className="w-full h-full object-cover" />
        ) : (
          <Camera className="h-5 w-5 text-muted-foreground/40" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm">{scene.name}</h3>
        <div className={`flex items-center gap-1.5 text-xs ${s.color} mt-0.5`}>
          {s.icon}
          <span>{s.label}</span>
          {mediaCount > 0 && status !== 'pending' && (
            <span className="text-muted-foreground ml-1">· {mediaCount} files</span>
          )}
        </div>
      </div>

      <div className="flex gap-1 flex-shrink-0">
        {status === 'pending' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(`/project/${projectId}/capture/${scene.id}`)}
          >
            <Camera className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Capture</span>
          </Button>
        )}
        {isProcessing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(`/project/${projectId}/processing/${scene.id}`)}
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1" />
            <span className="hidden sm:inline">Status</span>
          </Button>
        )}
        {status === 'ready' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(`/project/${projectId}/preview`)}
          >
            <Eye className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">View</span>
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(scene)}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
