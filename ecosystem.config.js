/** @format */

module.exports = {
  apps: [
    {
      name: "eve-killboard-backend",
      script: "./index.js",
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
