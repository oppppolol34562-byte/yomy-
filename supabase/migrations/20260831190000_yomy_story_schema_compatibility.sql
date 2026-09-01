/* Yomy story schema compatibility: add the audience column safely. */

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stories'
      AND column_name = 'visibility'
  ) THEN
    ALTER TABLE public.stories ADD COLUMN visibility text;
  END IF;
END $$;

UPDATE public.stories AS s
SET visibility = CASE
  WHEN s.visibility IN ('everyone', 'followers') THEN s.visibility
  WHEN COALESCE(p.is_private, false) THEN 'followers'
  ELSE 'everyone'
END
FROM public.profiles AS p
WHERE p.id = s.user_id OR s.visibility IS NULL OR s.visibility NOT IN ('everyone', 'followers');

ALTER TABLE public.stories ALTER COLUMN visibility SET DEFAULT 'followers';
ALTER TABLE public.stories ALTER COLUMN visibility SET NOT NULL;
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_visibility_check;
ALTER TABLE public.stories ADD CONSTRAINT stories_visibility_check CHECK (visibility IN ('everyone', 'followers'));
CREATE INDEX IF NOT EXISTS stories_visibility_expires_at_idx ON public.stories (visibility, expires_at);
