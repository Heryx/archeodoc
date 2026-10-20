const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const nodeModules = path.join(root, "node_modules");
const markerPath = path.join(nodeModules, ".archeodoc_deps_hash");
const lockFile = fs.existsSync(path.join(root, "package-lock.json"))
  ? path.join(root, "package-lock.json")
  : path.join(root, "package.json");

function getHash() {
  if (!fs.existsSync(lockFile)) return null;
  const content = fs.readFileSync(lockFile);
  return crypto.createHash("sha256").update(content).digest("hex");
}

const args = process.argv.slice(2);
if (args.includes("--update")) {
  try {
    if (!fs.existsSync(nodeModules)) {
      fs.mkdirSync(nodeModules, { recursive: true });
    }
    const hash = getHash();
    if (hash) {
      fs.writeFileSync(markerPath, hash, "utf-8");
    }
  } catch (err) {
    // Ignore error
  }
  process.exit(0);
}

if (!fs.existsSync(nodeModules)) {
  process.exit(1); // Needs install
}

const currentHash = getHash();
if (!currentHash) {
  process.exit(0); // Cannot hash, skip install
}

if (fs.existsSync(markerPath)) {
  const savedHash = fs.readFileSync(markerPath, "utf-8").trim();
  if (savedHash === currentHash) {
    process.exit(0); // Up to date!
  }
}

process.exit(1); // Hash mismatch or missing marker
