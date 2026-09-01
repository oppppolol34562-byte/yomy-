/* Restrict private message attachments to conversation participants. */

DROP POLICY IF EXISTS "Messages Authenticated Read" ON storage.objects;
DROP POLICY IF EXISTS messages_attachments_read ON storage.objects;
CREATE POLICY messages_attachments_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'messages'
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.storage_path = name
        AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Messages User Insert" ON storage.objects;
DROP POLICY IF EXISTS messages_attachments_upload ON storage.objects;
CREATE POLICY messages_attachments_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'messages'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Messages User Delete" ON storage.objects;
DROP POLICY IF EXISTS messages_attachments_delete ON storage.objects;
CREATE POLICY messages_attachments_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'messages'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );
