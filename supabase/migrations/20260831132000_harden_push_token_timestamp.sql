/*
  Keep the trigger helper deterministic even if the caller controls its
  search_path. The function only needs built-in PostgreSQL objects.
*/

CREATE OR REPLACE FUNCTION public.update_push_token_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;