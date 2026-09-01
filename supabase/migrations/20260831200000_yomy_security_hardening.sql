/* Yomy security hardening for exposed RLS helpers and publish requests. */

ALTER FUNCTION public.update_updated_at() SET search_path = public;

REVOKE ALL ON FUNCTION public.can_send_message(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_send_message(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_send_message(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_view_post(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_post(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_post(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated;

DROP POLICY IF EXISTS post_publish_requests_select ON public.post_publish_requests;
CREATE POLICY post_publish_requests_select ON public.post_publish_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS post_publish_requests_insert ON public.post_publish_requests;
CREATE POLICY post_publish_requests_insert ON public.post_publish_requests
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS post_publish_requests_delete ON public.post_publish_requests;
CREATE POLICY post_publish_requests_delete ON public.post_publish_requests
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_id AND p.user_id = auth.uid()));
