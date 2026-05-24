import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Camera, Video, X, ImageIcon, Film, CheckCircle2 } from 'lucide-react';
import CaptureGuidance from './CaptureGuidance';

interface RoomMediaUploadProps {
  roomName: string;
  onSubmit: (files: File[], mode: 'photos' | 'video') => void;
  onCancel?: () => void;
  minPhotos?: number;
}

export default function RoomMediaUpload({
  roomName,
  onSubmit,
  onCancel,
  minPhotos = 20,
}: RoomMediaUploadProps) {
  const [mode, setMode] = useState<'photos' | 'video' | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [showGuidance, setShowGuidance] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (mode === 'video') {
      setFiles(selected.slice(0, 1));
    } else {
      setFiles(prev => [...prev, ...selected]);
    }
    if (e.target) e.target.value = '';
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const canSubmit = mode === 'video' ? files.length === 1 : files.length >= minPhotos;

  // Mode selection
  if (!mode) {
    return (
      <div className="text-center space-y-6 animate-fade-in-up py-4">
        <div className="mx-auto w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center">
          <Camera className="h-10 w-10 text-accent" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Capture: {roomName}</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Choose how you captured this room. Both methods produce a real 3D model.
          </p>
        </div>

        <div className="grid gap-3 max-w-sm mx-auto">
          <button
            onClick={() => { setMode('photos'); setShowGuidance(true); }}
            className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:border-accent/50 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
              <ImageIcon className="h-6 w-6 text-accent" />
            </div>
            <div>
              <p className="font-medium">Upload Photos</p>
              <p className="text-xs text-muted-foreground">20–60 overlapping photos of the room</p>
            </div>
          </button>

          <button
            onClick={() => { setMode('video'); setShowGuidance(true); }}
            className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:border-accent/50 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Film className="h-6 w-6 text-accent" />
            </div>
            <div>
              <p className="font-medium">Upload Video</p>
              <p className="text-xs text-muted-foreground">One slow walkthrough video (30–60s)</p>
            </div>
          </button>
        </div>

        {onCancel && (
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        )}
      </div>
    );
  }

  // Guidance screen
  if (showGuidance) {
    return (
      <div className="max-w-md mx-auto space-y-6 animate-fade-in-up py-4">
        <CaptureGuidance mode={mode} />
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => { setMode(null); setShowGuidance(false); }}>
            Back
          </Button>
          <Button className="flex-1" onClick={() => setShowGuidance(false)}>
            <Upload className="h-4 w-4 mr-2" />
            {mode === 'photos' ? 'Select Photos' : 'Select Video'}
          </Button>
        </div>
      </div>
    );
  }

  // File upload
  return (
    <div className="space-y-5 animate-fade-in-up py-4">
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold">{roomName}</h2>
        <p className="text-sm text-muted-foreground">
          {mode === 'photos'
            ? `${files.length} of ${minPhotos}+ photos selected`
            : files.length === 0 ? 'Select your walkthrough video' : '1 video selected'}
        </p>
      </div>

      {/* Progress indicator for photos */}
      {mode === 'photos' && (
        <div className="space-y-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                files.length >= minPhotos ? 'bg-accent' : 'bg-accent/50'
              }`}
              style={{ width: `${Math.min(100, (files.length / minPhotos) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{files.length} photos</span>
            <span>{files.length >= minPhotos ? <CheckCircle2 className="h-3.5 w-3.5 text-accent inline" /> : `${minPhotos} minimum`}</span>
          </div>
        </div>
      )}

      {/* File grid preview */}
      {files.length > 0 && (
        <div className={`grid gap-2 ${mode === 'video' ? 'grid-cols-1' : 'grid-cols-4 sm:grid-cols-6'}`}>
          {files.slice(0, 24).map((f, i) => (
            <div key={i} className="relative group aspect-square rounded-lg overflow-hidden bg-muted">
              {f.type.startsWith('image') ? (
                <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Video className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <button
                onClick={() => removeFile(i)}
                className="absolute top-1 right-1 p-0.5 rounded-full bg-destructive/80 text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {files.length > 24 && (
            <div className="aspect-square rounded-lg bg-muted flex items-center justify-center">
              <span className="text-sm text-muted-foreground">+{files.length - 24}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <label className="flex-1">
          <Button variant="outline" className="w-full" asChild>
            <span>
              <Upload className="h-4 w-4 mr-2" />
              {files.length > 0 ? 'Add More' : mode === 'photos' ? 'Select Photos' : 'Select Video'}
            </span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={mode === 'photos' ? 'image/*' : 'video/*'}
            multiple={mode === 'photos'}
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>
        <Button
          className="flex-1"
          disabled={!canSubmit}
          onClick={() => onSubmit(files, mode)}
        >
          Start Reconstruction
        </Button>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setShowGuidance(true)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          View capture tips
        </button>
        {onCancel && (
          <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
