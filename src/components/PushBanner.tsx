import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { getVapidPublicKey, subscribePush, unsubscribePush } from "../api";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushBanner() {
  const { isLoggedIn, loading: authLoading } = useAuth();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already dismissed this session or if notifications are unsupported
    if (!isLoggedIn || authLoading) return;
    if (dismissed) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

    // Check if we already have a push subscription
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (!sub) {
          // Show banner only if not already subscribed
          setVisible(true);
        }
      });
    });
  }, [isLoggedIn, authLoading, dismissed]);

  const handleEnable = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setVisible(false);
        setDismissed(true);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = await getVapidPublicKey();

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey.publicKey),
      });

      // Send subscription to backend
      await subscribePush(subscription.toJSON());
      setVisible(false);
      setDismissed(true);
    } catch (err) {
      console.error("Failed to enable push notifications:", err);
      setVisible(false);
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-up max-w-md w-[calc(100%-2rem)]">
      <div className="bg-white rounded-2xl shadow-glow-strong border border-vibe-border p-5 flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
          <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-vibe-text font-semibold text-sm">Get notified when your favorites go live</p>
          <p className="text-vibe-muted text-xs mt-1">We'll send you a push notification when a favorited venue starts streaming.</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleEnable}
              className="px-4 py-2 bg-vibe-accent hover:bg-vibe-accent-glow text-white text-sm font-semibold rounded-xl transition-all press-scale"
            >
              Enable
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 bg-vibe-surface hover:bg-gray-200 text-vibe-muted text-sm font-medium rounded-xl transition-all"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
