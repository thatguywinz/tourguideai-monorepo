import { Camera, Move, RotateCcw, Layers, DoorOpen, CheckCircle2, Smartphone, Video } from 'lucide-react';

const PHOTO_TIPS = [
  { icon: Camera, title: '20–60 overlapping photos', desc: 'Capture from multiple angles with 60–80% overlap between shots.' },
  { icon: Move, title: 'Move slowly around the room', desc: 'Walk around the perimeter, keeping the camera steady at chest height.' },
  { icon: RotateCcw, title: 'Cover all angles', desc: 'Shoot corners, ceilings, floors, and behind furniture.' },
  { icon: DoorOpen, title: 'Include doorways', desc: 'Photograph doorways and transitions so rooms connect properly.' },
  { icon: Layers, title: 'Consistent lighting', desc: 'Turn on all lights and open curtains. Avoid flash.' },
];

const VIDEO_TIPS = [
  { icon: Video, title: 'Slow, steady sweep', desc: 'Walk slowly around the room filming everything — walls, floor, ceiling.' },
  { icon: Smartphone, title: 'Hold phone at chest height', desc: 'Keep the camera roughly horizontal, tilting slightly up and down.' },
  { icon: RotateCcw, title: '30–60 second video', desc: 'A slow loop around the room is ideal. Include all surfaces.' },
  { icon: DoorOpen, title: 'Capture doorways', desc: 'Pan through doorways so the system can link rooms together.' },
];

interface CaptureGuidanceProps {
  mode: 'photos' | 'video';
}

export default function CaptureGuidance({ mode }: CaptureGuidanceProps) {
  const tips = mode === 'photos' ? PHOTO_TIPS : VIDEO_TIPS;

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h3 className="font-semibold">
          {mode === 'photos' ? 'Photo Capture Tips' : 'Video Capture Tips'}
        </h3>
        <p className="text-xs text-muted-foreground">
          Follow these guidelines for the best 3D reconstruction
        </p>
      </div>

      <div className="space-y-2.5">
        {tips.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex gap-3 p-3 rounded-xl border bg-card">
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Icon className="h-4 w-4 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 p-3 rounded-xl bg-accent/5 border border-accent/20">
        <CheckCircle2 className="h-4 w-4 text-accent flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          {mode === 'photos'
            ? 'Minimum 20 photos required for reconstruction. More photos = better quality.'
            : 'Keep video steady. Shaky footage reduces reconstruction quality.'}
        </p>
      </div>
    </div>
  );
}
