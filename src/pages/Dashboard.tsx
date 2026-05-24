import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit3, Globe, Box } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@/lib/supabase-helpers';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [roomCounts, setRoomCounts] = useState<Record<string, { total: number; ready: number }>>({});

  const fetchProjects = async () => {
    if (!user) return;
    const { data } = await supabase.from('projects').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });
    setProjects(data || []);
    setLoading(false);

    // Fetch room counts
    if (data && data.length > 0) {
      const ids = data.map(p => p.id);
      const { data: scenes } = await supabase.from('scenes').select('project_id, processing_status').in('project_id', ids);
      if (scenes) {
        const counts: Record<string, { total: number; ready: number }> = {};
        scenes.forEach(s => {
          if (!counts[s.project_id]) counts[s.project_id] = { total: 0, ready: 0 };
          counts[s.project_id].total++;
          if ((s as any).processing_status === 'ready') counts[s.project_id].ready++;
        });
        setRoomCounts(counts);
      }
    }
  };

  useEffect(() => { if (user) fetchProjects(); }, [user]);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !user) return;
    setCreating(true);
    const { data, error } = await supabase.from('projects').insert({ name: newName.trim(), user_id: user.id }).select().single();
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    setNewName('');
    setShowNew(false);
    navigate(`/project/${data.id}`);
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this property and all its rooms?')) return;
    await supabase.from('projects').delete().eq('id', id);
    setProjects(prev => prev.filter(p => p.id !== id));
    toast.success('Property deleted');
  };

  const statusColor: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    editing: 'bg-accent/10 text-accent',
    published: 'bg-accent text-accent-foreground',
  };

  return (
    <AppShell>
      <div className="container max-w-3xl py-8 md:py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">My Properties</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Create and manage your 3D property tours</p>
          </div>
          <Button onClick={() => setShowNew(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New Property
          </Button>
        </div>

        {showNew && (
          <form onSubmit={createProject} className="mb-6 flex gap-2 animate-fade-in">
            <Input placeholder="Property name (e.g. 42 Maple Drive)" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            <Button type="submit" disabled={creating}>Create</Button>
            <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
          </form>
        )}

        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16 space-y-4 animate-fade-in-up">
            <div className="mx-auto w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <Box className="h-8 w-8 text-accent" />
            </div>
            <p className="text-muted-foreground">No properties yet. Create your first one!</p>
            <Button onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> Create Property</Button>
          </div>
        ) : (
          <div className="space-y-3 animate-fade-in-up">
            {projects.map(p => {
              const counts = roomCounts[p.id];
              return (
                <div key={p.id} className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:shadow-sm transition-shadow">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <Box className="h-5 w-5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium truncate">{p.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[p.status] || statusColor.draft}`}>{p.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {counts ? `${counts.total} room${counts.total !== 1 ? 's' : ''} · ${counts.ready} ready` : 'No rooms'}
                      {' · '}Updated {new Date(p.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {p.status === 'published' && p.published_slug && (
                      <Button variant="ghost" size="icon" onClick={() => window.open(`/tour/${p.published_slug}`, '_blank')}>
                        <Globe className="h-4 w-4 text-accent" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => navigate(`/project/${p.id}`)}><Edit3 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteProject(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
