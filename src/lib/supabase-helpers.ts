import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type Project = Tables<'projects'>;
export type Scene = Tables<'scenes'>;
export type Hotspot = Tables<'hotspots'>;

// Storage helpers
export function getPanoramaUrl(path: string): string {
  const { data } = supabase.storage.from('panoramas').getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadPanorama(userId: string, file: File | Blob, fileName?: string): Promise<string> {
  const name = fileName || `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const path = `${userId}/${name}`;
  const { error } = await supabase.storage.from('panoramas').upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

export async function deletePanorama(path: string): Promise<void> {
  await supabase.storage.from('panoramas').remove([path]);
}

// Room media storage helpers
export async function uploadRoomMediaFile(userId: string, file: File, roomId: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = `${userId}/${roomId}/${name}`;
  const { error } = await supabase.storage.from('room-media').upload(path, file);
  if (error) throw error;
  return path;
}

export function getRoomMediaUrl(path: string): string {
  const { data } = supabase.storage.from('room-media').getPublicUrl(path);
  return data.publicUrl;
}
