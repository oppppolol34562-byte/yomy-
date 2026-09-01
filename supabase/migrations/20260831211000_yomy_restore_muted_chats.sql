/* Restore the table required by the message notification trigger. */

CREATE TABLE IF NOT EXISTS public.muted_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, muted_user_id)
);

ALTER TABLE public.muted_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS muted_chats_select ON public.muted_chats;
CREATE POLICY muted_chats_select ON public.muted_chats
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS muted_chats_insert ON public.muted_chats;
CREATE POLICY muted_chats_insert ON public.muted_chats
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS muted_chats_delete ON public.muted_chats;
CREATE POLICY muted_chats_delete ON public.muted_chats
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
