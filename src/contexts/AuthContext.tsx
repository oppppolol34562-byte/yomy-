import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'

type AuthContextType = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile(data)
  }

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        ;(async () => {
          await fetchProfile(session.user.id)
        })()
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
      if (!user) return

      const markOnline = () => {
        void supabase.from('profiles').update({
          is_online: true,
          last_seen_at: new Date().toISOString(),
        }).eq('id', user.id)
      }

      const markOffline = () => {
        void supabase.from('profiles').update({
          is_online: false,
          last_seen_at: new Date().toISOString(),
        }).eq('id', user.id)
      }

      markOnline()
      const interval = window.setInterval(markOnline, 60_000)
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') markOnline()
        else markOffline()
      }
      document.addEventListener('visibilitychange', handleVisibility)
      window.addEventListener('pagehide', markOffline)

      return () => {
        window.clearInterval(interval)
        document.removeEventListener('visibilitychange', handleVisibility)
        window.removeEventListener('pagehide', markOffline)
        markOffline()
      }
    }, [user])

      const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
