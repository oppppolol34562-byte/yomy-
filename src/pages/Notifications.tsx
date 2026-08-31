import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Notification } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import TopBar from '@/components/layout/TopBar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { Heart, UserPlus, UserCheck, MessageCircle, Bell, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

export default function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  const fetchNotifications = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase.from('notifications').select('*, actor:profiles!actor_id(id, username, full_name, avatar_url, is_verified), post:posts(id, media_url, media_type)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
    setNotifications(data || [])
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    setLoading(false)
  }, [user])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  const handleFollowRequest = async (notification: Notification, accepted: boolean) => {
    if (!user || !notification.actor_id) return
    setActionId(notification.id)
    try {
      if (accepted) {
        const { error } = await supabase.from('follows').update({ status: 'accepted' }).eq('follower_id', notification.actor_id).eq('following_id', user.id).eq('status', 'pending')
        if (error) throw error
        toast.success((notification.actor?.username || 'User') + ' can now see your private posts and stories.')
      } else {
        const { error } = await supabase.from('follows').delete().eq('follower_id', notification.actor_id).eq('following_id', user.id).eq('status', 'pending')
        if (error) throw error
        toast.success('Follow request declined')
      }
      await supabase.from('notifications').delete().eq('id', notification.id).eq('user_id', user.id)
      setNotifications(current => current.filter(item => item.id !== notification.id))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update request')
    } finally { setActionId(null) }
  }

  const getIcon = (type: string) => {
    if (type === 'like') return <Heart className="size-3 text-red-500 fill-current" />
    if (type === 'comment') return <MessageCircle className="size-3 text-blue-500 fill-current" />
    if (type === 'follow' || type === 'follow_request') return <UserPlus className="size-3 text-green-500 fill-current" />
    if (type === 'message') return <MessageCircle className="size-3 text-violet-500 fill-current" />
    return <Bell className="size-3" />
  }

  const getMessage = (n: Notification) => ({ like: 'liked your post', comment: 'commented on your post', follow: 'started following you', follow_request: 'requested to follow you', message: 'sent you a message', mention: 'mentioned you', story_reply: 'replied to your story' }[n.type] || 'interacted with you')
  const getTarget = (n: Notification) => n.post_id ? '/post/' + n.post_id : n.type === 'message' ? '/messages/' + n.actor?.username : '/profile/' + n.actor?.username

  return <div className="pb-20"><TopBar title="Notifications" /><div className="max-w-lg mx-auto">{loading ? <div className="flex items-center justify-center h-40"><Spinner className="size-6" /></div> : notifications.length === 0 ? <Empty className="mt-12"><EmptyHeader><EmptyMedia variant="icon"><Bell className="size-6" /></EmptyMedia><EmptyTitle>No notifications yet</EmptyTitle><EmptyDescription>Activity and messages will show up here.</EmptyDescription></EmptyHeader></Empty> : <div className="divide-y divide-border">{notifications.map(n => <div key={n.id} role="link" tabIndex={0} onClick={() => navigate(getTarget(n))} onKeyDown={e => { if (e.key === 'Enter') navigate(getTarget(n)) }} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer"><div className="relative"><Avatar className="size-12"><AvatarImage src={n.actor?.avatar_url} /><AvatarFallback>{n.actor?.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar><div className="absolute -bottom-0.5 -right-0.5 bg-card rounded-full size-5 flex items-center justify-center ring-2 ring-card">{getIcon(n.type)}</div></div><div className="flex-1 min-w-0"><p className="text-sm"><span className="font-semibold">{n.actor?.username}</span>{' '}<span className="text-muted-foreground">{getMessage(n)}</span></p><p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>{n.type === 'follow_request' && <div className="flex gap-2 mt-2"><Button size="sm" className="h-8" disabled={actionId === n.id} onClick={e => { e.stopPropagation(); handleFollowRequest(n, true) }}><UserCheck className="size-4 mr-1" />Accept</Button><Button size="sm" variant="outline" className="h-8" disabled={actionId === n.id} onClick={e => { e.stopPropagation(); handleFollowRequest(n, false) }}><X className="size-4 mr-1" />Decline</Button></div>}</div>{n.post?.media_url && <img src={n.post.media_url} alt="" className="size-10 object-cover rounded" loading="lazy" />}</div>)}</div>}</div></div>
}
