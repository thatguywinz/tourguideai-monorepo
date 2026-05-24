
-- Add new columns to scenes table for 3D reconstruction
ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS scene_url text;
ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS thumbnail_url text;
ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS viewer_type text NOT NULL DEFAULT 'glb';
ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS media_count integer NOT NULL DEFAULT 0;

-- Create reconstruction_jobs table
CREATE TABLE public.reconstruction_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  external_job_id text,
  progress_pct integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.reconstruction_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reconstruction jobs"
ON public.reconstruction_jobs FOR SELECT
USING (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = reconstruction_jobs.room_id AND p.user_id = auth.uid()
));

CREATE POLICY "Users can create reconstruction jobs"
ON public.reconstruction_jobs FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = reconstruction_jobs.room_id AND p.user_id = auth.uid()
));

CREATE POLICY "Users can update own reconstruction jobs"
ON public.reconstruction_jobs FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = reconstruction_jobs.room_id AND p.user_id = auth.uid()
));

CREATE POLICY "Users can delete own reconstruction jobs"
ON public.reconstruction_jobs FOR DELETE
USING (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = reconstruction_jobs.room_id AND p.user_id = auth.uid()
));

-- Public read for published projects
CREATE POLICY "Public reconstruction jobs for published projects"
ON public.reconstruction_jobs FOR SELECT
USING (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = reconstruction_jobs.room_id AND p.status = 'published'
));

-- Create room_media table
CREATE TABLE public.room_media (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_type text NOT NULL DEFAULT 'image',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.room_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own room media"
ON public.room_media FOR SELECT
USING (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = room_media.room_id AND p.user_id = auth.uid()
));

CREATE POLICY "Users can create room media"
ON public.room_media FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = room_media.room_id AND p.user_id = auth.uid()
));

CREATE POLICY "Users can delete own room media"
ON public.room_media FOR DELETE
USING (EXISTS (
  SELECT 1 FROM scenes s JOIN projects p ON s.project_id = p.id
  WHERE s.id = room_media.room_id AND p.user_id = auth.uid()
));

-- Create storage bucket for room media uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('room-media', 'room-media', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload room media files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'room-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own room media files"
ON storage.objects FOR SELECT
USING (bucket_id = 'room-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own room media files"
ON storage.objects FOR DELETE
USING (bucket_id = 'room-media' AND auth.uid()::text = (storage.foldername(name))[1]);
