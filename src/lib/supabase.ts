import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

export type Profile = {
  id: string
  username: string
  full_name: string
  avatar_url: string
  bio: string
  is_private: boolean
  is_verified: boolean
  show_followers_to: 'everyone' | 'followers' | 'nobody'
  show_seen_receipts: boolean
  who_can_message: 'everyone' | 'followers' | 'nobody'
  is_online: boolean
  last_seen_at: string | null
  show_last_seen: boolean
  created_at: string
}

export type PostVisibility = 'public' | 'friends' | 'private'
export type PostStatus = 'draft' | 'uploading' | 'processing' | 'moderation' | 'ready' | 'published' | 'rejected' | 'archived' | 'deleted'
export type ModerationStatus = 'pending' | 'safe' | 'review' | 'rejected'

export type ModerationResult = {
  safe: boolean
  status: ModerationStatus
  score: number
  categories: Record<string, number>
  reason?: string
}

export type Post = {
  id: string
  user_id: string
  media_url: string
  media_type: 'image' | 'video'
  caption: string
  created_at: string
  title: string
  description: string
  visibility: PostVisibility
  is_child_friendly: boolean
  moderation_status: ModerationStatus
  moderation_result: ModerationResult | Record<string, never>
  media_hash: string | null
  moderated_at: string | null
  status: PostStatus
  publish_requested: boolean
  published_at: string | null
  updated_at: string
  profiles?: Profile
  likes?: Like[]
  comments?: Comment[]
  post_tags?: PostTag[]
  _likes_count?: number
  _comments_count?: number
  _liked_by_me?: boolean
  _saved_by_me?: boolean
  _tags?: string[]
}

export type PostTag = {
  id: string
  post_id: string
  tag: string
  created_at: string
}

export type SavedPost = {
  id: string
  user_id: string
  post_id: string
  created_at: string
}

export type StoryVisibility = 'everyone' | 'followers'

export type Story = {
  id: string
  user_id: string
  media_url: string
  media_type: 'image' | 'video'
  visibility: StoryVisibility
  caption: string
  expires_at: string
  created_at: string
  profiles?: Profile
  _viewed_by_me?: boolean
}

export type Comment = {
  id: string
  post_id: string
  user_id: string
  content: string
  is_pinned: boolean
  created_at: string
  profiles?: Profile
  comment_likes?: { user_id: string }[]
  _likes_count?: number
  _liked_by_me?: boolean
}

export type Like = {
  id: string
  post_id: string
  user_id: string
  created_at: string
}

export type Follow = {
  id: string
  follower_id: string
  following_id: string
  status: 'accepted' | 'pending'
  created_at: string
}

export type Message = {
  id: string
  sender_id: string
  receiver_id: string
  content: string
  media_url: string
  storage_path: string | null
  media_type: '' | 'image' | 'video' | 'audio' | 'document' | 'apk' | 'file'
  attachment_name: string | null
  attachment_size: number | null
  attachment_mime_type: string | null
  is_seen: boolean
  is_encrypted: boolean
  view_once: boolean
  view_once_opened: boolean
  deleted_at: string | null
  created_at: string
  reply_to_id: string | null
  edited_at: string | null
  deleted_for_sender: boolean
  deleted_for_receiver: boolean
  sender?: Profile
  receiver?: Profile
}

export type Note = {
  id: string
  user_id: string
  content: string
  expires_at: string
  created_at: string
  profiles?: Profile
}

export type Notification = {
  id: string
  user_id: string
  actor_id: string
  type: 'like' | 'comment' | 'follow' | 'follow_request' | 'message' | 'mention' | 'story_reply'
  post_id: string | null
  comment_id: string | null
  is_read: boolean
  created_at: string
  actor?: Profile
  post?: Post
}

export type MessageReaction = { id: string; message_id: string; user_id: string; emoji: string; created_at: string }
