import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Post } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import PostCard from '@/components/posts/PostCard'
import { Spinner } from '@/components/ui/spinner'

export default function PostDetail() {
  const { postId } = useParams()
  const { user } = useAuth()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const fetchPost = useCallback(async () => {
    if (!postId || !user) return
    const { data } = await supabase.from('posts').select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified), likes(user_id), comments(id), post_tags(tag)').eq('id', postId).maybeSingle()
    if (data) setPost({ ...data, _likes_count: data.likes?.length || 0, _comments_count: data.comments?.length || 0, _liked_by_me: data.likes?.some((like: { user_id: string }) => like.user_id === user.id) || false, _tags: data.post_tags?.map((tag: { tag: string }) => tag.tag) || [] })
    setLoading(false)
  }, [postId, user])
  useEffect(() => { fetchPost() }, [fetchPost])
  return <div className="pb-20"><TopBar title="Post" showBack /><div className="max-w-lg mx-auto">{loading ? <div className="flex items-center justify-center h-40"><Spinner className="size-6" /></div> : post ? <PostCard post={post} /> : <p className="text-center text-muted-foreground py-16">This post is unavailable.</p>}</div></div>
}
