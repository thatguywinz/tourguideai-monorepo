import { getStages, type ReconstructionJob } from '@/lib/reconstruction-api';
import { CheckCircle2, Loader2, XCircle, Clock } from 'lucide-react';

interface ProcessingStatusProps {
  status: ReconstructionJob['status'];
  progress: number;
  error?: string;
}

export default function ProcessingStatus({ status, progress, error }: ProcessingStatusProps) {
  const stages = getStages();

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Processing</span>
          <span className="font-medium">{progress}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stages */}
      <div className="space-y-3">
        {stages.map((stage) => {
          const isActive = stage.key === status;
          const isDone = stage.progress < progress || (status === 'ready' && stage.key === 'ready');
          const isFailed = status === 'failed';
          const isPending = !isDone && !isActive;

          return (
            <div
              key={stage.key}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                isActive
                  ? 'bg-accent/10 border-accent/30'
                  : isDone
                  ? 'bg-muted/30 border-transparent'
                  : 'border-transparent opacity-50'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-5 w-5 text-accent flex-shrink-0" />
              ) : isActive && !isFailed ? (
                <Loader2 className="h-5 w-5 text-accent animate-spin flex-shrink-0" />
              ) : isFailed && isActive ? (
                <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              ) : (
                <Clock className="h-5 w-5 text-muted-foreground/40 flex-shrink-0" />
              )}
              <span className={`text-sm ${isActive ? 'font-medium' : ''}`}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
