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
const env = { ...process.env, ...(url ? { EXPO_PUBLIC_API_URL: url } : {}) };
// Windows runs .bat files through cmd.
const wrapper = process.platform === "win32" ? ["cmd", "/c", "gradlew.bat"] : ["./gradlew"];
console.log(`${wrapper.at(-1)} ${args.join(" ")}${url ? ` (EXPO_PUBLIC_API_URL=${url})` : ""}`);

const proc = Bun.spawn([...wrapper, ...args], { cwd: join(import.meta.dir, "..", "android"), env, stdio: ["inherit", "inherit", "inherit"] });
process.exit(await proc.exited);
