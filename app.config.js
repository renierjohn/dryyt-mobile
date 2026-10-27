// app.json holds the config; this adds what comes from the environment (.env locally, EAS environment variables on
// builds). The Facebook App ID and client token are compiled into the app, so the plugin needs them at build time.

/** Facebook Login (Firebase Auth): Meta for Developers → your app → Settings → Basic (App ID) and Advanced (Client token). */
const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? '';
const FACEBOOK_CLIENT_TOKEN = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN ?? '';

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...config.plugins,
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
