/* Chat reactions, replies, per-user deletion, editing, and native push tokens. */
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_sender boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_for_receiver boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx ON public.messages(reply_to_id);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())));
DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
CREATE POLICY message_reactions_insert ON public.message_reactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())));
DROP POLICY IF EXISTS message_reactions_delete ON public.message_reactions;
CREATE POLICY message_reactions_delete ON public.message_reactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS message_reactions_message_id_idx ON public.message_reactions(message_id);

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_tokens_select ON public.push_tokens;
CREATE POLICY push_tokens_select ON public.push_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS push_tokens_insert ON public.push_tokens;
CREATE POLICY push_tokens_insert ON public.push_tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS push_tokens_update ON public.push_tokens;
CREATE POLICY push_tokens_update ON public.push_tokens FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS push_tokens_delete ON public.push_tokens;
CREATE POLICY push_tokens_delete ON public.push_tokens FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON public.push_tokens(user_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
