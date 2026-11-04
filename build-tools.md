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
| Kotlin | 2.1.20 | Expo root project | None |
| NDK | 27.1.12297006 | `app.config.js` `expo-build-properties` `ndkVersion` | Install NDK 27.1.12297006 |
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

## Build

```
bun install
bunx expo prebuild --platform android --clean
bun run gradle:preview
```
Re-run `prebuild --clean` after changing `app.config.js` or `app.json` so `android/` picks up the change.

## Check a machine

Windows (cmd):
```
java -version & echo %JAVA_HOME% & node -v & bun -v & dir /b %LOCALAPPDATA%\Android\Sdk\ndk & dir /b %LOCALAPPDATA%\Android\Sdk\cmake & dir /b %LOCALAPPDATA%\Android\Sdk\build-tools
```
macOS:
```
java -version; echo $JAVA_HOME; node -v; bun -v; ls ~/Library/Android/sdk/ndk ~/Library/Android/sdk/cmake ~/Library/Android/sdk/build-tools
```

## Troubleshooting

**`[CXX1101] NDK at ...\ndk\<version> did not have a source.properties file`**
That NDK download is incomplete. Delete the folder and reinstall:
```
rmdir /s /q %LOCALAPPDATA%\Android\Sdk\ndk\<version>
sdkmanager "ndk;27.1.12297006"
```
A following `SoftwareComponent with name 'release' not found` on `:expo` is a knock-on of the same failure and clears with it.

**Gradle picks the wrong JDK**
Stop the daemon after changing `JAVA_HOME`: `cd android && gradlew --stop` (Windows) / `./gradlew --stop` (macOS).

## Re-checking EAS versions

Versions can move when Expo updates the EAS build image. To re-read them, open a finished build on expo.dev and search its logs for `ANDROID_NDK_HOME`, `JAVA_HOME`, `Welcome to Gradle`, `Bun `, `Node.js` and `[ExpoRootProject] Using the following versions`.
