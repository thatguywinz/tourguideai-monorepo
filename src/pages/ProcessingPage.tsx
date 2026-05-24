import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { pollJobStatus, type ReconstructionJob } from '@/lib/reconstruction-api';
import AppShell from '@/components/AppShell';
import ProcessingStatus from '@/components/ProcessingStatus';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Eye, RotateCcw } from 'lucide-react';

export default function ProcessingPage() {
  const { projectId, sceneId } = useParams<{ projectId: string; sceneId: string }>();
  const navigate = useNavigate();
  const [sceneName, setSceneName] = useState('');
  const [job, setJob] = useState<ReconstructionJob | null>(null);
  const [externalJobId, setExternalJobId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load scene and job info
  useEffect(() => {
    if (!sceneId) return;

    supabase.from('scenes').select('name').eq('id', sceneId).single().then(({ data }) => {
      if (data) setSceneName(data.name);
    });

    supabase.from('reconstruction_jobs')
      .select('*')
      .eq('room_id', sceneId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setExternalJobId(data.external_job_id);
          setJob({
            id: data.external_job_id || data.id,
            status: data.status as ReconstructionJob['status'],
            progress: data.progress_pct,
          });
        }
      });
  }, [sceneId]);

  // Poll for updates
  useEffect(() => {
    if (!externalJobId || job?.status === 'ready' || job?.status === 'failed') return;

    intervalRef.current = setInterval(async () => {
      try {
        const result = await pollJobStatus(externalJobId);
        setJob(result);

        // Update database
        await supabase.from('reconstruction_jobs')
          .update({
            status: result.status,
            progress_pct: result.progress,
            ...(result.status === 'ready' ? { completed_at: new Date().toISOString() } : {}),
          })
          .eq('external_job_id', externalJobId);

        // Update scene when ready
        if (result.status === 'ready') {
          await supabase.from('scenes').update({
            processing_status: 'ready',
            scene_url: result.sceneUrl,
            thumbnail_url: result.thumbnailUrl,
          }).eq('id', sceneId);

          await supabase.from('projects').update({
            status: 'editing',
          }).eq('id', projectId);
        } else {
          await supabase.from('scenes').update({
            processing_status: result.status,
          }).eq('id', sceneId);
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [externalJobId, job?.status, sceneId, projectId]);

  return (
    <AppShell>
      <div className="container max-w-md py-8 md:py-16 animate-fade-in-up">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/project/${projectId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to project
        </Button>

        <div className="mt-8 text-center space-y-2 mb-8">
          <h1 className="text-2xl font-bold">Processing: {sceneName}</h1>
          <p className="text-sm text-muted-foreground">
            Your room is being reconstructed into a 3D scene. This typically takes 1–5 minutes.
          </p>
        </div>

        {job ? (
          <div className="space-y-8">
            <ProcessingStatus
              status={job.status}
              progress={job.progress}
              error={job.error}
            />

            {job.status === 'ready' && (
              <div className="text-center space-y-4 animate-fade-in-up">
                <p className="text-accent font-medium">🎉 Your 3D room is ready!</p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => navigate(`/project/${projectId}`)}
                  >
                    Back to Project
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => navigate(`/project/${projectId}/preview`)}
                  >
                    <Eye className="h-4 w-4 mr-2" /> View Tour
                  </Button>
                </div>
              </div>
            )}

            {job.status === 'failed' && (
              <div className="text-center space-y-4">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/project/${projectId}/capture/${sceneId}`)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" /> Try Again
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 border-2 border-muted-foreground/30 border-t-accent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </AppShell>
  );
}
