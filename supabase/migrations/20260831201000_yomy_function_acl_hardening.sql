/* Yomy function ACL hardening. */

REVOKE ALL ON FUNCTION public.open_view_once_message(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_view_once_message(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_view_once_message(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;
