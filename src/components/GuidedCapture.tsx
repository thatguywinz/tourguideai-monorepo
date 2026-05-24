import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { uploadPanorama } from '@/lib/supabase-helpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Camera, Upload, RotateCcw, Check, ArrowRight, ArrowLeft,
  Lightbulb, Smartphone, Move, DoorOpen, CheckCircle2, X,
} from 'lucide-react';
import PanoramaCapture from '@/components/PanoramaCapture';

interface Room {
  id: string;
  name: string;
  imagePath: string | null;
  capturedBlob: Blob | null;
  connections: string[];
}

interface GuidedCaptureProps {
  projectId: string;
  existingScenes: { id: string; name: string; image_path: string | null }[];
  onComplete: () => void;
  onCancel: () => void;
}

type FlowStep = 'add-rooms' | 'capture' | 'connections' | 'complete';

const CAPTURE_TIPS = [
  { icon: Move, text: 'Stand in the center of the room' },
  { icon: Smartphone, text: 'Hold your phone vertically at chest height' },
  { icon: Lightbulb, text: 'Turn on all lights and open curtains' },
  { icon: DoorOpen, text: 'Keep doors open so doorways are visible' },
];

export default function GuidedCapture({ projectId, existingScenes, onComplete, onCancel }: GuidedCaptureProps) {
  const { user } = useAuth();
  const [flowStep, setFlowStep] = useState<FlowStep>('add-rooms');
  const [rooms, setRooms] = useState<Room[]>(
    existingScenes.map(s => ({
      id: s.id,
      name: s.name,
      imagePath: s.image_path,
      capturedBlob: null,
      connections: [],
    }))
  );
  const [newRoomName, setNewRoomName] = useState('');
  const [captureIndex, setCaptureIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const addRoom = () => {
    if (!newRoomName.trim()) return;
    setRooms(prev => [...prev, {
      id: '', name: newRoomName.trim(), imagePath: null, capturedBlob: null, connections: [],
    }]);
    setNewRoomName('');
  };

  const removeRoom = (idx: number) => {
    if (rooms[idx].id) return;
    setRooms(prev => prev.filter((_, i) => i !== idx));
  };
  const toggleConnection = (roomIdx: number, connectedName: string) => {
    setRooms(prev => prev.map((r, i) => {
      if (i !== roomIdx) return r;
      const has = r.connections.includes(connectedName);
      return { ...r, connections: has ? r.connections.filter(c => c !== connectedName) : [...r.connections, connectedName] };
    }));
  };

  // ── Save everything ──
  const saveAll = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Work with a mutable copy for ID assignment
      const updatedRooms = [...rooms];

      // 1. Insert new scenes
      for (let i = 0; i < updatedRooms.length; i++) {
        const room = updatedRooms[i];
        if (!room.id) {
          const { data, error } = await supabase.from('scenes').insert({
            project_id: projectId,
            name: room.name,
            sort_order: i,
          }).select().single();
          if (error) throw error;
          updatedRooms[i] = { ...room, id: data.id };
        }
      }

      // 2. Upload images
      for (const room of updatedRooms) {
        if (room.capturedBlob && room.id) {
          const path = await uploadPanorama(user.id, room.capturedBlob, `scene-${room.id}-${Date.now()}.jpg`);
          await supabase.from('scenes').update({ image_path: path }).eq('id', room.id);
        }
      }

      // 3. Create hotspot suggestions from connections
      for (const room of updatedRooms) {
        if (!room.id || room.connections.length === 0) continue;
        for (const connName of room.connections) {
          const target = updatedRooms.find(r => r.name === connName);
          if (!target?.id) continue;
          const { data: existing } = await supabase.from('hotspots')
            .select('id')
            .eq('source_scene_id', room.id)
            .eq('target_scene_id', target.id);
          if (existing && existing.length > 0) continue;
          const idx = room.connections.indexOf(connName);
          const spread = 80 / Math.max(room.connections.length, 1);
          const xPos = 10 + spread * idx + spread / 2;
          await supabase.from('hotspots').insert({
            source_scene_id: room.id,
            target_scene_id: target.id,
            position_x: xPos,
            position_y: 50,
            label: target.name,
          });
        }
      }

      // 4. Update rooms state with IDs
      setRooms(updatedRooms);

      // 5. Update project status
      await supabase.from('projects').update({ status: 'editing' }).eq('id', projectId);

      toast.success('All rooms saved!');
      setFlowStep('complete');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    }
    setSaving(false);
  };

  const totalRooms = rooms.length;
  const capturedCount = rooms.filter(r => r.imagePath || r.capturedBlob).length;
  const progress = totalRooms > 0 ? Math.round((capturedCount / totalRooms) * 100) : 0;

  const currentRoom = rooms[captureIndex];
  const roomsNeedingCapture = rooms.filter(r => !r.imagePath && !r.capturedBlob);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card/80 backdrop-blur-md">
        <button onClick={onCancel} className="p-1">
          <X className="h-5 w-5 text-muted-foreground" />
        </button>
        <div className="text-center">
          <p className="text-xs text-muted-foreground font-medium">
            {flowStep === 'add-rooms' && 'Step 1 — Add Rooms'}
            {flowStep === 'capture' && `Step 2 — Capture (${capturedCount}/${totalRooms})`}
            {flowStep === 'connections' && 'Step 3 — Connect Rooms'}
            {flowStep === 'complete' && 'Done!'}
          </p>
        </div>
        <div className="w-5" />
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{
            width: flowStep === 'add-rooms' ? '10%'
              : flowStep === 'capture' ? `${10 + progress * 0.6}%`
              : flowStep === 'connections' ? '85%'
              : '100%',
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* ─── ADD ROOMS ─── */}
        {flowStep === 'add-rooms' && (
          <div className="max-w-md mx-auto px-4 py-8 space-y-6 animate-fade-in-up">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold">Name your rooms</h2>
              <p className="text-sm text-muted-foreground">Add every room you want in your tour. You can always add more later.</p>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g. Living Room, Kitchen…"
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRoom())}
              />
              <Button onClick={addRoom} variant="outline" disabled={!newRoomName.trim()}>Add</Button>
            </div>

            {rooms.length > 0 && (
              <div className="space-y-2">
                {rooms.map((room, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-xs font-bold text-accent">
                      {i + 1}
                    </div>
                    <span className="flex-1 text-sm font-medium">{room.name}</span>
                    {room.imagePath && (
                      <span className="text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full">has image</span>
                    )}
                    {!room.id && (
                      <button onClick={() => removeRoom(i)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button
              className="w-full"
              disabled={rooms.length === 0}
              onClick={() => {
                const firstUncaptured = rooms.findIndex(r => !r.imagePath && !r.capturedBlob);
                if (firstUncaptured === -1) {
                  setFlowStep('connections');
                } else {
                  setCaptureIndex(firstUncaptured);
                  setFlowStep('capture');
                }
              }}
            >
              {roomsNeedingCapture.length > 0
                ? `Capture ${roomsNeedingCapture.length} Room${roomsNeedingCapture.length > 1 ? 's' : ''}`
                : 'Set Up Connections'}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}

        {/* ─── CAPTURE ─── */}
        {flowStep === 'capture' && currentRoom && (
          <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-fade-in-up">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Room {captureIndex + 1} of {totalRooms}</p>
            </div>

            <PanoramaCapture
              roomName={currentRoom.name}
              showUpload={true}
              onCapture={(blob) => {
                setRooms(prev => {
                  const updated = prev.map((r, i) => i === captureIndex ? { ...r, capturedBlob: blob } : r);
                  const nextIdx = updated.findIndex((r, i) => i > captureIndex && !r.imagePath && !r.capturedBlob);
                  if (nextIdx !== -1) {
                    setCaptureIndex(nextIdx);
                  } else {
                    setFlowStep('connections');
                  }
                  return updated;
                });
              }}
              onUpload={(file) => {
                setRooms(prev => {
                  const updated = prev.map((r, i) => i === captureIndex ? { ...r, capturedBlob: file } : r);
                  const nextIdx = updated.findIndex((r, i) => i > captureIndex && !r.imagePath && !r.capturedBlob);
                  if (nextIdx !== -1) {
                    setCaptureIndex(nextIdx);
                  } else {
                    setFlowStep('connections');
                  }
                  return updated;
                });
              }}
              onCancel={() => {
                const nextIdx = rooms.findIndex((r, i) => i > captureIndex && !r.imagePath && !r.capturedBlob);
                if (nextIdx !== -1) setCaptureIndex(nextIdx);
                else setFlowStep('connections');
              }}
            />

            {/* Rooms strip */}
            <div className="flex gap-2 overflow-x-auto pb-2 pt-2">
              {rooms.map((r, i) => {
                const done = !!(r.imagePath || r.capturedBlob);
                const active = i === captureIndex;
                return (
                  <button
                    key={i}
                    onClick={() => { if (!done) setCaptureIndex(i); }}
                    className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      active ? 'bg-accent text-accent-foreground border-accent' :
                      done ? 'bg-accent/10 text-accent border-accent/20' :
                      'bg-muted text-muted-foreground border-transparent'
                    }`}
                  >
                    {done && <CheckCircle2 className="h-3 w-3 inline mr-1" />}
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── CONNECTIONS ─── */}
        {flowStep === 'connections' && (
          <div className="max-w-md mx-auto px-4 py-8 space-y-6 animate-fade-in-up">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold">Connect your rooms</h2>
              <p className="text-sm text-muted-foreground">
                For each room, select which rooms are directly connected (through doors, hallways, etc.)
              </p>
            </div>

            <div className="space-y-4">
              {rooms.map((room, i) => (
                <div key={i} className="p-4 rounded-xl border bg-card space-y-3">
                  <div className="flex items-center gap-2">
                    <DoorOpen className="h-4 w-4 text-accent" />
                    <span className="font-medium text-sm">{room.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rooms.filter((_, j) => j !== i).map(other => {
                      const selected = room.connections.includes(other.name);
                      return (
                        <button
                          key={other.name}
                          onClick={() => toggleConnection(i, other.name)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                            selected
                              ? 'bg-accent text-accent-foreground border-accent'
                              : 'bg-muted/50 text-muted-foreground border-transparent hover:border-accent/30'
                          }`}
                        >
                          {selected && <Check className="h-3 w-3 inline mr-1" />}
                          {other.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setFlowStep('capture')} className="flex-1">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={saveAll} disabled={saving} className="flex-1">
                {saving ? 'Saving…' : 'Save Tour'} <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            <button onClick={() => { setFlowStep('complete'); onComplete(); }} className="text-xs text-muted-foreground hover:text-foreground mx-auto block">
              Skip connections for now →
            </button>
          </div>
        )}

        {/* ─── COMPLETE ─── */}
        {flowStep === 'complete' && (
          <div className="max-w-md mx-auto px-4 py-16 text-center space-y-6 animate-fade-in-up">
            <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-10 w-10 text-accent" />
            </div>
            <h2 className="text-xl font-bold">Tour setup complete!</h2>
            <p className="text-sm text-muted-foreground">
              {capturedCount} of {totalRooms} rooms captured. You can refine hotspots and add more rooms from the editor.
            </p>
            <Button onClick={onComplete} size="lg">
              Go to Editor <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
