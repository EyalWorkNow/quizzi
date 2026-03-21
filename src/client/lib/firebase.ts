import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, logEvent, type Analytics } from 'firebase/analytics';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
} from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
googleProvider.addScope('email');
googleProvider.addScope('profile');

export { signInWithPopup, signInWithRedirect, getRedirectResult, signOut as signOutFirebase };

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAh6g2xKQgJBwZSzvFyD5gw2mtAMBVcstw',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'quizzi-4dece.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'quizzi-4dece',
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://quizzi-4dece-default-rtdb.firebaseio.com',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'quizzi-4dece.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '619365392780',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:619365392780:web:7b44f21304a3fed08c76a9',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-Z8RJXW1XDM',
};

let analyticsPromise: Promise<Analytics | null> | null = null;
let authReadyPromise: Promise<Auth | null> | null = null;
let realtimeAuthPromise: Promise<Database | null> | null = null;
let realtimeUnavailable = false;

function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}

function hasRealtimeConfig() {
  return Boolean(hasFirebaseConfig() && firebaseConfig.databaseURL);
}

export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === 'undefined' || !hasFirebaseConfig()) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  return app ? getAuth(app) : null;
}

export function ensureFirebaseAuthReady(): Promise<Auth | null> {
  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      const auth = getFirebaseAuth();
      if (!auth) return null;
      await setPersistence(auth, browserLocalPersistence).catch((error) => {
        console.warn('[firebase] Failed to set auth persistence:', error);
      });
      return auth;
    })().catch(() => null);
  }

  return authReadyPromise;
}

export function shouldPreferRedirectSignIn() {
  if (typeof window === 'undefined') return false;
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod|android/.test(userAgent);
}

export function getFirebaseDatabase(): Database | null {
  if (typeof window === 'undefined' || !hasRealtimeConfig()) {
    return null;
  }

  const app = getFirebaseApp();
  return app ? getDatabase(app) : null;
}

export function ensureFirebaseRealtimeReady(): Promise<Database | null> {
  if (realtimeUnavailable) {
    return Promise.resolve(null);
  }

  if (!hasRealtimeConfig()) {
    return Promise.resolve(null);
  }

  if (!realtimeAuthPromise) {
    realtimeAuthPromise = (async () => {
      const db = getFirebaseDatabase();
      if (!db) {
        return null;
      }

      const auth = await ensureFirebaseAuthReady();
      if (!auth?.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (error: any) {
          const isOperationNotAllowed = 
            error?.code === 'auth/operation-not-allowed' || 
            error?.code === 'auth/admin-restricted-operation' ||
            error?.message?.includes('400');
            
          if (isOperationNotAllowed) {
            console.error('[Firebase] CRITICAL: Anonymous Authentication is NOT enabled in your Firebase Console. Realtime features (Lobby, Live View) will FAIL until you enable it under Build > Authentication > Sign-in method.');
            realtimeUnavailable = true;
            return null;
          } else {
            console.warn('[Firebase] Anonymous sign-in failed. Realtime features might be limited:', error);
          }
        }
      }

      return db;
    })().catch(() => null);
  }

  return realtimeAuthPromise;
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
