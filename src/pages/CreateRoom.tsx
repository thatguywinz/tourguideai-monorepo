import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadRoomPanorama, startPanoramaProcessing } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, ImageIcon, X, Check, Loader2, AlertCircle } from 'lucide-react';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_EXT = '.jpg,.jpeg,.png,.webp';

const TIPS = [
  'Use a true 2:1 equirectangular panorama for best results',
  'Capture from a single fixed standing spot in the room',
  'Good, even lighting produces a cleaner result',
  'Avoid very low-resolution or blurry images',
  'Higher resolution panoramas give a more immersive experience',
];

export default function CreateRoom() {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please upload an image file (JPG, PNG, or WebP).');
      return;
    }
    setImage(file);
    setPreview(URL.createObjectURL(file));
    setError('');
  }, []);

  const clearFile = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setImage(null);
    setPreview(null);
  }, [preview]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleSubmit = async () => {
    if (!image) return;
    setLoading(true);
    setError('');
    setUploadProgress(0);
    try {
      const name = roomName.trim() || undefined;
      const { room_id } = await uploadRoomPanorama(image, name, (pct) => setUploadProgress(pct));
      const { job_id } = await startPanoramaProcessing(room_id);
      localStorage.setItem('tourguide_viewer', JSON.stringify({ roomName: name || image.name, fileName: image.name, roomId: room_id, jobId: job_id }));
      navigate('/processing', {
        state: { roomName: name || image.name, fileName: image.name, roomId: room_id, jobId: job_id },
      });
    } catch (err: any) {
      setError(err?.message || 'Upload failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="w-full border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
          <span className="inline-flex items-center gap-2 font-semibold text-foreground tracking-tight text-lg">
            <img src="/roomshare.png" alt="" className="h-6 w-6" />
            <span>Room<span className="text-accent">Share</span></span>
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-xl space-y-6 animate-fade-in-up">
          <div className="text-center space-y-2">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Create Immersive Room Tour
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg max-w-md mx-auto">
              Upload a panorama image and we'll create an interactive 360° immersive room experience.
            </p>
          </div>

          <Card className="shadow-lg border-border/50">
            <CardContent className="p-6 sm:p-8 space-y-6">
              {/* Room Name */}
              <div className="space-y-2">
                <Label htmlFor="room-name" className="text-sm font-medium">Room Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="room-name"
                  placeholder="Living Room"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="h-11"
                />
              </div>

              {/* Upload Area */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Panorama Image</Label>
                {!image ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`relative cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                      dragOver ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40 hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                        <Upload className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Drag & drop your panorama here</p>
                        <p className="text-xs text-muted-foreground mt-1">or click to browse · JPG, PNG, WebP, MP4 available, not as nice</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
                    {preview && (
                      <div className="relative w-full h-32 sm:h-40 bg-muted">
                        <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex items-center gap-3 p-4">
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                        <ImageIcon className="h-5 w-5 text-accent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate text-foreground">{image.name}</p>
                        <p className="text-xs text-muted-foreground">{(image.size / (1024 * 1024)).toFixed(1)} MB</p>
                      </div>
                      <button onClick={clearFile} className="p-1.5 rounded-full hover:bg-muted transition-colors">
                        <X className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPTED_EXT}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    if (e.target) e.target.value = '';
                  }}
                />
              </div>

              {/* Tips */}
              <div className="rounded-xl bg-muted/40 border border-border/50 p-4 space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upload Tips</p>
                <ul className="space-y-1.5">
                  {TIPS.map((tip) => (
                    <li key={tip} className="flex items-start gap-2 text-sm text-foreground/80">
                      <Check className="h-3.5 w-3.5 text-accent mt-0.5 flex-shrink-0" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Submit */}
              <Button className="w-full h-12 text-base font-semibold" disabled={!image || loading} onClick={handleSubmit}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : 'Starting processing…'}
                  </>
                ) : (
                  'Create Room Tour'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
