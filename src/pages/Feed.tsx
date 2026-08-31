import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Post } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import StoryBar from '@/components/stories/StoryBar'
import PostCard from '@/components/posts/PostCard'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Camera } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

const PAGE_SIZE = 10

export default function Feed() {
  const { user } = useAuth()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const requestId = useRef(0)

  const fetchPosts = useCallback(async (pageNum: number) => {
    if (!user) return
    const currentRequest = ++requestId.current
    setLoading(true)

    try {
      const { data: followData, error: followsError } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id)
        .eq('status', 'accepted')
      if (followsError) throw followsError

      const followingIds = followData?.map(f => f.following_id) || []
      const feedIds = [user.id, ...followingIds]
      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified), likes(user_id), comments(id), saved_posts(user_id), post_tags(tag)')
        .in('user_id', feedIds)
        .eq('status', 'published')
        .eq('publish_requested', true)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)
      if (error) throw error

      const enriched = (data || []).map(p => ({
        ...p,
        _likes_count: p.likes?.length || 0,
        _comments_count: p.comments?.length || 0,
        _liked_by_me: p.likes?.some((l: { user_id: string }) => l.user_id === user.id) || false,
        _saved_by_me: p.saved_posts?.some((s: { user_id: string }) => s.user_id === user.id) || false,
        _tags: p.post_tags?.map((t: { tag: string }) => t.tag) || [],
      }))

      if (currentRequest !== requestId.current) return
      if (pageNum === 0) setPosts(enriched)
      else setPosts(prev => [...prev, ...enriched])
      setPage(pageNum)
      setHasMore(enriched.length === PAGE_SIZE)
    } catch (error: unknown) {
      if (currentRequest !== requestId.current) return
      setHasMore(false)
      if (pageNum === 0) setPosts([])
      toast.error(error instanceof Error ? error.message : 'Could not load your feed')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    setPage(0)
    setHasMore(true)
    void fetchPosts(0)
  }, [fetchPosts])

  useEffect(() => {
    const handleScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300
      if (nearBottom && hasMore && !loading) void fetchPosts(page + 1)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [hasMore, loading, page, fetchPosts])

  return (
    <div className="pb-20">
      <TopBar showLogo />
      <div className="max-w-lg mx-auto">
        <StoryBar />
        <Separator />
        {loading && posts.length === 0 ? (
          <div className="flex items-center justify-center h-40"><Spinner className="size-6" /></div>
        ) : posts.length === 0 ? (
          <Empty className="mt-12">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Camera className="size-6" /></EmptyMedia>
              <EmptyTitle>Your feed is empty</EmptyTitle>
              <EmptyDescription>Follow people to see their posts here. <Link to="/explore" className="text-primary">Explore</Link> to find accounts.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {posts.map(post => <PostCard key={post.id} post={post} onDeleted={id => setPosts(ps => ps.filter(p => p.id !== id))} />)}
            {loading && <div className="flex items-center justify-center h-16"><Spinner className="size-5" /></div>}
            {!hasMore && <p className="text-center text-sm text-muted-foreground py-8">You're all caught up!</p>}
          </>
        )}
      </div>
    </div>
  )
}
