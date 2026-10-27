const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Pins the Firebase Android BoM that @react-native-firebase builds against. Its default (35.x) brings firebase-auth
 * 25, compiled with Kotlin 2.4, which the project's Kotlin 2.1 can't read (":react-native-firebase_auth:compileDebugKotlin"
 * fails with "binary version of its metadata is 2.4.0, expected version is 2.1.0"). BoM 33.x ships firebase-auth 23.x,
 * built with an older Kotlin. Raise this once the project's Kotlin catches up.
 */
const MARKER = '// @generated withFirebaseBom';

module.exports = function withFirebaseBom(config, { bom = '33.16.0' } = {}) {
  return withProjectBuildGradle(config, (config) => {
    const gradle = config.modResults;
    if (gradle.language !== 'groovy') throw new Error('withFirebaseBom: expected a Groovy android/build.gradle');
    if (!gradle.contents.includes(MARKER)) {
      // react-native-firebase reads rootProject.ext['react-native'].versions.firebase.bom.
      gradle.contents += `\n${MARKER}\nproject.ext {\n  set('react-native', [versions: [firebase: [bom: '${bom}']]])\n}\n`;
    }
    return config;
  });
};
