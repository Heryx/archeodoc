const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const distPaths = [
  path.join(root, "dist", "index.cjs"),
  path.join(root, "dist", "public", "index.html"),
];

const sourcePaths = [
  path.join(root, "client", "src"),
  path.join(root, "server"),
  path.join(root, "shared"),
  path.join(root, "package.json"),
  path.join(root, "tsconfig.json"),
  path.join(root, "vite.config.ts"),
  path.join(root, "script", "build.ts"),
];

function getDistMtime() {
  let minMtime = Infinity;
  for (const p of distPaths) {
    if (!fs.existsSync(p)) return -1;
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs < minMtime) {
        minMtime = stat.mtimeMs;
      }
    } catch {
      return -1;
    }
  }
  return minMtime;
}

function checkDirModifiedAfter(dirPath, thresholdMs) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (checkDirModifiedAfter(fullPath, thresholdMs)) {
          return true;
        }
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > thresholdMs) {
          return true;
        }
      }
    }
  } catch {
    return true;
  }
  return false;
}

function shouldBuild() {
  const distMtime = getDistMtime();
  if (distMtime === -1) {
    return true; // dist missing
  }

  for (const src of sourcePaths) {
    if (!fs.existsSync(src)) continue;
    try {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        if (checkDirModifiedAfter(src, distMtime)) {
          return true;
        }
      } else if (stat.isFile()) {
        if (stat.mtimeMs > distMtime) {
          return true;
        }
      }
    } catch {
      return true;
    }
  }

  return false;
}

const result = shouldBuild() ? "build" : "skip";
process.stdout.write(result);
