import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { registerPushNotifications } from '@/lib/pushNotifications'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import Login from '@/pages/auth/Login'
import SignUp from '@/pages/auth/SignUp'
import Feed from '@/pages/Feed'
import Explore from '@/pages/Explore'
import Create from '@/pages/Create'
import CreateStory from '@/pages/CreateStory'
import Notifications from '@/pages/Notifications'
import Profile from '@/pages/Profile'
import PostDetail from '@/pages/PostDetail'
import EditProfile from '@/pages/EditProfile'
import Settings from '@/pages/Settings'
import Messages from '@/pages/Messages'
import Chat from '@/pages/Chat'
import BottomNav from '@/components/layout/BottomNav'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-8" /></div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-8" /></div>
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

function NativePushNotifications() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user) return
    let cleanup: (() => Promise<void>) | undefined
    void registerPushNotifications(user.id).then(removeListeners => { cleanup = removeListeners })
    return () => { void cleanup?.() }
  }, [user])
  return null
}

function LiveNotifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!user) return
    const channel = supabase.channel('live-notifications').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id },
      async (payload) => {
        const notification = payload.new as { actor_id: string; type: string }
        const { data: actor } = await supabase.from('profiles').select('username').eq('id', notification.actor_id).maybeSingle()
        const username = actor?.username || 'Someone'
        if (notification.type === 'message') {
          toast.info(username + ' sent you a message', { action: { label: 'Open', onClick: () => navigate('/messages/' + username) } })
        } else if (notification.type === 'follow_request') {
          toast.info(username + ' requested to follow you', { action: { label: 'Review', onClick: () => navigate('/notifications') } })
        }
      }
    ).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, navigate])
  return null
}

function AppRoutes() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const isChatRoute = location.pathname === '/messages/new' || /^\/messages\/[^/]+$/.test(location.pathname)
  return <>
    <NativePushNotifications />
    <LiveNotifications />
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><SignUp /></PublicRoute>} />
      <Route path="/" element={<ProtectedRoute><Feed /></ProtectedRoute>} />
      <Route path="/explore" element={<ProtectedRoute><Explore /></ProtectedRoute>} />
      <Route path="/create" element={<ProtectedRoute><Create /></ProtectedRoute>} />
      <Route path="/create-story" element={<ProtectedRoute><CreateStory /></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
      <Route path="/profile/:username" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/post/:postId" element={<ProtectedRoute><PostDetail /></ProtectedRoute>} />
      <Route path="/edit-profile" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
      <Route path="/messages/new" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
      <Route path="/messages/:username" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    {!loading && user && !isChatRoute && <BottomNav />}
  </>
}

export function App() {
  return <AuthProvider><BrowserRouter><AppRoutes /></BrowserRouter><Toaster position="top-center" richColors /></AuthProvider>
}

export default App
