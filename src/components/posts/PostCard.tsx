import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Post, Comment } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Pin,
  Trash2,
  Flag,
  Volume2,
  VolumeX,
  Link2,
  Share2,
  Check,
  Play,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDistanceToNow } from 'date-fns'

type PostCardProps = {
  post: Post
  onDeleted?: (id: string) => void
  onUpdated?: (post: Post) => void
}

function FormattedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/((?:#[a-zA-Z0-9_\u0600-\u06FF]+)|(?:@[a-zA-Z0-9_]+))/g)
  return (
    <span className={className} dir="auto">
      {parts.map((part, index) => {
        if (part.startsWith('#')) {
          return (
            <Link
              key={index}
              to={`/explore?q=${encodeURIComponent(part.slice(1))}`}
              className="font-medium text-primary hover:underline"
              onClick={e => e.stopPropagation()}
            >
              {part}
            </Link>
          )
        }
        if (part.startsWith('@')) {
          return (
            <Link
              key={index}
              to={`/profile/${part.slice(1)}`}
              className="font-medium text-primary hover:underline"
              onClick={e => e.stopPropagation()}
            >
              {part}
            </Link>
          )
        }
        return part
      })}
    </span>
  )
}

export default function PostCard({ post, onDeleted }: PostCardProps) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [liked, setLiked] = useState(post._liked_by_me || false)
  const [likesCount, setLikesCount] = useState(post._likes_count || 0)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(post._saved_by_me || false)
  const [showHeartPop, setShowHeartPop] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [isPlaying, setIsPlaying] = useState(true)
  const [mediaLoaded, setMediaLoaded] = useState(false)
  const [showFullCaption, setShowFullCaption] = useState(false)
  const [imageError, setImageError] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const lastTapRef = useRef<number>(0)
  const heartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isOwner = user?.id === post.user_id

  useEffect(() => {
    return () => {
      if (heartTimerRef.current) clearTimeout(heartTimerRef.current)
    }
  }, [])

  const triggerLike = async () => {
    if (!user) return
    if (!liked) {
      setLiked(true)
      setLikesCount(c => c + 1)
      await supabase.from('likes').upsert({ post_id: post.id, user_id: user.id }, { onConflict: 'post_id,user_id' })
    }
  }

  const toggleLike = async () => {
    if (!user) return
    const newLiked = !liked
    setLiked(newLiked)
    setLikesCount(c => newLiked ? c + 1 : Math.max(0, c - 1))

    if (newLiked) {
      await supabase.from('likes').upsert({ post_id: post.id, user_id: user.id }, { onConflict: 'post_id,user_id' })
    } else {
      await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', user.id)
    }
  }

  const handleMediaTap = () => {
    const now = Date.now()
    const DOUBLE_TAP_DELAY = 300
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double tap detected!
      setShowHeartPop(true)
      if (heartTimerRef.current) clearTimeout(heartTimerRef.current)
      heartTimerRef.current = setTimeout(() => setShowHeartPop(false), 900)
      void triggerLike()
    } else {
      // Single tap: toggle play/pause for video
      if (post.media_type === 'video' && videoRef.current) {
        if (videoRef.current.paused) {
          void videoRef.current.play()
          setIsPlaying(true)
        } else {
          videoRef.current.pause()
          setIsPlaying(false)
        }
      }
    }
    lastTapRef.current = now
  }

  const toggleSound = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  const loadComments = async () => {
    if (commentsLoaded) return
    const { data } = await supabase
      .from('comments')
      .select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified), comment_likes(user_id)')
      .eq('post_id', post.id)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: true })

    setComments((data || []).map(c => ({
      ...c,
      _likes_count: c.comment_likes?.length || 0,
      _liked_by_me: c.comment_likes?.some((l: { user_id: string }) => l.user_id === user?.id) || false,
    })))
    setCommentsLoaded(true)
  }

  const openComments = async () => {
    setCommentsOpen(true)
    await loadComments()
  }

  const submitComment = async () => {
    if (!newComment.trim() || !user || submitting) return
    setSubmitting(true)
    const { data, error } = await supabase
      .from('comments')
      .insert({ post_id: post.id, user_id: user.id, content: newComment.trim() })
      .select('*, profiles!user_id(id, username, full_name, avatar_url, is_verified)')
      .single()

    if (data && !error) {
      setComments(c => [...c, { ...data, _likes_count: 0, _liked_by_me: false }])
      setNewComment('')
    } else if (error) {
      toast.error('Could not post comment')
    }
    setSubmitting(false)
  }

  const toggleCommentLike = async (comment: Comment) => {
    if (!user) return
    const newLiked = !comment._liked_by_me
    setComments(cs => cs.map(c => c.id === comment.id
      ? { ...c, _liked_by_me: newLiked, _likes_count: newLiked ? (c._likes_count || 0) + 1 : Math.max(0, (c._likes_count || 0) - 1) }
      : c
    ))
    if (newLiked) {
      await supabase.from('comment_likes').upsert({ comment_id: comment.id, user_id: user.id }, { onConflict: 'comment_id,user_id' })
    } else {
      await supabase.from('comment_likes').delete().eq('comment_id', comment.id).eq('user_id', user.id)
    }
  }

  const pinComment = async (comment: Comment) => {
    const newPinned = !comment.is_pinned
    await supabase.from('comments').update({ is_pinned: newPinned }).eq('id', comment.id)
    setComments(cs => {
      const updated = cs.map(c => c.id === comment.id ? { ...c, is_pinned: newPinned } : { ...c, is_pinned: false })
      return updated.sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0))
    })
  }

  const deleteComment = async (commentId: string) => {
    await supabase.from('comments').delete().eq('id', commentId)
    setComments(cs => cs.filter(c => c.id !== commentId))
  }

  const deletePost = async () => {
    await supabase.from('posts').delete().eq('id', post.id)
    toast.success('Post deleted')
    onDeleted?.(post.id)
  }

  const copyLink = () => {
    const postUrl = `${window.location.origin}/post/${post.id}`
    void navigator.clipboard.writeText(postUrl)
    toast.success('Link copied to clipboard')
  }

  const shareNative = async () => {
    const postUrl = `${window.location.origin}/post/${post.id}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title || 'Post on Yomy',
          text: post.caption || 'Check out this post on Yomy',
          url: postUrl,
        })
      } catch {
        // Share cancelled or failed
      }
    } else {
      copyLink()
    }
  }

  const toggleSave = async () => {
    if (!user) return
    const newSaved = !saved
    setSaved(newSaved)
    if (newSaved) {
      await supabase.from('saved_posts').upsert(
        { post_id: post.id, user_id: user.id },
        { onConflict: 'user_id,post_id' }
      )
      toast.success('Saved to your collection')
    } else {
      await supabase.from('saved_posts').delete()
        .eq('post_id', post.id).eq('user_id', user.id)
      toast.success('Removed from saved')
    }
  }

  const timeAgo = post.created_at
    ? formatDistanceToNow(new Date(post.created_at), { addSuffix: true })
    : 'recently'

  const author = post.profiles
  const authorName = author?.username || 'user'
  const captionText = post.caption || ''
  const isCaptionLong = captionText.length > 90

  return (
    <article className="border-b border-border bg-card pb-3 text-card-foreground">
      {/* Post Header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <Link to={`/profile/${authorName}`} className="flex items-center gap-2.5 group">
          <Avatar className="size-9 ring-1 ring-border group-hover:ring-primary transition-all">
            <AvatarImage src={author?.avatar_url} alt={authorName} />
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
              {authorName[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold leading-tight group-hover:underline">
                {authorName}
              </span>
              {author?.is_verified && (
                <span className="inline-flex items-center justify-center size-3.5 rounded-full bg-blue-500 text-white text-[9px] font-bold">
                  <Check className="size-2.5 stroke-[3]" />
                </span>
              )}
            </div>
            <Link
              to={`/post/${post.id}`}
              className="text-[11px] text-muted-foreground hover:underline leading-tight"
            >
              {timeAgo}
            </Link>
          </div>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 shadow-lg">
            <DropdownMenuItem onClick={copyLink} className="cursor-pointer">
              <Link2 className="size-4 mr-2" /> Copy link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={shareNative} className="cursor-pointer">
              <Share2 className="size-4 mr-2" /> Share post
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/messages/new?to=${authorName}`)} className="cursor-pointer">
              <Send className="size-4 mr-2" /> Send in direct message
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isOwner ? (
              <DropdownMenuItem onClick={deletePost} className="text-destructive focus:text-destructive cursor-pointer">
                <Trash2 className="size-4 mr-2" /> Delete post
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem className="cursor-pointer">
                  <Volume2 className="size-4 mr-2" /> Mute @{authorName}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive cursor-pointer">
                  <Flag className="size-4 mr-2" /> Report post
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Media Display */}
      <div
        className="relative w-full bg-neutral-900 overflow-hidden flex items-center justify-center select-none cursor-pointer min-h-[300px] max-h-[560px]"
        onClick={handleMediaTap}
      >
        {/* Double-tap heart animation pop */}
        {showHeartPop && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none animate-in zoom-in-50 fade-in duration-200">
            <Heart className="size-28 text-white fill-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] animate-pulse" />
          </div>
        )}

        {post.media_type === 'video' ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              src={post.media_url}
              className="w-full max-h-[560px] object-contain"
              autoPlay
              loop
              muted={isMuted}
              playsInline
              onLoadedData={() => setMediaLoaded(true)}
            />
            {/* Play/Pause icon badge on tap */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                <div className="size-14 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white">
                  <Play className="size-7 fill-current translate-x-0.5" />
                </div>
              </div>
            )}
            {/* Floating mute/unmute button */}
            <button
              type="button"
              onClick={toggleSound}
              className="absolute bottom-3 right-3 size-8 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/80 transition-colors z-10"
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
          </div>
        ) : (
          <div className="relative w-full flex items-center justify-center min-h-[300px]">
            {!mediaLoaded && !imageError && (
              <div className="absolute inset-0 bg-muted/40 animate-pulse flex items-center justify-center" />
            )}
            {imageError ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <p>Unable to load image</p>
                <Button variant="outline" size="sm" onClick={() => setImageError(false)}>Retry</Button>
              </div>
            ) : (
              <img
                src={post.media_url}
                alt={post.caption || 'Post image'}
                className={cn(
                  "w-full max-h-[560px] object-contain transition-opacity duration-300",
                  mediaLoaded ? "opacity-100" : "opacity-0"
                )}
                loading="lazy"
                onLoad={() => setMediaLoaded(true)}
                onError={() => setImageError(true)}
              />
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-3.5 pt-2.5 pb-1">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleLike}
              className={cn(
                "p-1 -ml-1 transition-transform active:scale-75 focus:outline-none",
                liked ? "text-red-500" : "text-foreground hover:text-muted-foreground"
              )}
              aria-label={liked ? "Unlike" : "Like"}
            >
              <Heart className={cn("size-6 stroke-[1.75]", liked && "fill-current")} />
            </button>

            <button
              type="button"
              onClick={openComments}
              className="p-1 text-foreground hover:text-muted-foreground transition-transform active:scale-75 focus:outline-none"
              aria-label="Comment"
            >
              <MessageCircle className="size-6 stroke-[1.75]" />
            </button>

            <button
              type="button"
              onClick={shareNative}
              className="p-1 text-foreground hover:text-muted-foreground transition-transform active:scale-75 focus:outline-none"
              aria-label="Share"
            >
              <Send className="size-6 stroke-[1.75]" />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleSave}
            className="p-1 -mr-1 text-foreground hover:text-muted-foreground transition-transform active:scale-75 focus:outline-none"
            aria-label={saved ? "Unsave" : "Save"}
          >
            <Bookmark className={cn("size-6 stroke-[1.75]", saved && "fill-current text-primary")} />
          </button>
        </div>

        {/* Likes count */}
        {likesCount > 0 ? (
          <p className="text-sm font-semibold text-foreground mb-1">
            {likesCount.toLocaleString()} {likesCount === 1 ? 'like' : 'likes'}
          </p>
        ) : null}

        {/* Post Title & Caption */}
        <div className="space-y-1 text-sm">
          {post.title && (
            <p className="font-semibold text-foreground leading-snug" dir="auto">
              {post.title}
            </p>
          )}

          {captionText ? (
            <div className="leading-relaxed text-foreground" dir="auto">
              <Link to={`/profile/${authorName}`} className="font-semibold mr-1.5 hover:underline">
                {authorName}
              </Link>
              {isCaptionLong && !showFullCaption ? (
                <>
                  <FormattedText text={captionText.slice(0, 85) + '...'} />
                  <button
                    type="button"
                    onClick={() => setShowFullCaption(true)}
                    className="text-xs text-muted-foreground ml-1 font-medium hover:text-foreground"
                  >
                    more
                  </button>
                </>
              ) : (
                <>
                  <FormattedText text={captionText} />
                  {isCaptionLong && (
                    <button
                      type="button"
                      onClick={() => setShowFullCaption(false)}
                      className="text-xs text-muted-foreground ml-1 font-medium hover:text-foreground"
                    >
                      less
                    </button>
                  )}
                </>
              )}
            </div>
          ) : null}

          {post.description && (
            <p className="text-xs text-muted-foreground leading-relaxed pt-0.5" dir="auto">
              <FormattedText text={post.description} />
            </p>
          )}

          {/* Tags */}
          {post._tags && post._tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {post._tags.map(tag => (
                <Link
                  key={tag}
                  to={`/explore?q=${encodeURIComponent(tag)}`}
                  className="text-xs text-primary font-medium hover:underline bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded-full transition-colors"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Comments CTA */}
        {post._comments_count && post._comments_count > 0 ? (
          <button
            type="button"
            className="text-xs text-muted-foreground mt-1.5 font-medium hover:text-foreground block"
            onClick={openComments}
          >
            View all {post._comments_count} {post._comments_count === 1 ? 'comment' : 'comments'}
          </button>
        ) : null}
      </div>

      {/* Comments Drawer / Sheet */}
      <Sheet open={commentsOpen} onOpenChange={setCommentsOpen}>
        <SheetContent side="bottom" className="h-[80vh] flex flex-col p-0 rounded-t-2xl">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-center font-semibold">Comments</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto py-2">
            {comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-1">
                <MessageCircle className="size-8 opacity-30" />
                <p>No comments yet.</p>
                <p className="text-xs">Start the conversation!</p>
              </div>
            ) : (
              comments.map(comment => (
                <div key={comment.id} className={cn("flex gap-3 px-4 py-2.5 hover:bg-accent/20 transition-colors", comment.is_pinned && "bg-muted/40")}>
                  <Link to={`/profile/${comment.profiles?.username}`}>
                    <Avatar className="size-8 shrink-0">
                      <AvatarImage src={comment.profiles?.avatar_url} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                        {comment.profiles?.username?.[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        {comment.is_pinned && (
                          <div className="flex items-center gap-1 text-xs text-primary font-medium mb-0.5">
                            <Pin className="size-3" /> Pinned
                          </div>
                        )}
                        <p className="text-sm leading-relaxed" dir="auto">
                          <Link to={`/profile/${comment.profiles?.username}`} className="font-semibold mr-1.5 hover:underline">
                            {comment.profiles?.username}
                          </Link>
                          <FormattedText text={comment.content} />
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleCommentLike(comment)}
                          className={cn("p-1 text-sm transition-colors", comment._liked_by_me ? "text-red-500" : "text-muted-foreground hover:text-foreground")}
                        >
                          <Heart className={cn("size-4", comment._liked_by_me && "fill-current")} />
                        </button>
                        {(isOwner || user?.id === comment.user_id) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-6 h-6 w-6 text-muted-foreground">
                                <MoreHorizontal className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {isOwner && (
                                <DropdownMenuItem onClick={() => pinComment(comment)}>
                                  <Pin className="size-4 mr-2" />
                                  {comment.is_pinned ? 'Unpin' : 'Pin'}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => deleteComment(comment.id)}
                                className="text-destructive focus:text-destructive cursor-pointer"
                              >
                                <Trash2 className="size-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Comment input */}
          <div className="border-t p-3 pb-safe flex gap-2.5 items-center bg-card">
            <Avatar className="size-8 shrink-0">
              <AvatarImage src={profile?.avatar_url} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                {profile?.username?.[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Input
              placeholder="Add a comment..."
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitComment()}
              className="flex-1 rounded-full text-sm bg-muted/40 border-border"
              dir="auto"
            />
            <Button
              variant="default"
              size="sm"
              className="rounded-full px-4 font-semibold text-xs"
              disabled={!newComment.trim() || submitting}
              onClick={submitComment}
            >
              Post
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </article>
  )
}
