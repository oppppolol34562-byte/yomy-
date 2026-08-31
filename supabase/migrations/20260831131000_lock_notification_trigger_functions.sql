/*
  Notification functions are trigger implementation details, not public RPCs.
*/

REVOKE EXECUTE ON FUNCTION public.notify_message_recipient() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_follow_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_post_like() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_post_comment() FROM PUBLIC, anon, authenticated;