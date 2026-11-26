import { initializeApp, getApps, type AppOptions, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

function buildOptions(): AppOptions {
  const options: AppOptions = {
    projectId: firebaseConfig.projectId,
  };
  const inline = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (inline) {
    try {
      const parsed = JSON.parse(inline);
      if (parsed?.project_id) options.projectId = parsed.project_id;
      options.credential = cert(parsed);
    } catch (error) {
      console.error('[Firebase Admin] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:', error instanceof Error ? error.message : 'parse failed');
    }
  } else if (credPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('node:fs');
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      if (parsed?.project_id) options.projectId = parsed.project_id;
      options.credential = cert(parsed);
    } catch (error) {
      console.error('[Firebase Admin] Could not read GOOGLE_APPLICATION_CREDENTIALS:', error instanceof Error ? error.message : 'read failed');
    }
  }
  return options;
}

if (!getApps().length) {
  initializeApp(buildOptions());
}

export const adminAuth = getAuth();
