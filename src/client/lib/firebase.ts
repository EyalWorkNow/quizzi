import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAh6g2xKQgJBwZSzvFyD5gw2mtAMBVcstw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'quizzi-4dece.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'quizzi-4dece',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'quizzi-4dece.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '619365392780',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:619365392780:web:7b44f21304a3fed08c76a9',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-Z8RJXW1XDM',
};

let analyticsPromise: Promise<Analytics | null> | null = null;

function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}

export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === 'undefined' || !hasFirebaseConfig()) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined' || !hasFirebaseConfig()) {
    return Promise.resolve(null);
  }

  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((supported) => {
        if (!supported) return null;
        const app = getFirebaseApp();
        return app ? getAnalytics(app) : null;
      })
      .catch(() => null);
  }

  return analyticsPromise;
}

function sanitizeEventParams(params?: Record<string, unknown>) {
  const entries = Object.entries(params || {}).filter(([, value]) => {
    return ['string', 'number', 'boolean'].includes(typeof value);
  });

  return Object.fromEntries(entries);
}

export async function trackFirebaseEvent(name: string, params?: Record<string, unknown>) {
  const analytics = await getFirebaseAnalytics();
  if (!analytics) return false;

  logEvent(analytics, name, sanitizeEventParams(params));
  return true;
}
