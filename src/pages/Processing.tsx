import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Check, Loader2, Info, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pollJob, type JobStatus } from '@/lib/api';

const STEPS = [
  { key: 'uploaded', label: 'Upload received', desc: 'Your panorama has been securely uploaded' },
  { key: 'validating_panorama', label: 'Validating panorama', desc: 'Checking image quality and format' },
  { key: 'optimizing_panorama', label: 'Optimizing panorama', desc: 'Enhancing for immersive viewing' },
  { key: 'generating_outputs', label: 'Generating outputs', desc: 'Creating interactive room experience' },
  { key: 'finalizing', label: 'Finalizing tour', desc: 'Applying final polish' },
  { key: 'complete', label: 'Complete', desc: 'Your room tour is ready to explore' },
];

// Map legacy and alternative statuses
const STATUS_MAP: Record<string, string> = {
  extracting_frames: 'validating_panorama',
  selecting_frames: 'validating_panorama',
  stitching_panorama: 'optimizing_panorama',
  generating_preview: 'generating_outputs',
  estimating_cameras: 'validating_panorama',
  training_scene: 'optimizing_panorama',
  exporting: 'generating_outputs',
};

function stepIndexFromStatus(status: string): number {
  const mapped = STATUS_MAP[status] || status;
  const idx = STEPS.findIndex((s) => s.key === mapped);
  return idx >= 0 ? idx : 0;
}

export default function Processing() {
  const navigate = useNavigate();
  const location = useLocation();
  const { roomName, fileName, roomId, jobId } = (location.state as {
    roomName?: string;
    fileName?: string;
    roomId?: string;
    jobId?: string;
  }) || {};

  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!roomName && !jobId) navigate('/', { replace: true });
  }, [roomName, jobId, navigate]);

  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const data: JobStatus = await pollJob(jobId);
      const idx = stepIndexFromStatus(data.status);
      setActiveStep(idx);

      if (data.status === 'failed') {
        setError(data.error || 'Processing failed.');
        if (intervalRef.current) clearInterval(intervalRef.current);
      }

      if (data.status === 'complete') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        localStorage.setItem('tourguide_viewer', JSON.stringify({ roomName, fileName, roomId, jobId }));
        setTimeout(() => navigate(`/viewer/${roomId}`, { state: { roomName, fileName, roomId, jobId } }), 1400);
      }
    } catch (err: any) {
      console.error('Poll error:', err);
    }
  }, [jobId, roomName, fileName, roomId, navigate]);

  useEffect(() => {
    if (!jobId) return;
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [jobId, poll]);

  const isComplete = activeStep === STEPS.length - 1;
  const progress = Math.round((activeStep / (STEPS.length - 1)) * 100);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="w-full border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <span className="font-semibold text-foreground tracking-tight text-lg">
            TourGuide&nbsp;<span className="text-accent">AI</span>
          </span>
          <span className="text-[11px] text-muted-foreground border border-border rounded-full px-3 py-1 hidden sm:inline-block">
            Processing
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-lg space-y-6 animate-fade-in-up">
          <div className="text-center space-y-3">
            <div className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center transition-colors duration-700 ${isComplete ? 'bg-accent/15' : 'bg-muted'}`}>
              {isComplete ? <Sparkles className="h-6 w-6 text-accent animate-in fade-in duration-500" /> : <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {isComplete ? 'Your Room Tour is Ready' : 'Processing Your Panorama'}
            </h1>
            {(roomName || fileName) && (
              <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                {roomName && <span>{roomName}</span>}
                {roomName && fileName && <span className="text-border">•</span>}
                {fileName && <span className="truncate max-w-[180px]">{fileName}</span>}
              </div>
            )}
          </div>

          <Card className="shadow-lg shadow-foreground/[0.03] border-border/40 overflow-hidden">
            <div className="h-1 bg-muted">
              <div
                className={`h-full rounded-r-full transition-all duration-1000 ease-out ${isComplete ? 'bg-accent' : 'bg-accent/80'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <CardContent className="p-5 sm:p-7">
              <div className="flex items-center justify-between mb-5">
                <p className="text-xs text-muted-foreground">Progress</p>
                <p className={`text-sm font-semibold tabular-nums transition-colors duration-500 ${isComplete ? 'text-accent' : 'text-foreground'}`}>
                  {progress}%
                </p>
              </div>
              <div className="relative">
                <div className="absolute left-[13px] top-3 bottom-3 w-px bg-border" />
                <ol className="relative space-y-0">
                  {STEPS.map((step, i) => {
                    const completed = i < activeStep || (i === activeStep && isComplete);
                    const current = i === activeStep && !isComplete;
                    return (
                      <li key={step.key} className={`relative flex items-start gap-4 py-3 transition-opacity duration-500 ${!completed && !current ? 'opacity-40' : 'opacity-100'}`}>
                        <div className={`relative z-10 w-[27px] h-[27px] rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                          completed ? 'bg-accent text-accent-foreground shadow-sm shadow-accent/20' : current ? 'bg-accent/10 text-accent ring-[3px] ring-accent/10' : 'bg-muted text-muted-foreground'
                        }`}>
                          {completed ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : current ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="w-[5px] h-[5px] rounded-full bg-current opacity-50" />}
                        </div>
                        <div className="pt-0.5 min-w-0">
                          <p className={`text-[13px] leading-tight transition-colors duration-500 ${completed || current ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            {step.label}
                          </p>
                          {(completed || current) && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
                              {step.desc}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="space-y-2">
                <p className="text-sm text-destructive font-medium">{error}</p>
                <Button variant="outline" size="sm" onClick={() => navigate('/')}>Try again</Button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border/40 bg-card p-4 flex gap-3">
            <Info className="h-4 w-4 text-accent/70 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[13px] font-medium text-foreground">How it works</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                We validate your panorama, optimize it for immersive viewing, and generate an interactive 360° experience you can explore.
              </p>
            </div>
          </div>

          <p className="text-center text-[11px] text-muted-foreground/70">
            Processing typically takes 10–30 seconds depending on image size
          </p>
        </div>
      </main>
    </div>
  );
}
