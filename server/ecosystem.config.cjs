module.exports = {
  apps: [
    {
      name: "hospital-ops-report",
      script: "server/server.js",
      cwd: "/var/www/ribao",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
