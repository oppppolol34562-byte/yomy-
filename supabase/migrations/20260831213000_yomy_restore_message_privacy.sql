/* Restore message privacy checks after restoring muted_chats. */
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND public.can_send_message(sender_id, receiver_id));
