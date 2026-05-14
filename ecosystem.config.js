// PM2 Ecosystem config - run: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "airangers",
      script: "server.js",
      cwd: "/home/nse/nse.airangers.in",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
