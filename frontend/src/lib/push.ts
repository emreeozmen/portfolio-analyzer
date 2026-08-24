/** Browser Web Push subscription management — the client half of
 * backend/services/push_service.py. `public/push-sw.js` handles the actual 'push'/
 * 'notificationclick' events once a subscription exists; everything here is about
 * creating/removing that subscription and reporting its current status.
 */

import { subscribePush, unsubscribePush } from '../api'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export type PushStatus = 'unsupported' | 'unconfigured' | 'denied' | 'subscribed' | 'not-subscribed'

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

/** Converts the VAPID public key (base64url, no padding) into the raw byte array
 * `PushManager.subscribe()`'s `applicationServerKey` option expects. Standard
 * conversion recipe for the Push API — there's no built-in helper for it. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

function subscriptionToKeys(subscription: PushSubscription): { endpoint: string; p256dh: string; auth: string } {
  const json = subscription.toJSON()
  return {
    endpoint: json.endpoint ?? '',
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  }
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription ? 'subscribed' : 'not-subscribed'
}

export async function subscribeToPush(): Promise<PushStatus> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return getPushStatus()

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return getPushStatus()

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // TS's DOM lib types applicationServerKey as BufferSource, but the generic
    // Uint8Array<ArrayBufferLike> this produces doesn't structurally satisfy that
    // without a cast — a known lib.dom.d.ts strictness quirk, not a real type error
    // (a plain Uint8Array is exactly what the real Push API expects here).
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })
  const { endpoint, p256dh, auth } = subscriptionToKeys(subscription)
  await subscribePush(endpoint, { p256dh, auth })
  return 'subscribed'
}

export async function unsubscribeFromPush(): Promise<PushStatus> {
  if (!isPushSupported()) return getPushStatus()

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    const { endpoint } = subscriptionToKeys(subscription)
    await subscription.unsubscribe()
    await unsubscribePush(endpoint)
  }
  return getPushStatus()
}
