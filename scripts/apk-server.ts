import { Glob } from "bun";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "android");
const PORT = Number(process.env.PORT ?? 8080);

async function listApks() {
  const files: string[] = [];
  for await (const f of new Glob("**/*.apk").scan({ cwd: ROOT, onlyFiles: true })) files.push(f);
  return files.sort();
}

const RELEASE_APK = "app/build/outputs/apk/release/app-release.apk";

function serveApk(path: string) {
  return new Response(Bun.file(join(ROOT, path)), {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${path.split("/").pop()}"`,
    },
  });
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname.slice(1));
    const apks = await listApks();

    // Stable shortcut to the release build output.
    if (path === "release") {
      if (!(await Bun.file(join(ROOT, RELEASE_APK)).exists())) {
        return new Response("Release APK not built. Run: cd android && ./gradlew assembleRelease", { status: 404 });
      }
      return serveApk(RELEASE_APK);
    }

    if (!path) {
      const release = `<p><a href="/release">Download latest release build</a></p>`;
      const items = apks.length
        ? apks.map((f) => `<li><a href="/${encodeURI(f)}">${f}</a></li>`).join("")
        : "<li>No APKs found under android/</li>";
      return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><h3>APKs</h3>${release}<ul>${items}</ul>`, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Only serve files from the scanned list; blocks path traversal.
    if (!apks.includes(path)) return new Response("Not found", { status: 404 });

    return serveApk(path);
  },
});

const ips = Object.values(networkInterfaces()).flat().filter((i) => i?.family === "IPv4" && !i.internal);
console.log(`Serving APKs from ${ROOT}`);
for (const i of ips) console.log(`  http://${i!.address}:${PORT}  (release: http://${i!.address}:${PORT}/release)`);
