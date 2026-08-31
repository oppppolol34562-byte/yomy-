-- Presence, last-seen privacy, message attachments, and realtime hardening.

    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
    ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_last_seen boolean NOT NULL DEFAULT true;
    CREATE INDEX IF NOT EXISTS profiles_presence_idx ON profiles(is_online, last_seen_at DESC);

    ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name text;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size bigint;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime_type text;
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_media_type_check;
    ALTER TABLE messages ADD CONSTRAINT messages_media_type_check
    CHECK (media_type IN ('', 'image', 'video', 'audio', 'document', 'apk', 'file'));

    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'message', 'mention', 'story_reply'));

    INSERT INTO storage.buckets (id, name, public)
    VALUES ('messages', 'messages', true)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

    DROP POLICY IF EXISTS "messages_attachments_read" ON storage.objects;
    CREATE POLICY "messages_attachments_read" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'messages');

    DROP POLICY IF EXISTS "messages_attachments_upload" ON storage.objects;
    CREATE POLICY "messages_attachments_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'messages' AND auth.uid()::text = (storage.foldername(name))[1]);

    DROP POLICY IF EXISTS "messages_attachments_delete" ON storage.objects;
    CREATE POLICY "messages_attachments_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'messages' AND auth.uid()::text = (storage.foldername(name))[1]);

    DO $$
    BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    END IF;
    END $$;
    