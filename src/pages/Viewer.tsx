import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { getRoom, resolveAssetUrl, type RoomData, type ViewerConfig } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Share2, Check, Loader2, ImageOff, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import PanoramaViewer, { type PanoramaMode } from '@/components/PanoramaViewer';

export default function Viewer() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ roomId?: string }>();

  const routeState = (location.state as { roomName?: string; fileName?: string; roomId?: string }) || {};
  const stored = (() => {
    try { const raw = localStorage.getItem('tourguide_viewer'); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
  })();

  const roomId = params.roomId || routeState.roomId || stored.roomId;
  const initialName =
    routeState.roomName ||
    (stored.roomId === roomId ? stored.roomName : undefined) ||
    'Untitled Room';

  // Keep the address bar shareable: if the room came from route state or
  // localStorage, rewrite the URL to the canonical /viewer/:roomId form.
  useEffect(() => {
    if (roomId && !params.roomId) {
      navigate(`/viewer/${roomId}`, { replace: true, state: location.state });
    }
  }, [roomId, params.roomId, navigate, location.state]);

  const [displayName, setDisplayName] = useState(initialName);
  const [panoramaUrl, setPanoramaUrl] = useState<string | undefined>();
  const [panoMode, setPanoMode] = useState<PanoramaMode | undefined>();
  const [viewerConfig, setViewerConfig] = useState<ViewerConfig | undefined>();
  const [loading, setLoading] = useState(!!roomId);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    if (!roomId) return;
    const shareUrl = `${window.location.origin}/viewer/${roomId}`;

    // Native share sheet on touch devices (mobile/tablet)
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (isTouchDevice && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${displayName} — RoomShare`,
          text: `Take a 360° tour of ${displayName}`,
          url: shareUrl,
        });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return; // user dismissed the sheet
        // otherwise fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — legacy fallback
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        document.body.removeChild(textarea);
        toast.error('Could not copy the link. Copy it from the address bar instead.');
        return;
      }
      document.body.removeChild(textarea);
    }

    setCopied(true);
    toast.success('Share link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }, [roomId, displayName]);

  useEffect(() => {
    if (!roomId) return;
    getRoom(roomId)
      .then((data: RoomData) => {
        console.log('Viewer room data:', data);
        setDisplayName(data.room_name || initialName);

        const panoUrl = resolveAssetUrl(data.panorama_url) || resolveAssetUrl(data.preview_url);
        setPanoramaUrl(panoUrl);

        // Resolve viewer mode from backend
        const vt = data.viewer_type;
        const resolvedMode: PanoramaMode | undefined =
          vt === 'panorama_360' ? 'panorama_360'
          : vt === 'panorama_partial' ? 'panorama_partial'
          : vt === 'panorama_flat' ? 'panorama_flat'
          : undefined; // let PanoramaViewer auto-detect
        setPanoMode(resolvedMode);
        setViewerConfig(data.viewer_config);

        if (data.status === 'failed') {
          setError(data.error || 'Processing failed for this room.');
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch room:', err);
        setError('Could not load room data.');
        setLoading(false);
      });
  }, [roomId]);

  // No room ID
  if (!roomId) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <ViewerHeader navigate={navigate} />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 animate-fade-in">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <ImageOff className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-foreground">No room loaded</h1>
              <p className="text-sm text-muted-foreground">Upload a room video to generate your immersive tour.</p>
            </div>
            <Button variant="default" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
              Go to Upload
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="w-full border-b border-border/60 bg-card/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="p-1.5 -ml-1.5 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <span className="inline-flex items-center gap-2 font-semibold text-foreground tracking-tight text-lg">
              <img src="/roomshare.png" alt="" className="h-6 w-6" />
              <span>Room<span className="text-accent">Share</span></span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">{displayName}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground gap-1.5"
              onClick={handleShare}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Share2 className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Share'}
            </Button>
          </div>
        </div>
      </header>

      {/* Viewer area — dominant */}
      <main className="flex-1 flex flex-col p-3 sm:p-4">
        <div className="max-w-[1400px] w-full mx-auto flex-1 flex flex-col gap-3">
          {/* Viewer container */}
          <div
            className="relative rounded-2xl overflow-hidden border border-border/20 shadow-2xl shadow-foreground/[0.04]"
            style={{
              height: 'clamp(360px, 78vh, 900px)',
              minHeight: '360px',
            }}
          >
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'hsl(220,15%,8%)' }}>
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="h-8 w-8 text-accent animate-spin" />
                  <p className="text-sm text-white/40">Loading room…</p>
                </div>
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'hsl(220,15%,8%)' }}>
                <div className="text-center space-y-3 px-6 max-w-md">
                  <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
                  <p className="text-sm text-white/60">{error}</p>
                  <Button variant="ghost" size="sm" className="text-white/40 hover:text-white/70" onClick={() => navigate('/')}>
                    Back to Upload
                  </Button>
                </div>
              </div>
            ) : panoramaUrl ? (
              <PanoramaViewer
                imageUrl={panoramaUrl}
                viewerMode={panoMode}
                yawMinDeg={viewerConfig?.yaw_min_deg}
                yawMaxDeg={viewerConfig?.yaw_max_deg}
                pitchMinDeg={viewerConfig?.pitch_min_deg}
                pitchMaxDeg={viewerConfig?.pitch_max_deg}
                contentYawMinDeg={viewerConfig?.content_yaw_min_deg}
                contentYawMaxDeg={viewerConfig?.content_yaw_max_deg}
                contentPitchMinDeg={viewerConfig?.content_pitch_min_deg}
                contentPitchMaxDeg={viewerConfig?.content_pitch_max_deg}
                contentLeftNorm={viewerConfig?.content_left_norm}
                contentRightNorm={viewerConfig?.content_right_norm}
                contentTopNorm={viewerConfig?.content_top_norm}
                contentBottomNorm={viewerConfig?.content_bottom_norm}
                initialYawDeg={viewerConfig?.initial_yaw_deg}
                initialPitchDeg={viewerConfig?.initial_pitch_deg}
                verticalFovDeg={viewerConfig?.vertical_fov_deg}
                recommendedHfovDeg={viewerConfig?.recommended_hfov_deg}
                minHfovDeg={viewerConfig?.min_hfov_deg}
                maxHfovDeg={viewerConfig?.max_hfov_deg}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'hsl(220,15%,8%)' }}>
                <div className="text-center space-y-2 px-6">
                  <ImageOff className="h-8 w-8 text-white/20 mx-auto" />
                  <p className="text-sm text-white/40">Panorama is not available yet.</p>
                  <p className="text-xs text-white/25">The room may still be processing.</p>
                </div>
              </div>
            )}
          </div>

          {/* Mobile room title */}
          <div className="sm:hidden px-1">
            <h2 className="text-base font-medium text-foreground truncate">{displayName}</h2>
            <p className="text-xs text-muted-foreground">360° Room Tour</p>
          </div>
        </div>
      </main>
    </div>
  );
}

function ViewerHeader({ navigate }: { navigate: (path: string) => void }) {
  return (
    <header className="w-full border-b border-border/60 bg-card/80 backdrop-blur-sm">
      <div className="max-w-[1400px] mx-auto flex items-center px-4 sm:px-6 h-14">
        <span className="inline-flex items-center gap-2 font-semibold text-foreground tracking-tight text-lg cursor-pointer" onClick={() => navigate('/')}>
          <img src="/roomshare.png" alt="" className="h-6 w-6" />
          <span>Room<span className="text-accent">Share</span></span>
        </span>
      </div>
    </header>
  );
}
