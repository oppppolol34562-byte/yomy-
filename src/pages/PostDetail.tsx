import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Post } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import PostCard from '@/components/posts/PostCard'
import { Spinner } from '@/components/ui/spinner'

export default function PostDetail() {
  const { postId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchPost = useCallback(async () => {
    if (!postId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('posts')
      .select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified), likes(user_id), comments(id), saved_posts(user_id), post_tags(tag)')
      .eq('id', postId)
      .maybeSingle()

    if (data && !error) {
      setPost({
        ...data,
        _likes_count: data.likes?.length || 0,
        _comments_count: data.comments?.length || 0,
        _liked_by_me: data.likes?.some((like: { user_id: string }) => like.user_id === user?.id) || false,
        _saved_by_me: data.saved_posts?.some((s: { user_id: string }) => s.user_id === user?.id) || false,
        _tags: data.post_tags?.map((tag: { tag: string }) => tag.tag) || [],
      })
    } else {
      setPost(null)
    }
    setLoading(false)
  }, [postId, user])

  useEffect(() => {
    void fetchPost()
  }, [fetchPost])

  return (
    <div className="pb-20">
      <TopBar title="Post" showBack />
      <div className="max-w-lg mx-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-56 gap-2">
            <Spinner className="size-8 text-primary" />
            <p className="text-xs text-muted-foreground">Loading post...</p>
          </div>
        ) : post ? (
          <PostCard
            post={post}
            onDeleted={() => {
              navigate(-1)
            }}
          />
        ) : (
          <div className="text-center py-20 px-4">
            <p className="text-base font-semibold">Post unavailable</p>
            <p className="text-xs text-muted-foreground mt-1">
              This post may have been removed or is not accessible.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
