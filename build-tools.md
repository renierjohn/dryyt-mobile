# Build tools

Versions used by EAS to build Android, and how to match them on a local machine (macOS or Windows) so `bun run gradle:preview` builds the same way.

Source: EAS build `682ad3ad-ff81-4b6e-9149-d747ea1b454f` (preview, Android, commit `caf34d9`, 2026-11-03).

## Versions

| Tool | Version | Set by | Local action |
|---|---|---|---|
| Expo SDK | 57.0.0 | `package.json` | `bun install` |
| React Native | 0.86.3 | `package.json` | `bun install` |
| Bun | 1.4.3 | `package.json` `packageManager`, `eas.json` `bun` | Install Bun 1.4.3 |
| Node.js | 22.23.1 | EAS image default | Install any Node 22 |
| Java (JDK) | 17 (OpenJDK) | EAS image default | Install JDK 17, set `JAVA_HOME` |
| Gradle | 9.3.1 | Gradle wrapper (config plugin) | None, the wrapper downloads it |
| Gradle memory | `-Xmx4g -XX:MaxMetaspaceSize=1g` | EAS `GRADLE_OPTS`; locally `scripts/gradle.ts` | None when building with `bun run gradle:*` |
| Kotlin | 2.1.20 | Expo root project | None |
| NDK | 27.1.12297006 | React Native (`node_modules/react-native/gradle/libs.versions.toml`), read by Expo's root project plugin | Install NDK 27.1.12297006, set `ANDROID_NDK_HOME` |
| CMake | 3.22.1 | React Native / native libraries | None, Gradle installs it |
| Build-tools | 36.0.0 | Expo root project | None, Gradle installs it |
| compileSdk / targetSdk | 36 / 36 | Expo root project | Install Android SDK Platform 36 |
| minSdk | 24 | Expo root project | None |

None of these change the app's version (`version` 1.0.0, versionCode from EAS remote). They only decide whether the build succeeds and matches EAS.

## Setup

### 1. Java 17

Install a JDK 17 (e.g. Temurin 17, or Android Studio's bundled JBR if it is 17) and point `JAVA_HOME` at it. Gradle uses whatever `JAVA_HOME` points to; a different major version can fail Gradle 9.3.1 or the Kotlin compile.

Windows (cmd, then reopen the terminal):
```
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot"
```
macOS (`~/.zshrc`):
```
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

### 2. Node 22 and Bun 1.4.3

```
node -v      # v22.x
bun -v       # 1.4.3
```
Install Bun 1.4.3 if needed. macOS: `curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.3"`. Windows: see the version-pinned installer on bun.sh.

### 3. Android SDK packages

With `sdkmanager` (Android SDK command-line tools) or Android Studio → SDK Manager → SDK Tools → "Show Package Details":
```
sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
```
Gradle can download build-tools, NDK and CMake on its own once the licenses are accepted; installing them up front avoids half-finished downloads.

### 4. ANDROID_NDK_HOME

Point `ANDROID_NDK_HOME` at NDK 27.1.12297006, as EAS does. `expo-updates` builds C++ without naming an NDK, so without this variable the Android Gradle plugin falls back to its own default (27.0.12077973) for it, and the build fails when that NDK is missing or broken.

Windows (cmd, then reopen the terminal):
```
setx ANDROID_NDK_HOME "%LOCALAPPDATA%\Android\Sdk\ndk\27.1.12297006"
```
macOS (`~/.zshrc`):
```
export ANDROID_NDK_HOME=$HOME/Library/Android/sdk/ndk/27.1.12297006
```

## Build

```
bun install
bunx expo prebuild --platform android --clean
bun run gradle:preview
```
Re-run `prebuild --clean` after changing `app.config.js` or `app.json` so `android/` picks up the change.

A failed build resumes at the failed task on the next run; finished tasks are skipped. `scripts/gradle.ts` also passes `--build-cache`, so task outputs are reused even after `gradlew clean` or `prebuild --clean` (cache in `%USERPROFILE%\.gradle\caches\build-cache-1`). Run `prebuild --clean` only when the config changed: it is the slowest way to rebuild.

## Release signing

`gradle:release` signs with the upload key (`withReleaseSigning.js`); Google Play rejects debug-signed bundles. Download the EAS keystore (`bunx eas credentials` → Android → production → Keystore → Download) and add to `%USERPROFILE%\.gradle\gradle.properties` (`~/.gradle/gradle.properties` on macOS), never to the repo:
```
DRYYT_UPLOAD_STORE_FILE=C:/keys/dryyt-upload.jks
DRYYT_UPLOAD_STORE_PASSWORD=...
DRYYT_UPLOAD_KEY_ALIAS=...
DRYYT_UPLOAD_KEY_PASSWORD=...
```
Without them a local release build stops with "Release builds need the upload key". EAS builds use EAS's keystore.

## Check a machine

Windows (cmd):
```
java -version & echo %JAVA_HOME% & echo %ANDROID_NDK_HOME% & node -v & bun -v & dir /b %LOCALAPPDATA%\Android\Sdk\ndk & dir /b %LOCALAPPDATA%\Android\Sdk\cmake & dir /b %LOCALAPPDATA%\Android\Sdk\build-tools
```
macOS:
```
java -version; echo $JAVA_HOME; echo $ANDROID_NDK_HOME; node -v; bun -v; ls ~/Library/Android/sdk/ndk ~/Library/Android/sdk/cmake ~/Library/Android/sdk/build-tools
```

## Troubleshooting

**`[CXX1101] NDK at ...\ndk\<version> did not have a source.properties file`**
That NDK download is incomplete. Delete the folder, install 27.1.12297006 and set `ANDROID_NDK_HOME` (Setup step 4):
```
rmdir /s /q %LOCALAPPDATA%\Android\Sdk\ndk\<version>
sdkmanager "ndk;27.1.12297006"
```
A following `SoftwareComponent with name 'release' not found` on `:expo` is a knock-on of the same failure and clears with it.

**Gradle wants a different NDK than 27.1.12297006**
Usually `ANDROID_NDK_HOME` is not set: `expo-updates` then uses the Android Gradle plugin's default NDK (27.0.12077973). Set it as in Setup step 4, open a new terminal and run `gradlew --stop`. If it still asks for another NDK, check, in order:
```
echo %ANDROID_NDK_HOME% & echo %ANDROID_NDK_ROOT%
findstr ndk android\local.properties
findstr ndkVersion android\build.gradle android\gradle.properties
findstr version node_modules\react-native\package.json
```
Point `ANDROID_NDK_HOME` at 27.1.12297006, unset `ANDROID_NDK_ROOT` and remove `ndk.dir` from `local.properties` if they point at another NDK; run `bun install` and `bunx expo prebuild --platform android --clean` if React Native or `android/` is stale.

**`:app:minifyReleaseWithR8 FAILED` ... `Java heap space`**
R8 ran out of memory. `android/gradle.properties` from prebuild gives the Gradle daemon 2 GB; `scripts/gradle.ts` raises it to what EAS uses (`-Xmx4g -XX:MaxMetaspaceSize=1g`) through `GRADLE_OPTS`, so build with `bun run gradle:*`, not `gradlew` directly. Run `gradlew --stop` first so an old 2 GB daemon isn't reused. Running `gradlew` by hand (or from Android Studio), put the same setting in `%USERPROFILE%\.gradle\gradle.properties` (`~/.gradle/gradle.properties` on macOS):
```
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8
```
The machine needs about 8 GB of RAM; close Android Studio and the emulator during a release build if it is short.

**Gradle picks the wrong JDK**
Stop the daemon after changing `JAVA_HOME`: `cd android && gradlew --stop` (Windows) / `./gradlew --stop` (macOS).

## Re-checking EAS versions

Versions can move when Expo updates the EAS build image. To re-read them, open a finished build on expo.dev and search its logs for `ANDROID_NDK_HOME`, `JAVA_HOME`, `Welcome to Gradle`, `Bun `, `Node.js` and `[ExpoRootProject] Using the following versions`.
