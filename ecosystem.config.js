module.exports = {
  apps: [
    {
      name: "ollama-bot",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production",
        JOBS_ENABLED: "true"
      }
    }
  ]
};
