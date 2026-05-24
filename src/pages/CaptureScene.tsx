import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { uploadRoomMediaFile } from '@/lib/supabase-helpers';
import { createReconstructionJob } from '@/lib/reconstruction-api';
import AppShell from '@/components/AppShell';
import RoomMediaUpload from '@/components/RoomMediaUpload';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function CaptureScene() {
  const { projectId, sceneId } = useParams<{ projectId: string; sceneId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [sceneName, setSceneName] = useState('');

  useEffect(() => {
    supabase.from('scenes').select('name').eq('id', sceneId).single().then(({ data }) => {
      if (data) setSceneName(data.name);
    });
  }, [sceneId]);

  const handleSubmit = async (files: File[], mode: 'photos' | 'video') => {
    if (!user || !sceneId || !projectId) return;
    setSaving(true);

    try {
      // 1. Upload all files to storage
      const mediaPaths: string[] = [];
      for (const file of files) {
        const path = await uploadRoomMediaFile(user.id, file, sceneId);
        mediaPaths.push(path);

        // Record in room_media table
        await supabase.from('room_media').insert({
          room_id: sceneId,
          file_path: path,
          file_type: file.type.startsWith('video') ? 'video' : 'image',
        });
      }

      // 2. Update scene media count
      await supabase.from('scenes').update({
        media_count: files.length,
        processing_status: 'uploading',
      }).eq('id', sceneId);

      // 3. Create reconstruction job
      const externalJobId = await createReconstructionJob(sceneId, mediaPaths);

      // 4. Store job in database
      await supabase.from('reconstruction_jobs').insert({
        room_id: sceneId,
        status: 'uploading',
        external_job_id: externalJobId,
        started_at: new Date().toISOString(),
      });

      toast.success('Processing started!');
      navigate(`/project/${projectId}/processing/${sceneId}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to start processing');
    }

    setSaving(false);
  };

  return (
    <AppShell>
      <div className="container max-w-2xl py-8 animate-fade-in-up">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        {saving && (
          <div className="mt-4 text-center text-sm text-muted-foreground animate-pulse">
            Uploading and starting reconstruction…
          </div>
        )}

        <div className="mt-4">
          <RoomMediaUpload
            roomName={sceneName}
            onSubmit={handleSubmit}
            onCancel={() => navigate(`/project/${projectId}`)}
          />
        </div>
      </div>
    </AppShell>
  );
}
