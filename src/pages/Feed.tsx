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
import { Camera, Compass, Sparkles, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 12

export default function Feed() {
  const { user } = useAuth()
  const [feedMode, setFeedMode] = useState<'for_you' | 'following'>('for_you')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const requestId = useRef(0)

  const fetchPosts = useCallback(async (pageNum: number, mode: 'for_you' | 'following') => {
    if (!user) return
    const currentRequest = ++requestId.current
    setLoading(true)

    try {
      let query = supabase
        .from('posts')
        .select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified), likes(user_id), comments(id), saved_posts(user_id), post_tags(tag)')
        .eq('status', 'published')

      if (mode === 'following') {
        const { data: followData, error: followsError } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id)
          .eq('status', 'accepted')
        if (followsError) throw followsError

        const followingIds = followData?.map(f => f.following_id) || []
        const feedIds = [user.id, ...followingIds]
        query = query.in('user_id', feedIds)
      }

      const { data, error } = await query
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
      toast.error(error instanceof Error ? error.message : 'Could not load feed')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    setPage(0)
    setHasMore(true)
    void fetchPosts(0, feedMode)
  }, [fetchPosts, feedMode])

  useEffect(() => {
    const handleScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 350
      if (nearBottom && hasMore && !loading) {
        void fetchPosts(page + 1, feedMode)
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [hasMore, loading, page, feedMode, fetchPosts])

  return (
    <div className="pb-20">
      <TopBar showLogo />

      {/* Feed Mode Toggle Tabs */}
      <div className="max-w-lg mx-auto border-b border-border/60 bg-background/95 backdrop-blur sticky top-14 z-20 flex">
        <button
          type="button"
          onClick={() => setFeedMode('for_you')}
          className={cn(
            "flex-1 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors border-b-2",
            feedMode === 'for_you'
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Sparkles className="size-3.5 text-primary" />
          For You
        </button>
        <button
          type="button"
          onClick={() => setFeedMode('following')}
          className={cn(
            "flex-1 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors border-b-2",
            feedMode === 'following'
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="size-3.5" />
          Following
        </button>
      </div>

      <div className="max-w-lg mx-auto">
        <StoryBar />
        <Separator />

        {loading && posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Spinner className="size-8 text-primary" />
            <p className="text-xs text-muted-foreground">Loading posts...</p>
          </div>
        ) : posts.length === 0 ? (
          <Empty className="mt-12 px-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {feedMode === 'following' ? <Users className="size-6" /> : <Camera className="size-6" />}
              </EmptyMedia>
              <EmptyTitle>
                {feedMode === 'following' ? "No posts from people you follow" : "Your feed is empty"}
              </EmptyTitle>
              <EmptyDescription>
                {feedMode === 'following' ? (
                  <span>
                    Switch to the <button onClick={() => setFeedMode('for_you')} className="text-primary font-medium underline">For You</button> tab or <Link to="/explore" className="text-primary font-medium underline">Explore</Link> to discover new creators.
                  </span>
                ) : (
                  <span>
                    Be the first to share a post! <Link to="/create" className="text-primary font-medium underline">Create a post</Link> or discover creators in <Link to="/explore" className="text-primary font-medium underline">Explore</Link>.
                  </span>
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div>
            {posts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                onDeleted={id => setPosts(ps => ps.filter(p => p.id !== id))}
              />
            ))}

            {loading && (
              <div className="flex items-center justify-center py-6">
                <Spinner className="size-6 text-primary" />
              </div>
            )}

            {!hasMore && posts.length > 0 && (
              <div className="text-center py-10 px-4">
                <div className="inline-flex items-center justify-center size-10 rounded-full bg-primary/10 text-primary mb-2">
                  <Compass className="size-5" />
                </div>
                <p className="text-sm font-semibold">You're all caught up!</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Check back later or explore new creators on Yomy.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
