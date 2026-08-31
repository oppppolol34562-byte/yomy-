import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from '@/lib/supabase'

declare global {
  interface Window {
    __yomyPendingNotificationUrl?: string
  }
}

// The Capacitor plugin calls Firebase natively. Without google-services.json,
// register() can terminate Android instead of returning a rejected Promise.
// Enable this only in builds that also package google-services.json.
const PUSH_NOTIFICATIONS_ENABLED = import.meta.env.VITE_YOMY_PUSH_NOTIFICATIONS === 'true'

function openNotificationUrl(value: unknown) {
  if (typeof value === 'string' && value.startsWith('/')) window.location.assign(value)
}

export async function registerPushNotifications(userId: string): Promise<() => Promise<void>> {
  if (!Capacitor.isNativePlatform() || !PUSH_NOTIFICATIONS_ENABLED) return async () => {}
  try {
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: 'messages',
        name: 'Messages',
        description: 'New chat messages',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
        lights: true,
        lightColor: '#7C3AED',
      })
    }

    const nativeOpenHandler = (event: Event) => {
      openNotificationUrl((event as CustomEvent<{ url?: unknown }>).detail?.url)
    }
    window.addEventListener('yomy:notification-open', nativeOpenHandler)
    const pendingUrl = window.__yomyPendingNotificationUrl
    delete window.__yomyPendingNotificationUrl
    if (pendingUrl) setTimeout(() => openNotificationUrl(pendingUrl), 250)

    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions()
    if (permission.receive !== 'granted') {
      window.removeEventListener('yomy:notification-open', nativeOpenHandler)
      return async () => {}
    }

    const registration = await PushNotifications.addListener('registration', async token => {
      const { error } = await supabase.from('push_tokens').upsert(
        { user_id: userId, token: token.value, platform: Capacitor.getPlatform(), updated_at: new Date().toISOString() },
        { onConflict: 'token' }
      )
      if (error) console.error('Push token could not be saved', error)
    })
    const registrationError = await PushNotifications.addListener('registrationError', error => console.error('Push registration failed', error))
    const action = await PushNotifications.addListener('pushNotificationActionPerformed', event => {
      openNotificationUrl(event.notification.data?.url)
    })
    await PushNotifications.register()
    return async () => {
      window.removeEventListener('yomy:notification-open', nativeOpenHandler)
      await registration.remove()
      await registrationError.remove()
      await action.remove()
    }
  } catch (error) {
    console.error('Push notifications unavailable', error)
    return async () => {}
  }
}
