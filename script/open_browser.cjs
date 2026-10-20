const http = require("http");
const { exec } = require("child_process");

const url = process.argv[2] || "http://localhost:5000";
const targetHost = "127.0.0.1";
const targetPort = 5000;
const startTime = Date.now();
const maxWaitMs = 12000;

function checkAndOpen() {
  const req = http.get({
    host: targetHost,
    port: targetPort,
    path: "/",
    timeout: 300,
  }, (res) => {
    // Server is up and ready! Open browser immediately
    exec(`start "" "${url}"`);
    process.exit(0);
  });

  req.on("error", () => {
    if (Date.now() - startTime > maxWaitMs) {
      exec(`start "" "${url}"`);
      process.exit(0);
    }
    setTimeout(checkAndOpen, 60);
  });

  req.on("timeout", () => {
    req.destroy();
  });
}

checkAndOpen();
