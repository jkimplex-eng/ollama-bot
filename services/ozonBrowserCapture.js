const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function buildCaptureArgs(config) {
  const args = [
    config.scriptPath,
    "--user-data-dir",
    config.userDataDir,
    "--profile-directory",
    config.profileDirectory,
    "--connection-mode",
    config.connectionMode
  ];

  if (config.targetSection) {
    args.push("--target-section", config.targetSection);
  }

  if (config.browserChannel) {
    args.push("--browser-channel", config.browserChannel);
  }

  if (config.cdpUrl && config.connectionMode === "cdp") {
    args.push("--cdp-url", config.cdpUrl);
  }

  if (config.outputRoot) {
    args.push("--output-root", config.outputRoot);
  }

  if (config.headless) {
    args.push("--headless");
  }

  return args;
}

function parseCaptureStdout(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    throw new Error("Ozon browser capture returned empty output.");
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("Ozon browser capture returned invalid JSON: " + err.message);
  }
}

function ensurePathExists(filePath, label) {
  if (!filePath) {
    throw new Error(label + " is not configured.");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(label + " not found: " + filePath);
  }
}

function createOzonBrowserCaptureService(config) {
  function buildRunConfig(overrides = {}) {
    return {
      ...config,
      ...overrides
    };
  }

  function getStatus() {
    const pythonExists = Boolean(config.pythonPath && fs.existsSync(config.pythonPath));
    const scriptExists = Boolean(config.scriptPath && fs.existsSync(config.scriptPath));
    const userDataDirExists = Boolean(config.userDataDir && fs.existsSync(config.userDataDir));

    return {
      enabled: Boolean(config.enabled),
      mode: config.mode || "auto",
      pythonPath: config.pythonPath,
      scriptPath: config.scriptPath,
      userDataDir: config.userDataDir,
      profileDirectory: config.profileDirectory,
      targetSection: config.targetSection,
      connectionMode: config.connectionMode,
      cdpUrl: config.cdpUrl,
      pythonExists,
      scriptExists,
      userDataDirExists
    };
  }

  async function runCapture(overrides = {}) {
    const runConfig = buildRunConfig(overrides);

    if (!runConfig.enabled) {
      throw new Error("Ozon browser capture is disabled on this runtime.");
    }

    ensurePathExists(runConfig.pythonPath, "Python executable");
    ensurePathExists(runConfig.scriptPath, "Capture script");
    ensurePathExists(runConfig.userDataDir, "Browser user-data directory");

    const args = buildCaptureArgs(runConfig);
    const { stdout, stderr } = await execFileAsync(runConfig.pythonPath, args, {
      cwd: runConfig.rootDir,
      timeout: runConfig.timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });

    const meta = parseCaptureStdout(stdout);

    return {
      meta,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
      command: {
        pythonPath: runConfig.pythonPath,
        args
      }
    };
  }

  return {
    buildCaptureArgs: () => buildCaptureArgs(config),
    getStatus,
    runCapture
  };
}

module.exports = {
  buildCaptureArgs,
  createOzonBrowserCaptureService,
  parseCaptureStdout
};
