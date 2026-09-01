/* Only authenticated users may call the legacy publish helper. */
REVOKE ALL ON FUNCTION public.publish_post(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_post(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.publish_post(uuid, text) TO authenticated;
