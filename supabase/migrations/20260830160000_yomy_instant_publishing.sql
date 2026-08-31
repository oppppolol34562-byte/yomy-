/*
  YOMY instant publishing
  Moderation is no longer part of the publish path. The legacy moderation
  columns remain only so existing clients and rows keep working.
*/

ALTER TABLE public.posts ALTER COLUMN status SET DEFAULT 'published';
ALTER TABLE public.posts ALTER COLUMN moderation_status SET DEFAULT 'safe';
ALTER TABLE public.posts ALTER COLUMN publish_requested SET DEFAULT true;

-- Stop the old server-side gate and duplicate-media blocker.
DROP TRIGGER IF EXISTS protect_post_pipeline_fields_trigger ON public.posts;
DROP TRIGGER IF EXISTS protect_post_media_hash_trigger ON public.posts;
DROP FUNCTION IF EXISTS public.protect_post_pipeline_fields();
DROP FUNCTION IF EXISTS public.protect_post_media_hash();
DROP INDEX IF EXISTS public.posts_media_hash_unique_idx;

-- Existing uploaded, non-deleted posts should not remain trapped in the old queue.
UPDATE public.posts
SET status = 'published',
    moderation_status = 'safe',
    publish_requested = true,
    published_at = COALESCE(published_at, created_at, now())
WHERE status NOT IN ('published', 'deleted', 'archived')
  AND COALESCE(media_url, '') <> '';

CREATE OR REPLACE FUNCTION public.can_view_post(viewer_id uuid, post_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.posts p
    JOIN public.profiles author ON author.id = p.user_id
    WHERE p.id = post_id
      AND p.status = 'published'
      AND (
        p.user_id = viewer_id
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.blocks b
            WHERE (b.blocker_id = p.user_id AND b.blocked_id = viewer_id)
               OR (b.blocker_id = viewer_id AND b.blocked_id = p.user_id)
          )
          AND (
            (p.visibility = 'public' AND author.is_private = false)
            OR (p.visibility = 'public' AND author.is_private = true AND EXISTS (
              SELECT 1 FROM public.follows f
              WHERE f.follower_id = viewer_id AND f.following_id = p.user_id AND f.status = 'accepted'
            ))
            OR (p.visibility = 'friends' AND EXISTS (
              SELECT 1 FROM public.follows f1
              WHERE f1.follower_id = viewer_id AND f1.following_id = p.user_id AND f1.status = 'accepted'
            ) AND EXISTS (
              SELECT 1 FROM public.follows f2
              WHERE f2.follower_id = p.user_id AND f2.following_id = viewer_id AND f2.status = 'accepted'
            ))
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "posts_select" ON public.posts;
CREATE POLICY "posts_select" ON public.posts FOR SELECT TO authenticated
  USING (public.can_view_post(auth.uid(), posts.id));

DROP POLICY IF EXISTS "posts_insert" ON public.posts;
CREATE POLICY "posts_insert" ON public.posts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status <> 'deleted');

DROP POLICY IF EXISTS "posts_update" ON public.posts;
CREATE POLICY "posts_update" ON public.posts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status <> 'deleted');

-- Keep the old RPC callable for older clients, but make it a direct publish operation.
CREATE OR REPLACE FUNCTION public.publish_post(p_post_id uuid, p_request_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE post_row public.posts%ROWTYPE;
BEGIN
  SELECT * INTO post_row FROM public.posts
  WHERE id = p_post_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found'; END IF;
  PERFORM set_config('yomy.post_pipeline_context', 'true', true);
  UPDATE public.posts
  SET status = 'published', moderation_status = 'safe', publish_requested = true,
      published_at = COALESCE(published_at, now())
  WHERE id = p_post_id;
  RETURN jsonb_build_object('published', true, 'status', 'published', 'post_id', p_post_id);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_post(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_post(uuid, text) TO authenticated;
