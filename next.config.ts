import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Один контейнер с сервером Node: npm run build → .next/standalone
  output: "standalone",
  poweredByHeader: false,
  // Кабинет нельзя встроить в чужой сайт (подмена кнопок поверх страницы входа),
  // браузер не угадывает тип файлов, адрес кабинета не утекает на внешние ссылки.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
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
