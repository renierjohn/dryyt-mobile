import {
  FacebookAuthProvider,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
} from '@react-native-firebase/auth';
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import { AccessToken, LoginManager } from 'react-native-fbsdk-next';

import { api } from '@/lib/api';
import type { Session } from '@/lib/session-storage';

/**
 * The Firebase project's Web client ID (Firebase console → Authentication → Sign-in method → Google → Web SDK
 * configuration). Google Sign-In needs it to return an ID token Firebase accepts.
 */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
/** Set when the app was built with the Facebook SDK (see app.config.js). */
const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? '';

let googleConfigured = false;

/**
 * A provider credential → Firebase Auth → our session. The worker checks the Firebase ID token and signs into the
 * Dryyt account with that email (or creates a customer).
 */
async function sessionFor(credential: ReturnType<typeof GoogleAuthProvider.credential>): Promise<Session> {
  try {
    const { user } = await signInWithCredential(getAuth(), credential);
    return await api<Session>('/auth/firebase', { body: { id_token: await user.getIdToken() } });
  } catch (err) {
    // Firebase keeps one account per email: this email already signs in with the other provider.
    if ((err as { code?: string }).code === 'auth/account-exists-with-different-credential') {
      throw new Error('This email already signs in with another option. Use that one, or your email and password.');
    }
    throw err;
  }
}

/** Google account picker → Firebase → our session. Null when the user closes the picker. */
export async function signInWithGoogle(): Promise<Session | null> {
  if (!WEB_CLIENT_ID) throw new Error('Google sign-in is not set up yet (missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).');
  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
    googleConfigured = true;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res) || !res.data.idToken) return null;
    return await sessionFor(GoogleAuthProvider.credential(res.data.idToken));
  } catch (err) {
    if (isErrorWithCode(err) && (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS)) return null;
    if (isErrorWithCode(err) && err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Google Play services is not available on this phone.');
    throw err;
  }
}

/** Facebook login → Firebase → our session. Null when the user cancels. Asks for the email, which Dryyt accounts need. */
export async function signInWithFacebook(): Promise<Session | null> {
  if (!FACEBOOK_APP_ID) throw new Error('Facebook sign-in is not set up yet (missing EXPO_PUBLIC_FACEBOOK_APP_ID).');
  const res = await LoginManager.logInWithPermissions(['public_profile', 'email']);
  if (res.isCancelled) return null;
  const token = await AccessToken.getCurrentAccessToken();
  if (!token) return null;
  return sessionFor(FacebookAuthProvider.credential(token.accessToken));
}

/** Forget the Google, Facebook and Firebase sign-in on this phone, so the next social sign-in asks again. */
export async function signOutOfSocial() {
  await Promise.allSettled([GoogleSignin.signOut(), Promise.resolve().then(() => LoginManager.logOut()), firebaseSignOut(getAuth())]);
}
