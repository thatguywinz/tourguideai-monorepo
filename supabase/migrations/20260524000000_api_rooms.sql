-- api_rooms: persistent storage for FastAPI backend room records.
-- The FastAPI backend uses the Supabase service role key to bypass RLS,
-- so no per-user policies are needed on this table.

CREATE TABLE IF NOT EXISTS public.api_rooms (
  room_id       text        PRIMARY KEY,
  room_name     text        NOT NULL,
  filename      text        NOT NULL,
  source_type   text        NOT NULL DEFAULT 'panorama',
  status        text        NOT NULL DEFAULT 'uploaded',
  panorama_url  text,
  preview_url   text,
  viewer_type   text,
  viewer_config jsonb,
  processing_stage text,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- No RLS — the backend accesses this table via the service role key only.
ALTER TABLE public.api_rooms DISABLE ROW LEVEL SECURITY;

-- Keep updated_at current automatically.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER api_rooms_updated_at
  BEFORE UPDATE ON public.api_rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
