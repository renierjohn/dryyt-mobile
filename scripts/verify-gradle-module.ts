// Builds one autolinked native module with Gradle, to check it compiles in android/ (run `bun run prebuild` first).
// Usage: bun run verify-gradle react-native-fbsdk-next [@react-native-firebase/auth ...]
import { existsSync } from "node:fs";
import { join } from "node:path";

const ANDROID = join(import.meta.dir, "..", "android");
const packages = process.argv.slice(2);

if (packages.length === 0) {
  console.error("Usage: bun run verify-gradle <package> [package...]");
  process.exit(1);
}
if (!existsSync(ANDROID)) {
  console.error("No android/ folder. Run `bun run prebuild` first.");
  process.exit(1);
}

// Same naming as React Native autolinking: @scope/name → scope_name.
const gradleProject = (pkg: string) => pkg.replace(/[~*!'()]+/g, "_").replace(/^@([\w.-]+)\//, "$1_");

function gradlew(...args: string[]) {
  return Bun.spawnSync(["./gradlew", ...args], { cwd: ANDROID, stdout: "pipe", stderr: "pipe" });
}

const listed = gradlew("projects", "-q").stdout.toString();
let failed = false;

for (const pkg of packages) {
  const project = gradleProject(pkg);
  if (!listed.includes(`':${project}'`)) {
    console.error(`✗ ${pkg}: not linked (no :${project} project). Is it installed and autolinked?`);
    failed = true;
    continue;
  }
  console.log(`… ${pkg}: building :${project}:assembleDebug`);
  const result = gradlew(`:${project}:assembleDebug`);
  if (result.exitCode === 0) {
    console.log(`✓ ${pkg}: built`);
  } else {
    console.error(`✗ ${pkg}: build failed`);
    console.error((result.stdout.toString() + result.stderr.toString()).split("\n").slice(-40).join("\n"));
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
