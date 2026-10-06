module.exports = {
  apps: [
    {
      name: "bingx-telegram-bot",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "350M",
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
      error_file: "./logs/error.log",
      out_file: "./logs/combined.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      kill_timeout: 8000,
      listen_timeout: 10000,
    },
  ],
};
