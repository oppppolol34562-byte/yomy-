/* Yomy runtime compatibility: direct publishing, media uploads, comments, and view-once chat. */

-- Publishing is direct. Keep legacy columns for old clients, but remove all server review gates.
DROP TRIGGER IF EXISTS protect_post_pipeline_fields_trigger ON public.posts;
DROP TRIGGER IF EXISTS protect_post_media_hash_trigger ON public.posts;
DROP FUNCTION IF EXISTS public.protect_post_pipeline_fields();
DROP FUNCTION IF EXISTS public.protect_post_media_hash();
DROP INDEX IF EXISTS public.posts_media_hash_unique_idx;
ALTER TABLE public.posts ALTER COLUMN status SET DEFAULT 'published';
ALTER TABLE public.posts ALTER COLUMN moderation_status SET DEFAULT 'safe';
ALTER TABLE public.posts ALTER COLUMN publish_requested SET DEFAULT true;
UPDATE public.posts SET status = 'published', moderation_status = 'safe', publish_requested = true, published_at = COALESCE(published_at, created_at, now()) WHERE status NOT IN ('published', 'deleted', 'archived') AND COALESCE(media_url, '') <> '';

CREATE OR REPLACE FUNCTION public.can_view_post(viewer_id uuid, post_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.posts p
    JOIN public.profiles author ON author.id = p.user_id
    WHERE p.id = post_id AND p.status = 'published'
      AND (p.user_id = viewer_id OR (
        NOT EXISTS (SELECT 1 FROM public.blocks b WHERE (b.blocker_id = p.user_id AND b.blocked_id = viewer_id) OR (b.blocker_id = viewer_id AND b.blocked_id = p.user_id))
        AND ((p.visibility = 'public' AND author.is_private = false)
          OR (p.visibility = 'public' AND author.is_private = true AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = viewer_id AND f.following_id = p.user_id AND f.status = 'accepted'))
          OR (p.visibility = 'friends' AND EXISTS (SELECT 1 FROM public.follows f1 WHERE f1.follower_id = viewer_id AND f1.following_id = p.user_id AND f1.status = 'accepted') AND EXISTS (SELECT 1 FROM public.follows f2 WHERE f2.follower_id = p.user_id AND f2.following_id = viewer_id AND f2.status = 'accepted'))))
      )
  );
$$;

DROP POLICY IF EXISTS "posts_insert" ON public.posts;
CREATE POLICY "posts_insert" ON public.posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND status <> 'deleted');
DROP POLICY IF EXISTS "posts_update" ON public.posts;
CREATE POLICY "posts_update" ON public.posts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND status <> 'deleted');
DROP POLICY IF EXISTS "posts_select" ON public.posts;
CREATE POLICY "posts_select" ON public.posts FOR SELECT TO authenticated USING (public.can_view_post(auth.uid(), posts.id));

-- Comments and reactions must follow the post's visibility instead of leaking through broad SELECT policies.
DROP POLICY IF EXISTS "comments_select" ON public.comments;
CREATE POLICY "comments_select" ON public.comments FOR SELECT TO authenticated USING (public.can_view_post(auth.uid(), post_id));
DROP POLICY IF EXISTS "comment_likes_select" ON public.comment_likes;
CREATE POLICY "comment_likes_select" ON public.comment_likes FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_id AND public.can_view_post(auth.uid(), c.post_id)));
DROP POLICY IF EXISTS "likes_select" ON public.likes;
CREATE POLICY "likes_select" ON public.likes FOR SELECT TO authenticated USING (public.can_view_post(auth.uid(), post_id));
DROP POLICY IF EXISTS "post_tags_select" ON public.post_tags;
CREATE POLICY "post_tags_select" ON public.post_tags FOR SELECT TO authenticated USING (public.can_view_post(auth.uid(), post_id));

-- Keep all attachment types used by the app valid in the database.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS storage_path text;
UPDATE public.messages SET storage_path = regexp_replace(media_url, '^.*/storage/v1/object/public/messages/', '') WHERE COALESCE(storage_path, '') = '' AND media_url LIKE '%/storage/v1/object/public/messages/%';
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_media_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_media_type_check CHECK (media_type IN ('', 'image', 'video', 'audio', 'document', 'apk', 'file'));

-- New message attachments are private. Existing public URLs are converted to paths above.
INSERT INTO storage.buckets (id, name, public) VALUES ('messages', 'messages', false) ON CONFLICT (id) DO UPDATE SET public = false;

-- Atomically consume a view-once attachment. Only the recipient can open it, and only once.
CREATE OR REPLACE FUNCTION public.open_view_once_message(p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE opened_message public.messages%ROWTYPE;
BEGIN
  UPDATE public.messages
  SET view_once_opened = true
  WHERE id = p_message_id
    AND receiver_id = auth.uid()
    AND view_once = true
    AND COALESCE(view_once_opened, false) = false
  RETURNING * INTO opened_message;
  IF NOT FOUND THEN RETURN jsonb_build_object('opened', false); END IF;
  RETURN jsonb_build_object('opened', true, 'media_url', opened_message.media_url, 'storage_path', opened_message.storage_path, 'media_type', opened_message.media_type);
END;
$$;
REVOKE ALL ON FUNCTION public.open_view_once_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_view_once_message(uuid) TO authenticated;
