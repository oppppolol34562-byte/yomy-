/*
  YOMY post upload pipeline hardening
  - Moderation owns the protected lifecycle fields.
  - Client requests publication; it cannot mark a post safe or published.
  - Publication is idempotent and only possible after a server-side SAFE result.
*/

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS publish_requested boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS post_publish_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, request_key)
);

ALTER TABLE post_publish_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS posts_moderation_queue_idx
  ON posts (status, moderation_status, publish_requested);

CREATE OR REPLACE FUNCTION public.protect_post_pipeline_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_pipeline_worker boolean := current_setting('yomy.post_pipeline_context', true) = 'true' OR current_setting('request.jwt.claim.role', true) = 'service_role';
BEGIN
  IF is_pipeline_worker THEN
    RETURN NEW;
  END IF;

  -- Authenticated clients may create a moderation-pending draft only.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft', 'uploading', 'processing', 'moderation')
       OR NEW.moderation_status <> 'pending' THEN
      RAISE EXCEPTION 'Posts must enter through the moderation pipeline';
    END IF;
    RETURN NEW;
  END IF;

  -- Clients may edit composition fields, but cannot forge moderation or lifecycle state.
  IF NEW.status IN ('ready', 'published')
     OR NEW.moderation_status IS DISTINCT FROM OLD.moderation_status
     OR NEW.moderation_result IS DISTINCT FROM OLD.moderation_result
     OR NEW.moderated_at IS DISTINCT FROM OLD.moderated_at
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'Post lifecycle fields are server-controlled';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_post_pipeline_fields_trigger ON posts;
CREATE TRIGGER protect_post_pipeline_fields_trigger
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW
  EXECUTE PROCEDURE public.protect_post_pipeline_fields();

DROP POLICY IF EXISTS "posts_insert" ON posts;
CREATE POLICY "posts_insert" ON posts FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status IN ('draft', 'uploading', 'processing', 'moderation')
    AND moderation_status = 'pending'
  );

DROP POLICY IF EXISTS "posts_update" ON posts;
CREATE POLICY "posts_update" ON posts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status <> 'published');

-- Secure, idempotent publication entry point for the authenticated owner.
CREATE OR REPLACE FUNCTION public.publish_post(
  p_post_id uuid,
  p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  post_row posts%ROWTYPE;
BEGIN
  IF p_request_key IS NULL OR length(trim(p_request_key)) < 16 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  SELECT * INTO post_row
  FROM posts
  WHERE id = p_post_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post not found';
  END IF;

  INSERT INTO post_publish_requests (post_id, request_key)
  VALUES (p_post_id, trim(p_request_key))
  ON CONFLICT (post_id, request_key) DO NOTHING;

  IF post_row.status = 'published' THEN
    RETURN jsonb_build_object(
      'published', true,
      'status', post_row.status,
      'moderation_status', post_row.moderation_status,
      'post_id', post_row.id
    );
  END IF;

  IF post_row.moderation_status <> 'safe' THEN
    RETURN jsonb_build_object(
      'published', false,
      'status', post_row.status,
      'moderation_status', post_row.moderation_status,
      'post_id', post_row.id
    );
  END IF;

  PERFORM set_config('yomy.post_pipeline_context', 'true', true);

  UPDATE posts
  SET status = 'published',
      published_at = COALESCE(published_at, now()),
      publish_requested = true
  WHERE id = p_post_id;

  RETURN jsonb_build_object(
    'published', true,
    'status', 'published',
    'moderation_status', 'safe',
    'post_id', p_post_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_post(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_post(uuid, text) TO authenticated;
