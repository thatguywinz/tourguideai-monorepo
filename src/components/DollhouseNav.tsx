import { useState, useMemo } from 'react';
import { Maximize2, Minimize2, Map, ChevronDown, ChevronUp } from 'lucide-react';
import type { Scene, Hotspot } from '@/lib/supabase-helpers';
import { getPanoramaUrl } from '@/lib/supabase-helpers';

interface DollhouseNavProps {
  scenes: Scene[];
  hotspots: Hotspot[];
  currentSceneId: string;
  onNavigate: (sceneId: string) => void;
}

export default function DollhouseNav({ scenes, hotspots, currentSceneId, onNavigate }: DollhouseNavProps) {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const connections = useMemo(() => {
    const conns: { from: number; to: number }[] = [];
    const seen = new Set<string>();
    hotspots.forEach(h => {
      const fromIdx = scenes.findIndex(s => s.id === h.source_scene_id);
      const toIdx = scenes.findIndex(s => s.id === h.target_scene_id);
      if (fromIdx === -1 || toIdx === -1) return;
      const key = [Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx)].join('-');
      if (seen.has(key)) return;
      seen.add(key);
      conns.push({ from: fromIdx, to: toIdx });
    });
    return conns;
  }, [scenes, hotspots]);

  const cols = Math.min(scenes.length, 3);
  const getPosition = (index: number) => {
    const row = Math.floor(index / cols);
    const colInRow = row % 2 === 0 ? index % cols : (cols - 1) - (index % cols);
    const baseX = colInRow * 160;
    const baseY = row * 120;
    const isoX = baseX - baseY * 0.3;
    const isoY = baseY * 0.7 + colInRow * 20;
    return { x: isoX + 80, y: isoY + 40 };
  };

  const svgWidth = Math.max(cols * 160 + 80, 320);
  const svgHeight = Math.max(Math.ceil(scenes.length / cols) * 120 + 80, 200);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="absolute top-3 left-3 sm:bottom-20 sm:top-auto sm:left-4 z-20 flex items-center gap-2 bg-card/90 backdrop-blur-md border shadow-lg rounded-xl px-3 py-2 text-sm font-medium hover:shadow-xl transition-all"
      >
        <Map className="h-4 w-4 text-accent" />
        <span className="hidden sm:inline">Floor Plan</span>
        <ChevronUp className="h-3 w-3 text-muted-foreground" />
      </button>
    );
  }

  const containerClass = fullscreen
    ? 'fixed inset-0 z-50 bg-background/95 backdrop-blur-lg flex flex-col items-center justify-center p-4 sm:p-6'
    : 'absolute top-3 left-3 sm:bottom-20 sm:top-auto sm:left-4 z-20 w-64 sm:w-72 md:w-80';

  return (
    <div className={containerClass}>
      <div className={`bg-card/95 backdrop-blur-md border shadow-2xl rounded-2xl overflow-hidden transition-all duration-300 ${fullscreen ? 'w-full max-w-2xl h-auto' : 'w-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-accent" />
            <span className="text-xs sm:text-sm font-semibold">Floor Plan</span>
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{scenes.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFullscreen(!fullscreen)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5 text-muted-foreground" /> : <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            <button
              onClick={() => { setExpanded(false); setFullscreen(false); }}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Isometric map */}
        <div className={`overflow-auto ${fullscreen ? 'p-4 sm:p-8' : 'p-2 sm:p-3'}`}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className={`w-full ${fullscreen ? 'max-h-[60vh]' : 'max-h-40 sm:max-h-52'}`}
            style={{ minHeight: fullscreen ? 200 : 100 }}
          >
            {/* Connection lines */}
            {connections.map(({ from, to }, i) => {
              const p1 = getPosition(from);
              const p2 = getPosition(to);
              return (
                <line
                  key={i}
                  x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke="hsl(var(--accent))"
                  strokeWidth="2"
                  strokeDasharray="6 3"
                  opacity="0.4"
                />
              );
            })}

            {/* Room blocks */}
            {scenes.map((scene, idx) => {
              const pos = getPosition(idx);
              const isActive = scene.id === currentSceneId;
              const thumbUrl = scene.image_path ? getPanoramaUrl(scene.image_path) : null;
              const blockW = 120;
              const blockH = 72;

              return (
                <g key={scene.id} onClick={() => onNavigate(scene.id)} className="cursor-pointer">
                  <rect
                    x={pos.x - blockW / 2 + 3} y={pos.y - blockH / 2 + 3}
                    width={blockW} height={blockH} rx="10"
                    fill="black" opacity="0.08"
                  />
                  {isActive && (
                    <rect
                      x={pos.x - blockW / 2 - 3} y={pos.y - blockH / 2 - 3}
                      width={blockW + 6} height={blockH + 6} rx="12"
                      fill="none" stroke="hsl(var(--accent))" strokeWidth="2.5" opacity="0.7"
                    >
                      <animate attributeName="opacity" values="0.7;0.3;0.7" dur="2s" repeatCount="indefinite" />
                    </rect>
                  )}
                  <rect
                    x={pos.x - blockW / 2} y={pos.y - blockH / 2}
                    width={blockW} height={blockH} rx="10"
                    fill={isActive ? 'hsl(var(--accent))' : 'hsl(var(--card))'}
                    stroke={isActive ? 'hsl(var(--accent))' : 'hsl(var(--border))'}
                    strokeWidth="1.5"
                  />
                  {thumbUrl && (
                    <>
                      <clipPath id={`clip-${scene.id}`}>
                        <rect
                          x={pos.x - blockW / 2 + 6} y={pos.y - blockH / 2 + 6}
                          width={blockW - 12} height={blockH - 28} rx="6"
                        />
                      </clipPath>
                      <image
                        href={thumbUrl}
                        x={pos.x - blockW / 2 + 6} y={pos.y - blockH / 2 + 6}
                        width={blockW - 12} height={blockH - 28}
                        clipPath={`url(#clip-${scene.id})`}
                        preserveAspectRatio="xMidYMid slice"
                        opacity={isActive ? 0.3 : 0.7}
                      />
                    </>
                  )}
                  <text
                    x={pos.x} y={pos.y + blockH / 2 - 8}
                    textAnchor="middle"
                    fill={isActive ? 'hsl(var(--accent-foreground))' : 'hsl(var(--foreground))'}
                    fontSize="10" fontWeight={isActive ? '700' : '500'} fontFamily="inherit"
                  >
                    {scene.name.length > 14 ? scene.name.slice(0, 12) + '…' : scene.name}
                  </text>
                  {isActive && (
                    <circle cx={pos.x + blockW / 2 - 10} cy={pos.y - blockH / 2 + 10} r="4" fill="hsl(var(--accent-foreground))">
                      <animate attributeName="r" values="4;5;4" dur="1.5s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
