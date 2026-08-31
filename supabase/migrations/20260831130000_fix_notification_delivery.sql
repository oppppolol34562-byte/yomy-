/*
  Centralize notification creation in database triggers.
  This prevents missed notifications when a client is offline and prevents
  duplicate notifications when the web and native clients both send events.
*/

CREATE OR REPLACE FUNCTION public.notify_message_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.muted_chats
    WHERE user_id = NEW.receiver_id
      AND muted_user_id = NEW.sender_id
  ) THEN
    INSERT INTO public.notifications (user_id, actor_id, type)
    VALUES (NEW.receiver_id, NEW.sender_id, 'message');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_notification_trigger ON public.messages;
CREATE TRIGGER messages_notification_trigger
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_message_recipient();

CREATE OR REPLACE FUNCTION public.notify_follow_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, actor_id, type)
    VALUES (NEW.following_id, NEW.follower_id, 'follow_request');
  ELSIF NEW.status = 'accepted'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notifications (user_id, actor_id, type)
    VALUES (NEW.follower_id, NEW.following_id, 'follow');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follows_notification_trigger ON public.follows;
CREATE TRIGGER follows_notification_trigger
AFTER INSERT OR UPDATE OF status ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.notify_follow_change();

CREATE OR REPLACE FUNCTION public.notify_post_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, actor_id, type, post_id)
  SELECT posts.user_id, NEW.user_id, 'like', NEW.post_id
  FROM public.posts
  WHERE posts.id = NEW.post_id
    AND posts.user_id <> NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS likes_notification_trigger ON public.likes;
CREATE TRIGGER likes_notification_trigger
AFTER INSERT ON public.likes
FOR EACH ROW
EXECUTE FUNCTION public.notify_post_like();

CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, actor_id, type, post_id, comment_id)
  SELECT posts.user_id, NEW.user_id, 'comment', NEW.post_id, NEW.id
  FROM public.posts
  WHERE posts.id = NEW.post_id
    AND posts.user_id <> NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_notification_trigger ON public.comments;
CREATE TRIGGER comments_notification_trigger
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.notify_post_comment();