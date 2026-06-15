/*
Copyright (c) 2017, ZOHO CORPORATION
License: MIT
*/
const fs = require("fs");
const https = require("https");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const startPort = 5000;
const stopPort = 5009;

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": getContentSecurityPolicy(),
      "Content-Type": contentType
    });
    res.end(content);
  });
}

function getContentSecurityPolicy() {
  let connectSrc = "";

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "plugin-manifest.json"), "utf8"));
    const domains = manifest.cspDomains && manifest.cspDomains["connect-src"];
    if (Array.isArray(domains)) {
      connectSrc = domains.join(" ");
    }
  } catch (error) {
    connectSrc = "";
  }

  return "connect-src https://*.zohostatic.com https://*.sigmausercontent.com " + connectSrc;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";

  return "application/octet-stream";
}

function resolveStaticPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "https://127.0.0.1").pathname);

  if (pathname === "/" || pathname === "/app" || pathname === "/app/") {
    return path.join(rootDir, "app", "widget.html");
  }

  if (pathname === "/plugin-manifest.json") {
    return path.join(rootDir, "plugin-manifest.json");
  }

  if (!pathname.startsWith("/app/")) {
    return null;
  }

  const filePath = path.resolve(rootDir, pathname.slice(1));
  if (!filePath.startsWith(path.join(rootDir, "app"))) {
    return null;
  }

  return filePath;
}

function listenOnAvailablePort(port) {
  if (port > stopPort) {
    console.error("No available port found from " + startPort + " to " + stopPort + ".");
    return;
  }

  const server = https.createServer({
    key: fs.readFileSync(path.join(rootDir, "key.pem")),
    cert: fs.readFileSync(path.join(rootDir, "cert.pem"))
  }, (req, res) => {
    const filePath = resolveStaticPath(req.url || "/");

    if (!filePath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    sendFile(res, filePath, contentTypeFor(filePath));
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      listenOnAvailablePort(port + 1);
      return;
    }

    console.error(error.message);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log("Zet running at https://127.0.0.1:" + port);
    console.log("Open /app/widget.html after accepting the local certificate warning.");
  });
}

listenOnAvailablePort(startPort);
