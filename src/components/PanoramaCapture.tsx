import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Upload, RotateCcw, Check, ArrowRight, ArrowLeft,
  ImageIcon, ChevronRight, Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';

interface PanoramaCaptureProps {
  onCapture: (blob: Blob, dataUrl?: string) => void;
  onCancel?: () => void;
  roomName?: string;
  showUpload?: boolean;
  onUpload?: (file: File) => void;
}

type ViewState = 'idle' | 'tutorial' | 'upload-preview';

export default function PanoramaCapture({
  onCapture,
  onCancel,
  roomName,
  showUpload = true,
  onUpload,
}: PanoramaCaptureProps) {
  const [view, setView] = useState<ViewState>('idle');
  const [tutorialPage, setTutorialPage] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);

  const handleFileSelect = (f: File) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / img.height;
      if (ratio < 1.5) {
        toast.warning(
          'This doesn\'t look like a panorama. For the best 3D results, use a wide panorama photo (taken in panorama mode).',
        );
      }
      setUploadedFile(f);
      setUploadPreviewUrl(url);
      setView('upload-preview');
    };
    img.src = url;
  };

  const fileInput = (
    <input
      type="file"
      accept="image/*"
      className="hidden"
      onChange={e => {
        const f = e.target.files?.[0];
        if (f) handleFileSelect(f);
        if (e.target) e.target.value = '';
      }}
    />
  );

  // ── UPLOAD PREVIEW ──
  if (view === 'upload-preview' && uploadPreviewUrl && uploadedFile) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Preview Your Panorama</h2>
          <p className="text-sm text-muted-foreground">
            This image will be mapped onto a 360° sphere to create your room view.
          </p>
        </div>
        <div className="rounded-xl overflow-hidden border">
          <div className="overflow-x-auto">
            <img src={uploadPreviewUrl} alt="Panorama preview" className="h-48 w-auto max-w-none" />
          </div>
          <p className="text-xs text-muted-foreground text-center py-2">← Scroll to preview →</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              URL.revokeObjectURL(uploadPreviewUrl);
              setUploadedFile(null);
              setUploadPreviewUrl(null);
              setView('idle');
            }}
          >
            <RotateCcw className="h-4 w-4 mr-1" /> Choose Different
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              if (onUpload && uploadedFile) {
                onUpload(uploadedFile);
              } else {
                onCapture(uploadedFile);
              }
              URL.revokeObjectURL(uploadPreviewUrl);
              setUploadedFile(null);
              setUploadPreviewUrl(null);
              setView('idle');
            }}
          >
            <Check className="h-4 w-4 mr-1" /> Use This Panorama
          </Button>
        </div>
      </div>
    );
  }

  // ── TUTORIAL ──
  if (view === 'tutorial') {
    return <CaptureTutorial
      onBack={() => { setView('idle'); setTutorialPage(0); }}
      page={tutorialPage}
      setPage={setTutorialPage}
      onUpload={handleFileSelect}
    />;
  }

  // ── MAIN IDLE VIEW ──
  return (
    <div className="text-center space-y-6 animate-fade-in-up py-4">
      <div className="mx-auto w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center">
        <ImageIcon className="h-10 w-10 text-accent" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          {roomName ? `Add Panorama: ${roomName}` : 'Upload Panorama'}
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Upload a panorama photo taken with your phone's built-in panorama mode. It will be turned into an immersive 360° room view.
        </p>
      </div>

      <div className="space-y-3 max-w-xs mx-auto">
        <label className="block">
          <Button className="w-full" size="lg" asChild>
            <span><Upload className="h-4 w-4 mr-2" /> Upload Panorama Photo</span>
          </Button>
          {fileInput}
        </label>

        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={() => setView('tutorial')}
        >
          <Smartphone className="h-4 w-4 mr-2" /> How to capture a great panorama
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>

      {onCancel && (
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════
// Concise 2-page tutorial
// ════════════════════════════════════════════

const TUTORIAL_PAGES = [
  {
    title: 'How to Capture',
    subtitle: 'One panorama — done right — is all you need',
    tips: [
      '📱 Open your phone\'s Camera → switch to Panorama mode',
      '🔍 Tap 0.5x zoom (ultra-wide) — this is critical for capturing ceiling & floor',
      '📐 Hold your phone VERTICALLY (portrait) — makes the panorama taller',
      '⬇️ Tilt the phone down ~10-15° so you get more floor than ceiling',
      '🧍 Stand in the CENTER of the room — don\'t move your feet',
      '🔄 Slowly spin a full 360° — rotate your whole body, not just your arms',
      '⏱️ Go slow and steady — rushing causes blur',
    ],
  },
  {
    title: 'Before You Upload',
    subtitle: 'Quick checks for a great 3D result',
    tips: [
      '✅ Open the panorama in your gallery and scroll across it',
      '✅ All 4 walls should be visible — if one is cut off, retake',
      '✅ Floor should be visible — if not, tilt down more next time',
      '✅ No heavy blur or stitching gaps — retake if the image looks broken',
      '✅ The panorama should be wide (landscape ratio) — not a square crop',
      '💡 No 0.5x on your phone? Just hold vertically and tilt down — still works well',
    ],
  },
];

function CaptureTutorial({
  onBack,
  page,
  setPage,
  onUpload,
}: {
  onBack: () => void;
  page: number;
  setPage: (p: number) => void;
  onUpload: (f: File) => void;
}) {
  const totalPages = TUTORIAL_PAGES.length;
  const current = TUTORIAL_PAGES[page];
  const isLast = page === totalPages - 1;

  return (
    <div className="space-y-5 animate-fade-in-up py-4">
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2 mb-2">
          {TUTORIAL_PAGES.map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === page ? 'w-8 bg-accent' : 'w-3 bg-muted-foreground/20'
              }`}
            />
          ))}
        </div>
        <h2 className="text-lg font-semibold">{current.title}</h2>
        <p className="text-sm text-muted-foreground">{current.subtitle}</p>
      </div>

      {/* Tips */}
      <div className="rounded-xl border bg-card p-4 max-w-sm mx-auto">
        <ul className="space-y-2.5">
          {current.tips.map((tip, i) => (
            <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-2">
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Navigation */}
      <div className="flex gap-2 max-w-sm mx-auto">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => page > 0 ? setPage(page - 1) : onBack()}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> {page > 0 ? 'Previous' : 'Back'}
        </Button>

        {isLast ? (
          <label className="flex-1">
            <Button className="w-full" asChild>
              <span><Upload className="h-4 w-4 mr-2" /> Upload Panorama</span>
            </Button>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                if (e.target) e.target.value = '';
              }}
            />
          </label>
        ) : (
          <Button className="flex-1" onClick={() => setPage(page + 1)}>
            Next <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>

      {/* Skip to upload */}
      {!isLast && (
        <div className="text-center">
          <label>
            <button className="text-xs text-muted-foreground hover:text-foreground cursor-pointer">
              I already have a panorama — skip to upload →
            </button>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                if (e.target) e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}