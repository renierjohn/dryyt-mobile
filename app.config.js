const fs = require('node:fs');

// app.json holds the config; this adds what comes from the environment (.env locally, EAS environment variables on
// builds). The Facebook App ID and client token are compiled into the app, so the plugin needs them at build time.

/** Facebook Login (Firebase Auth): Meta for Developers → your app → Settings → Basic (App ID) and Advanced (Client token). */
const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? '';
const FACEBOOK_CLIENT_TOKEN = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN ?? '';

/** Firebase console → Project settings → iOS app com.dryyt.mobile → GoogleService-Info.plist. iOS builds need it. */
const IOS_GOOGLE_SERVICES = './GoogleService-Info.plist';

module.exports = ({ config }) => ({
  ...config,
  // Only when the file is there, so Android builds and `expo config` work without it.
  ios: { ...config.ios, ...(fs.existsSync(IOS_GOOGLE_SERVICES) ? { googleServicesFile: IOS_GOOGLE_SERVICES } : {}) },
  plugins: [
    ...config.plugins,
    // React Native Firebase on iOS needs its pods built as static frameworks. Android release builds run R8 and drop
    // unused resources for a smaller, faster-starting app (test a release build before shipping: R8 can strip classes).
    [
      'expo-build-properties',
      {
        ios: { useFrameworks: 'static' },
        android: { ndkVersion: '27.1.12297006', enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true },
      },
    ],
    // Without an App ID the app builds without the Facebook SDK setup and the Facebook button says it isn't set up.
    ...(FACEBOOK_APP_ID
      ? [
          [
            'react-native-fbsdk-next',
            {
              appID: FACEBOOK_APP_ID,
              clientToken: FACEBOOK_CLIENT_TOKEN,
              displayName: config.name,
              scheme: `fb${FACEBOOK_APP_ID}`,
              advertiserIDCollectionEnabled: false,
              autoLogAppEventsEnabled: false,
              isAutoInitEnabled: true,
            },
          ],
        ]
      : []),
  ],
});
