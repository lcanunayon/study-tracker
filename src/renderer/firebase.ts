import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as _fbSignOut,
  onAuthStateChanged as _onAuthStateChanged,
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCbVCGBdZfK2iXW6In0cwbXXKyXY220vDo',
  authDomain: 'study-tree-59228.firebaseapp.com',
  projectId: 'study-tree-59228',
  storageBucket: 'study-tree-59228.firebasestorage.app',
  messagingSenderId: '419621835550',
  appId: '1:419621835550:web:cbc02f38c411891ff8ef0f',
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

export type { User } from 'firebase/auth';
export { _onAuthStateChanged as onAuthStateChanged };

export async function fbSignUp(email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function fbSignIn(email: string, password: string) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function fbSignOut() {
  await _fbSignOut(auth);
}

/**
 * Compress a base64 image data URL to max 1200px on the longest side at 72%
 * JPEG quality. Reduces typical photos from 1–5 MB down to ~60–150 KB,
 * keeping them well within Firestore's 1 MB document limit.
 */
async function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round((h * MAX) / w); w = MAX; }
        else        { w = Math.round((w * MAX) / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no 2d context')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Prepare modules for Firestore:
 *  - Images  → compressed JPEG (fits in 1 MB doc limit)
 *  - Videos / PDFs → stripped to '__local_only__' (can't compress meaningfully)
 */
async function prepareForFirestore(modules: object[]): Promise<object[]> {
  const out: object[] = [];
  for (const mod of modules as any[]) {
    const m: any = { ...mod };

    // Compress large cover image
    if (m.image?.startsWith('data:image') && m.image.length > 20_000) {
      try   { m.image = await compressImage(m.image); }
      catch { if (m.image.length > 65_536) m.image = '__local_only__'; }
    }

    if (m.workspace?.items) {
      const items: any[] = [];
      for (const item of m.workspace.items) {
        if (item.type === 'image' && item.content?.startsWith('data:image') && item.content.length > 20_000) {
          try   { items.push({ ...item, content: await compressImage(item.content) }); }
          catch { items.push(item.content.length > 65_536 ? { ...item, content: '__local_only__' } : item); }
        } else if (
          (item.type === 'video' || item.type === 'pdf') &&
          item.content?.startsWith('data:') &&
          item.content.length > 65_536
        ) {
          // Videos/PDFs can't be compressed — keep them local only
          items.push({ ...item, content: '__local_only__' });
        } else {
          items.push(item);
        }
      }
      m.workspace = { ...m.workspace, items };
    }

    out.push(m);
  }
  return out;
}

export async function saveUserModules(userId: string, modules: object[]): Promise<void> {
  const prepared = await prepareForFirestore(modules);
  await setDoc(doc(db, 'users', userId), {
    modulesJson: JSON.stringify(prepared),
    updatedAt: Date.now(),
  });
}

export async function loadUserModules(userId: string): Promise<object[] | null> {
  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data['modulesJson']) return null;
  return JSON.parse(data['modulesJson']) as object[];
}
