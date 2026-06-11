const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function createOzonCaptureQueueService({ enabled = false, filePath, jobsDir }) {
  ensureDir(path.dirname(filePath));
  ensureDir(jobsDir);

  function loadState() {
    return loadJson(filePath, { jobs: [] });
  }

  function saveState(state) {
    saveJson(filePath, state);
  }

  function getStatus() {
    const state = loadState();
    const counts = state.jobs.reduce(
      (acc, job) => {
        acc.total += 1;
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      },
      { total: 0, pending: 0, claimed: 0, completed: 0, failed: 0 }
    );

    return counts;
  }

  function enqueueJob({ chatId, targetSection = "auto", debug = false, requestedBy = "" }) {
    const state = loadState();
    const job = {
      id: crypto.randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString(),
      claimedAt: "",
      completedAt: "",
      failedAt: "",
      chatId: chatId ? String(chatId) : "",
      targetSection,
      debug: Boolean(debug),
      requestedBy
    };
    state.jobs.push(job);
    saveState(state);
    return job;
  }

  function claimNextJob() {
    const state = loadState();
    const job = state.jobs.find(item => item.status === "pending");
    if (!job) {
      return null;
    }
    job.status = "claimed";
    job.claimedAt = new Date().toISOString();
    saveState(state);
    return job;
  }

  function getJob(jobId) {
    const state = loadState();
    return state.jobs.find(item => item.id === jobId) || null;
  }

  function completeJob(jobId, payload) {
    const state = loadState();
    const job = state.jobs.find(item => item.id === jobId);
    if (!job) {
      throw new Error("Capture job not found: " + jobId);
    }

    const jobDir = path.join(jobsDir, jobId);
    ensureDir(jobDir);

    let screenshotPath = "";
    if (payload.screenshotBase64) {
      screenshotPath = path.join(jobDir, "page.png");
      fs.writeFileSync(screenshotPath, Buffer.from(payload.screenshotBase64, "base64"));
    }

    let htmlPath = "";
    if (payload.htmlContent) {
      htmlPath = path.join(jobDir, "page.html");
      fs.writeFileSync(htmlPath, String(payload.htmlContent), "utf8");
    }

    const meta = {
      ...(payload.meta || {}),
      artifacts: {
        ...((payload.meta && payload.meta.artifacts) || {}),
        html: htmlPath || ((payload.meta && payload.meta.artifacts && payload.meta.artifacts.html) || ""),
        screenshot:
          screenshotPath || ((payload.meta && payload.meta.artifacts && payload.meta.artifacts.screenshot) || "")
      }
    };

    const metaPath = path.join(jobDir, "meta.json");
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.result = {
      metaPath,
      meta,
      screenshotPath,
      htmlPath
    };
    saveState(state);
    return job;
  }

  function failJob(jobId, errorMessage) {
    const state = loadState();
    const job = state.jobs.find(item => item.id === jobId);
    if (!job) {
      throw new Error("Capture job not found: " + jobId);
    }
    job.status = "failed";
    job.failedAt = new Date().toISOString();
    job.error = String(errorMessage || "Unknown capture worker error");
    saveState(state);
    return job;
  }

  return {
    enabled: Boolean(enabled),
    claimNextJob,
    completeJob,
    enqueueJob,
    failJob,
    getJob,
    getStatus
  };
}

module.exports = {
  createOzonCaptureQueueService
};
