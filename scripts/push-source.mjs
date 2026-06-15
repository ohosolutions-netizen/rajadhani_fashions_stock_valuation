import fs from "node:fs";
import path from "node:path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";

const dir = process.cwd();
const remoteUrl = process.env.SITES_REMOTE_URL;
const branch = process.env.SITES_BRANCH || "main";
const token = process.env.SITES_TOKEN;

if (!remoteUrl || !token) {
  throw new Error("SITES_REMOTE_URL and SITES_TOKEN are required.");
}

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".wrangler",
  "dist",
  "node_modules"
]);
const ignoredFiles = new Set(["ZET-debug.log"]);

function listFiles(root, prefix = "") {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...listFiles(absolutePath, relativePath));
      }
      continue;
    }

    if (entry.isFile() && !ignoredFiles.has(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

await git.init({ fs, dir, defaultBranch: branch });

const files = listFiles(dir);
for (const filepath of files) {
  await git.add({ fs, dir, filepath });
}

const sha = await git.commit({
  fs,
  dir,
  message: "Publish Rajadhani stock widget",
  author: {
    name: "Codex",
    email: "codex@example.local"
  }
});

try {
  await git.addRemote({ fs, dir, remote: "origin", url: remoteUrl });
} catch (error) {
  if (error.code !== "AlreadyExistsError") {
    throw error;
  }

  await git.setConfig({
    fs,
    dir,
    path: "remote.origin.url",
    value: remoteUrl
  });
}

await git.push({
  fs,
  http,
  dir,
  remote: "origin",
  ref: branch,
  remoteRef: branch,
  force: true,
  headers: {
    Authorization: `Bearer ${token}`
  }
});

process.stdout.write(sha);
