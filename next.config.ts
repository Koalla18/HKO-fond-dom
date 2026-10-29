import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Один контейнер с сервером Node: npm run build → .next/standalone
  output: "standalone",
  // Драйверы и почтовые библиотеки — обычные модули Node, их не нужно бандлить.
  serverExternalPackages: ["pg", "imapflow", "mailparser", "nodemailer"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
