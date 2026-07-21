const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let activeRebuild = null;

const getCandidateFrontendDirs = () => [
  process.env.FRONTEND_BUILD_DIR,
  "/var/www/frontend/frontend",
  path.resolve(__dirname, "..", "..", "frontend"),
  path.resolve(__dirname, "..", "..", "frontend", "frontend"),
].filter(Boolean);

const findFrontendDir = () => {
  for (const candidate of getCandidateFrontendDirs()) {
    const packagePath = path.join(candidate, "package.json");
    if (fs.existsSync(packagePath)) return candidate;
  }

  return null;
};

const runFrontendBuild = (frontendDir) => new Promise((resolve, reject) => {
  const startedAt = Date.now();
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(executable, ["run", "build"], {
    cwd: frontendDir,
    env: process.env,
    shell: false,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("error", reject);
  child.on("close", (code) => {
    const durationMs = Date.now() - startedAt;
    if (code === 0) {
      resolve({ durationMs, stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) });
      return;
    }

    const error = new Error(`Frontend build failed with exit code ${code}.`);
    error.durationMs = durationMs;
    error.stdout = stdout.slice(-4000);
    error.stderr = stderr.slice(-4000);
    reject(error);
  });
});

const rebuildFrontendSite = async (req, res) => {
  if (activeRebuild) {
    return res.status(409).json({
      success: false,
      message: "A site rebuild is already running. Please wait for it to finish.",
    });
  }

  const frontendDir = findFrontendDir();
  if (!frontendDir) {
    return res.status(500).json({
      success: false,
      message: "Frontend build directory was not found. Set FRONTEND_BUILD_DIR on the backend server.",
    });
  }

  activeRebuild = runFrontendBuild(frontendDir);

  try {
    const result = await activeRebuild;
    res.json({
      success: true,
      message: "Frontend blog pages rebuilt successfully.",
      data: {
        frontendDir,
        durationMs: result.durationMs,
        output: result.stdout,
        warnings: result.stderr,
      },
    });
  } catch (error) {
    console.error("FRONTEND REBUILD ERROR:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Frontend rebuild failed.",
      data: {
        frontendDir,
        durationMs: error.durationMs,
        output: error.stdout,
        error: error.stderr,
      },
    });
  } finally {
    activeRebuild = null;
  }
};

module.exports = {
  rebuildFrontendSite,
};
