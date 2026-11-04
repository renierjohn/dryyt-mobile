const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Signs release builds (gradle:release) with the upload key instead of debug.keystore, which Google Play rejects.
 * The keystore and passwords stay out of the repo: set these in %USERPROFILE%\.gradle\gradle.properties
 * (~/.gradle/gradle.properties on macOS):
 *
 *   DRYYT_UPLOAD_STORE_FILE=C:/keys/dryyt-upload.jks
 *   DRYYT_UPLOAD_STORE_PASSWORD=...
 *   DRYYT_UPLOAD_KEY_ALIAS=...
 *   DRYYT_UPLOAD_KEY_PASSWORD=...
 *
 * Use the keystore EAS signs with (eas credentials → Android → production → Keystore → Download), so local and EAS
 * builds share one key and its SHA-1, already registered in Firebase. Without these, a local release build stops with
 * an error instead of producing a debug-signed bundle. EAS builds sign with EAS's keystore and skip the check.
 */
const MARKER = '// @generated withReleaseSigning';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const gradle = config.modResults;
    if (gradle.language !== 'groovy') throw new Error('withReleaseSigning: expected a Groovy android/app/build.gradle');
    if (!gradle.contents.includes(MARKER)) {
      gradle.contents += `
${MARKER}
def uploadStoreFile = findProperty('DRYYT_UPLOAD_STORE_FILE')
android {
  signingConfigs {
    if (uploadStoreFile) {
      release {
        storeFile file(uploadStoreFile)
        storePassword findProperty('DRYYT_UPLOAD_STORE_PASSWORD')
        keyAlias findProperty('DRYYT_UPLOAD_KEY_ALIAS')
        keyPassword findProperty('DRYYT_UPLOAD_KEY_PASSWORD')
      }
    }
  }
  buildTypes {
    release {
      signingConfig uploadStoreFile ? signingConfigs.release : null
    }
  }
}
gradle.taskGraph.whenReady { graph ->
  // EAS injects its own signing config for its keystore (EAS_BUILD is set there).
  if (!uploadStoreFile && !System.getenv('EAS_BUILD') && graph.allTasks.any { it.project == project && it.name ==~ /(bundle|assemble|package)Release/ }) {
    throw new GradleException('Release builds need the upload key: set DRYYT_UPLOAD_STORE_FILE, DRYYT_UPLOAD_STORE_PASSWORD, DRYYT_UPLOAD_KEY_ALIAS and DRYYT_UPLOAD_KEY_PASSWORD in ~/.gradle/gradle.properties (see withReleaseSigning.js).')
  }
}
`;
    }
    return config;
  });
};
