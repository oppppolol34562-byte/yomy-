/* YOMY interaction permissions, story audiences, and realtime notifications */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stories' AND column_name = 'visibility') THEN
    ALTER TABLE public.stories ADD COLUMN visibility text NOT NULL DEFAULT 'followers';
  END IF;
END $$;
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_visibility_check;
ALTER TABLE public.stories ADD CONSTRAINT stories_visibility_check CHECK (visibility IN ('everyone', 'followers'));
CREATE INDEX IF NOT EXISTS stories_visibility_idx ON public.stories (visibility, expires_at);
CREATE OR REPLACE FUNCTION public.can_send_message(sender_id uuid, receiver_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT sender_id <> receiver_id
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = receiver_id AND (p.who_can_message = 'everyone' OR (p.who_can_message = 'followers' AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = sender_id AND f.following_id = receiver_id AND f.status = 'accepted'))))
    AND NOT EXISTS (SELECT 1 FROM public.blocks b WHERE (b.blocker_id = sender_id AND b.blocked_id = receiver_id) OR (b.blocker_id = receiver_id AND b.blocked_id = sender_id));
$$;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id AND public.can_send_message(sender_id, receiver_id));
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'message', 'mention', 'story_reply'));
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id AND user_id <> auth.uid());
DROP POLICY IF EXISTS "stories_select" ON public.stories;
CREATE POLICY "stories_select" ON public.stories FOR SELECT TO authenticated USING (expires_at > now() AND (user_id = auth.uid() OR (NOT EXISTS (SELECT 1 FROM public.blocks b WHERE (b.blocker_id = stories.user_id AND b.blocked_id = auth.uid()) OR (b.blocker_id = auth.uid() AND b.blocked_id = stories.user_id)) AND EXISTS (SELECT 1 FROM public.profiles author WHERE author.id = stories.user_id AND ((author.is_private = false AND (stories.visibility = 'everyone' OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.following_id = stories.user_id AND f.status = 'accepted'))) OR (author.is_private = true AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = auth.uid() AND f.following_id = stories.user_id AND f.status = 'accepted'))))));
CREATE OR REPLACE FUNCTION public.notify_message_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.muted_chats m WHERE m.user_id = NEW.receiver_id AND m.muted_user_id = NEW.sender_id) THEN
    INSERT INTO public.notifications (user_id, actor_id, type) VALUES (NEW.receiver_id, NEW.sender_id, 'message');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS messages_notification_trigger ON public.messages;
CREATE TRIGGER messages_notification_trigger AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.notify_message_recipient();
CREATE OR REPLACE FUNCTION public.notify_follow_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, actor_id, type) VALUES (NEW.following_id, NEW.follower_id, 'follow_request');
  ELSIF NEW.status = 'accepted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notifications (user_id, actor_id, type) VALUES (NEW.follower_id, NEW.following_id, 'follow');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS follows_notification_trigger ON public.follows;
CREATE TRIGGER follows_notification_trigger AFTER INSERT OR UPDATE OF status ON public.follows FOR EACH ROW EXECUTE FUNCTION public.notify_follow_change();
