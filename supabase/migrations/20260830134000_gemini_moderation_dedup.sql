-- Gemini moderation support and server-side duplicate protection for posts/reels.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS media_hash text;
CREATE TABLE IF NOT EXISTS public.media_fingerprints (
  media_hash text PRIMARY KEY,
  first_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'safe', 'rejected', 'review', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.media_fingerprints ENABLE ROW LEVEL SECURITY;


CREATE UNIQUE INDEX IF NOT EXISTS posts_media_hash_unique_idx
  ON public.posts (media_hash)
  WHERE media_hash IS NOT NULL AND status <> 'deleted';

CREATE OR REPLACE FUNCTION public.protect_post_media_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('yomy.post_pipeline_context', true) <> 'true'
     AND current_setting('request.jwt.claim.role', true) <> 'service_role'
     AND NEW.media_hash IS DISTINCT FROM OLD.media_hash THEN
    RAISE EXCEPTION 'Media hash is server-controlled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_post_media_hash_trigger ON public.posts;
CREATE TRIGGER protect_post_media_hash_trigger
  BEFORE UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE PROCEDURE public.protect_post_media_hash();


-- Keep the existing shared bucket used by posts, videos, stories, and chat media.
INSERT INTO storage.buckets (id, name, public)
VALUES ('posts', 'posts', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "posts_storage_public_read" ON storage.objects;
CREATE POLICY "posts_storage_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'posts');

DROP POLICY IF EXISTS "posts_storage_authenticated_insert" ON storage.objects;
CREATE POLICY "posts_storage_authenticated_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'posts'
    AND name ~ ('^(images|videos|stories|audio)/' || auth.uid()::text || '-')
  );

DROP POLICY IF EXISTS "posts_storage_owner_delete" ON storage.objects;
CREATE POLICY "posts_storage_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'posts'
    AND name ~ ('^(images|videos|stories|audio)/' || auth.uid()::text || '-')
  );
