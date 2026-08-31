/* Preserve the old public-story behavior when adding explicit audiences. */
UPDATE public.stories AS s
SET visibility = CASE WHEN p.is_private THEN 'followers' ELSE 'everyone' END
FROM public.profiles AS p
WHERE p.id = s.user_id
  AND s.visibility = 'followers';
