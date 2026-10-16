const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withCustomGradle(config, options) {
  const gradleVersion = options?.version || '9.0';
  const distributionUrl = `https\\://services.gradle.org/distributions/gradle-${gradleVersion}-all.zip`;

  // Use a dangerous mod to execute after the 'android' folder is generated
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const wrapperPath = path.join(
        config.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      );

      if (fs.existsSync(wrapperPath)) {
        let contents = fs.readFileSync(wrapperPath, 'utf8');

        // Replace the distributionUrl line with the Gradle 9 target
        contents = contents.replace(
          /distributionUrl=.*/,
          `distributionUrl=${distributionUrl}`
        );

        fs.writeFileSync(wrapperPath, contents, 'utf8');
        console.log(`[Config Plugin] Successfully forced Gradle Wrapper to version ${gradleVersion}`);
      }
      return config;
    },
  ]);
};
