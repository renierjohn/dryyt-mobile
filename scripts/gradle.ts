// Runs the Gradle wrapper in android/ on macOS, Linux and Windows (gradlew.bat), with the API the JS bundle calls.
// Usage: bun scripts/gradle.ts <preview|production|dev> <gradle task> [more gradle args]
// A shell-set EXPO_PUBLIC_API_URL beats the .env files, so a release build doesn't fall back to .env.production.
import { join } from "node:path";

const API: Record<string, string | undefined> = {
  preview: "https://app-preview.dryyt.com",
  production: "https://dryyt.com",
  dev: undefined, // Debug builds load JS from Metro, which reads .env.
};

const [target, ...args] = process.argv.slice(2);
if (!(target in API) || args.length === 0) {
  console.error("Usage: bun scripts/gradle.ts <preview|production|dev> <gradle task> [more gradle args]");
  process.exit(1);
}

const url = API[target];
// The NDK pinned in app.config.js (expo-build-properties), passed on every build so it applies even when android/ was
// prebuilt before the pin changed.
const root = join(import.meta.dir, "..");
const appConfig = require(join(root, "app.config.js"))({ config: require(join(root, "app.json")).expo });
const ndkVersion: string | undefined = appConfig.plugins
  ?.find((p: unknown) => Array.isArray(p) && p[0] === "expo-build-properties")?.[1]?.android?.ndkVersion;
const gradleArgs = ndkVersion ? [...args, `-Pandroid.ndkVersion=${ndkVersion}`] : args;
const env = { ...process.env, ...(url ? { EXPO_PUBLIC_API_URL: url } : {}) };
// Windows runs .bat files through cmd.
const wrapper = process.platform === "win32" ? ["cmd", "/c", "gradlew.bat"] : ["./gradlew"];
console.log(`${wrapper.at(-1)} ${gradleArgs.join(" ")}${url ? ` (EXPO_PUBLIC_API_URL=${url})` : ""}`);

const proc = Bun.spawn([...wrapper, ...gradleArgs], { cwd: join(root, "android"), env, stdio: ["inherit", "inherit", "inherit"] });
process.exit(await proc.exited);
