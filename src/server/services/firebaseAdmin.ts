import admin from 'firebase-admin';

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n');
}

function resolveProjectId() {
  return (
    String(process.env.FIREBASE_PROJECT_ID || '').trim() ||
    String(process.env.VITE_FIREBASE_PROJECT_ID || '').trim() ||
    'quizzi-4dece'
  );
}

function resolveServiceAccount() {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      return {
        projectId: String(parsed.project_id || parsed.projectId || resolveProjectId()).trim(),
        clientEmail: String(parsed.client_email || parsed.clientEmail || '').trim(),
        privateKey: normalizePrivateKey(String(parsed.private_key || parsed.privateKey || '')),
      };
    } catch (error) {
      console.warn('[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error);
    }
  }

  const projectId = resolveProjectId();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(String(process.env.FIREBASE_PRIVATE_KEY || '').trim());

  if (!clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function ensureFirebaseAdmin() {
  if (admin.apps.length) {
    return admin.app();
  }

  const serviceAccount = resolveServiceAccount();
  if (serviceAccount?.clientEmail && serviceAccount?.privateKey) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
      projectId: serviceAccount.projectId,
    });
  }

  return admin.initializeApp({
    projectId: resolveProjectId(),
  });
}

export function getFirebaseAdminAuth() {
  ensureFirebaseAdmin();
  return admin.auth();
}
