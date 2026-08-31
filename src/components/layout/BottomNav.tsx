import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, Search, PlusSquare, Heart, User, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

const activeColors = {
  Home: 'text-cyan-400',
  Explore: 'text-violet-400',
  Create: 'text-pink-400',
  Activity: 'text-rose-400',
  Profile: 'text-amber-300',
  Messages: 'text-sky-300',
} as const

export default function BottomNav() {
  const { user, profile } = useAuth()
    const [unreadCount, setUnreadCount] = useState(0)
    const [unreadMessageCount, setUnreadMessageCount] = useState(0)

    useEffect(() => {
      if (!user) {
        setUnreadCount(0)
        return
      }
      const loadUnread = async () => {
        const { count } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_read', false)
        setUnreadCount(count || 0)
      }
      void loadUnread()
      const channel = supabase.channel('unread-notifications')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id }, () => void loadUnread())
        .subscribe()
      return () => { void supabase.removeChannel(channel) }
    }, [user])

      useEffect(() => {
        if (!user) {
          setUnreadMessageCount(0)
          return
        }
        const loadUnreadMessages = async () => {
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('receiver_id', user.id)
            .eq('is_seen', false)
            .is('deleted_at', null)
          setUnreadMessageCount(count || 0)
        }
        void loadUnreadMessages()
        const channel = supabase.channel('unread-messages-nav')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'receiver_id=eq.' + user.id }, () => void loadUnreadMessages())
          .subscribe()
        return () => { void supabase.removeChannel(channel) }
      }, [user])

      const navItems = [
    { to: '/', icon: Home, label: 'Home' as const },
    { to: '/explore', icon: Search, label: 'Explore' as const },
    { to: '/create', icon: PlusSquare, label: 'Create' as const },
    { to: '/messages', icon: MessageCircle, label: 'Messages' as const },
    { to: '/notifications', icon: Heart, label: 'Activity' as const },
    { to: profile?.username ? '/profile/' + profile.username : '/', icon: User, label: 'Profile' as const },
  ]

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/95 shadow-[0_-12px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex h-[4.25rem] max-w-lg items-center justify-around px-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={label}
            to={to}
            end={to === '/'}
            aria-label={label}
            title={label}
            className={({ isActive }) =>
              cn(
                'flex size-12 items-center justify-center rounded-2xl transition-all duration-200 active:scale-90',
                isActive
                  ? cn('bg-white/[0.08] shadow-inner', activeColors[label])
                  : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
              )
            }
          >
            {({ isActive }) =>
              label === 'Profile' && profile?.avatar_url ? (
                <span
                  className={cn(
                    'rounded-full p-[2px] transition-all duration-200',
                    isActive
                      ? 'bg-gradient-to-br from-cyan-400 via-violet-400 to-pink-400 shadow-[0_0_16px_rgba(168,85,247,0.45)]'
                      : 'bg-white/15'
                  )}
                >
                  <img
                    src={profile.avatar_url}
                    alt="Profile"
                    className="size-8 rounded-full object-cover ring-2 ring-black"
                  />
                </span>
              ) : (
                <span className="relative">
                  <Icon className={cn('size-6 stroke-[1.7]', isActive && activeColors[label])} />
                  {label === 'Activity' && unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-rose-500 px-1 text-[10px] leading-4 text-center font-bold text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                  {label === 'Messages' && unreadMessageCount > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-sky-500 px-1 text-[10px] leading-4 text-center font-bold text-white">
                      {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                    </span>
                  )}
                </span>
              )
            }
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
