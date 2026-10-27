// Jest: Google Sign-In, the Facebook SDK and Firebase Auth are native modules. Tests that need them mock '@/lib/social-auth' themselves.
module.exports = {
  signInWithGoogle: jest.fn(async () => null),
  signInWithFacebook: jest.fn(async () => null),
  signOutOfSocial: jest.fn(async () => {}),
};
