"use strict";

// electron-builder hook, runs after each app is assembled and before the
// installer (DMG / NSIS) is made.
//  1. Copies the Next.js standalone server into the app's resources/server.
//     It is done here, not via extraResources, because electron-builder drops
//     node_modules from extraResources, and the server needs its node_modules.
//     The standalone build comes from this Mac, so its platform-specific
//     modules are dropped: sharp (Next's image optimizer — qpilot doesn't use
//     next/image, and it's loaded lazily) and fsevents (macOS file watching).
//     The rest of the server is plain JS and runs on any platform.
//  2. macOS only: ad-hoc signs the bundle. There is no Developer ID, and an
//     unsigned or half-signed bundle won't launch on Apple Silicon.

const { cpSync, existsSync, rmSync } = require("fs");
const { execFileSync } = require("child_process");
const { join } = require("path");

const PLATFORM_SPECIFIC = ["sharp", "@img", "fsevents"];

exports.default = async function afterPack(context) {
  const standalone = join(__dirname, "..", "..", ".next", "standalone");
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error(`No server build at ${standalone}. Run: npm --prefix .. run build`);
  }

  const isMac = context.electronPlatformName === "darwin";
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources = isMac
    ? join(appPath, "Contents", "Resources")
    : join(context.appOutDir, "resources");

  const dest = join(resources, "server");
  rmSync(dest, { recursive: true, force: true });
  cpSync(standalone, dest, { recursive: true, dereference: true });
  for (const name of PLATFORM_SPECIFIC) {
    rmSync(join(dest, "node_modules", name), { recursive: true, force: true });
  }

  if (isMac) {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
      stdio: "inherit",
    });
  }
};
