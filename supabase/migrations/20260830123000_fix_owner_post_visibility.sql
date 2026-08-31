/*
  YOMY visibility fix for post owners.
  Owners can see their own non-deleted posts while moderation is pending,
  while other viewers can only see published and safe posts.
*/

CREATE OR REPLACE FUNCTION public.can_view_post(
  viewer_id uuid,
  post_id uuid
)
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
      AND (
        -- The owner can track their own draft/moderation/rejected post.
        -- Deleted posts remain hidden.
        (
          p.user_id = viewer_id
          AND p.status <> 'deleted'
        )
        OR (
          -- Everyone else only sees a published, safe post.
          p.status = 'published'
          AND p.moderation_status = 'safe'
          AND NOT EXISTS (
            SELECT 1
            FROM public.blocks b
            WHERE (b.blocker_id = p.user_id AND b.blocked_id = viewer_id)
               OR (b.blocker_id = viewer_id AND b.blocked_id = p.user_id)
          )
          AND (
            -- Public post from a public account.
            (p.visibility = 'public' AND author.is_private = false)
            OR (
              -- Public post from a private account, visible to followers.
              p.visibility = 'public'
              AND author.is_private = true
              AND EXISTS (
                SELECT 1
                FROM public.follows f
                WHERE f.follower_id = viewer_id
                  AND f.following_id = p.user_id
                  AND f.status = 'accepted'
              )
            )
            OR (
              -- Friends-only post requires a mutual accepted follow.
              p.visibility = 'friends'
              AND EXISTS (
                SELECT 1
                FROM public.follows f1
                WHERE f1.follower_id = viewer_id
                  AND f1.following_id = p.user_id
                  AND f1.status = 'accepted'
              )
              AND EXISTS (
                SELECT 1
                FROM public.follows f2
                WHERE f2.follower_id = p.user_id
                  AND f2.following_id = viewer_id
                  AND f2.status = 'accepted'
              )
            )
          )
        )
      )
  );
$$;
