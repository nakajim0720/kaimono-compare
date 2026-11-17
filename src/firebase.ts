import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// STEP 1で取得したご自身のFirebase設定値に書き換えてください
const firebaseConfig = {
  apiKey: "AIzaSyBcmhUH7b-SuRmo3aYc6-lIOnQ2o4aILtA",
  authDomain: "kaimono-compare.firebaseapp.com",
  projectId: "kaimono-compare",
  storageBucket: "kaimono-compare.firebasestorage.app",
  messagingSenderId: "263449919598",
  appId: "1:263449919598:web:f90a45c5d4c05176d9667f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);