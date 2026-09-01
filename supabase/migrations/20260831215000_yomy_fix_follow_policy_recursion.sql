/* Prevent follows_select from recursively querying follows through its own RLS. */
CREATE OR REPLACE FUNCTION public.is_accepted_follower(viewer_id uuid, target_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = viewer_id
      AND f.following_id = target_id
      AND f.status = 'accepted'
  );
$$;
REVOKE ALL ON FUNCTION public.is_accepted_follower(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_accepted_follower(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS follows_select ON public.follows;
CREATE POLICY follows_select ON public.follows
  FOR SELECT TO authenticated
  USING (
    auth.uid() = follower_id
    OR auth.uid() = following_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = follows.following_id
        AND (
          p.show_followers_to = 'everyone'
          OR (p.show_followers_to = 'followers' AND public.is_accepted_follower(auth.uid(), p.id))
        )
    )
  );
