
-- Create storage bucket for panorama images
INSERT INTO storage.buckets (id, name, public) VALUES ('panoramas', 'panoramas', true);

-- Storage policies
CREATE POLICY "Anyone can view panoramas" ON storage.objects FOR SELECT USING (bucket_id = 'panoramas');
CREATE POLICY "Authenticated users can upload panoramas" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'panoramas' AND auth.role() = 'authenticated');
CREATE POLICY "Users can update their own panoramas" ON storage.objects FOR UPDATE USING (bucket_id = 'panoramas' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own panoramas" ON storage.objects FOR DELETE USING (bucket_id = 'panoramas' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'editing', 'published')),
  published_slug TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own projects" ON public.projects FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Published projects are publicly viewable" ON public.projects FOR SELECT USING (status = 'published' AND published_slug IS NOT NULL);

-- Scenes table
CREATE TABLE public.scenes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view scenes of own projects" ON public.scenes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
);
CREATE POLICY "Public scenes for published projects" ON public.scenes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND status = 'published')
);
CREATE POLICY "Users can create scenes" ON public.scenes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update scenes" ON public.scenes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete scenes" ON public.scenes FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
);

-- Hotspots table
CREATE TABLE public.hotspots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  target_scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  label TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.hotspots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view hotspots of own projects" ON public.hotspots FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON s.project_id = p.id WHERE s.id = source_scene_id AND p.user_id = auth.uid())
);
CREATE POLICY "Public hotspots for published projects" ON public.hotspots FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON s.project_id = p.id WHERE s.id = source_scene_id AND p.status = 'published')
);
CREATE POLICY "Users can create hotspots" ON public.hotspots FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON s.project_id = p.id WHERE s.id = source_scene_id AND p.user_id = auth.uid())
);
CREATE POLICY "Users can update hotspots" ON public.hotspots FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON s.project_id = p.id WHERE s.id = source_scene_id AND p.user_id = auth.uid())
);
CREATE POLICY "Users can delete hotspots" ON public.hotspots FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.scenes s JOIN public.projects p ON s.project_id = p.id WHERE s.id = source_scene_id AND p.user_id = auth.uid())
);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scenes_updated_at BEFORE UPDATE ON public.scenes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
