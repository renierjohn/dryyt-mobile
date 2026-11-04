const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const { setIconAsync } = require('@expo/prebuild-config/build/plugins/icons/withAndroidIcons');

/**
 * Lets the dev, preview and release Android builds sit side by side on one phone: each build type gets its own
 * application ID, app name and icon colour.
 *
 *   debug    (gradle:dev)      com.dryyt.mobile.dev       "Dryyt Dev"      gray icon
 *   preview  (gradle:preview)  com.dryyt.mobile.preview   "Dryyt Preview"  black icon
 *   release  (gradle:release)  com.dryyt.mobile           "Dryyt"          app icon
 *
 * Every application ID needs its own Android app in Firebase (google-services.json), or the build stops at
 * process<Variant>GoogleServices with "No matching client found for package name".
 */
const MARKER = '// @generated withAppVariants';
// Expo's own icon generator only writes to src/main/res, so the variant icons are rendered into a temp project and
// only the files that differ (the foreground and the legacy square and round icons) are copied into the variant's
// source set, where they override main.
const ICON_FILES = ['ic_launcher.webp', 'ic_launcher_round.webp', 'ic_launcher_foreground.webp'];

module.exports = function withAppVariants(config, { variants }) {
  config = withAppBuildGradle(config, (config) => {
    const gradle = config.modResults;
    if (gradle.language !== 'groovy') throw new Error('withAppVariants: expected a Groovy android/app/build.gradle');
    if (!gradle.contents.includes(MARKER)) {
      const types = Object.entries(variants)
        .map(([type, { suffix }]) =>
          type === 'debug'
            ? `    debug {\n      applicationIdSuffix '${suffix}'\n    }`
            : // Libraries have no preview build type, so they build their release variant for it.
              `    ${type} {\n      initWith release\n      applicationIdSuffix '${suffix}'\n      matchingFallbacks = ['release']\n    }`,
        )
        .join('\n');
      gradle.contents += `\n${MARKER}\nandroid {\n  buildTypes {\n${types}\n  }\n}\n`;
    }
    return config;
  });

  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const adaptive = config.android?.adaptiveIcon ?? {};
      const abs = (p) => (p ? path.resolve(projectRoot, p) : p);
      for (const [type, { name, icon, foregroundImage }] of Object.entries(variants)) {
        const res = path.join(platformProjectRoot, 'app', 'src', type, 'res');
        fs.mkdirSync(path.join(res, 'values'), { recursive: true });
        fs.writeFileSync(
          path.join(res, 'values', 'strings.xml'),
          `<resources>\n  <string name="app_name">${name}</string>\n</resources>\n`,
        );

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-variant-icons-'));
        try {
          await setIconAsync(tmp, {
            icon: abs(icon),
            foregroundImage: abs(foregroundImage),
            backgroundColor: adaptive.backgroundColor ?? null,
            backgroundImage: abs(adaptive.backgroundImage),
            monochromeImage: abs(adaptive.monochromeImage),
            isAdaptive: !!config.android?.adaptiveIcon,
          });
          const generated = path.join(tmp, 'android', 'app', 'src', 'main', 'res');
          for (const dir of fs.readdirSync(generated).filter((d) => d.startsWith('mipmap-') && !d.includes('anydpi'))) {
            fs.mkdirSync(path.join(res, dir), { recursive: true });
            for (const file of ICON_FILES) {
              const from = path.join(generated, dir, file);
              if (fs.existsSync(from)) fs.copyFileSync(from, path.join(res, dir, file));
            }
          }
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      }
      return config;
    },
  ]);
};
