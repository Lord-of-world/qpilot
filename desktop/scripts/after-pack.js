"use strict";

// electron-builder hook, runs after the .app is assembled and before the DMG.
//  1. Copies the Next.js standalone server into Contents/Resources/server.
//     It is done here, not via extraResources, because electron-builder drops
//     node_modules from extraResources, and the server needs its node_modules.
//  2. Ad-hoc signs the bundle. There is no Developer ID, and an unsigned or
//     half-signed bundle won't launch on Apple Silicon.

const { cpSync, existsSync, rmSync } = require("fs");
const { execFileSync } = require("child_process");
const { join } = require("path");

exports.default = async function afterPack(context) {
  const standalone = join(__dirname, "..", "..", ".next", "standalone");
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error(`No server build at ${standalone}. Run: npm --prefix .. run build`);
  }

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const dest = join(appPath, "Contents", "Resources", "server");
  rmSync(dest, { recursive: true, force: true });
  cpSync(standalone, dest, { recursive: true, dereference: true });

  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
