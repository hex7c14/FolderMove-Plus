/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        /**
         * 主色 = Fluent 2 的 brand / 强调色（Communication Blue 家族）。
         * 取的是 Fluent 官方 brand ramp 的原值，不是自己调的蓝：
         * 500 是 Fluent 2 默认强调色 #0f6cbd，600 是它的 hover，700 是 pressed。
         * 浅色主题用 500~700，暗色主题用 400 这一档（Fluent dark 的 #479ef5）。
         */
        brand: {
          50: "#eff6fc",
          100: "#deecf9",
          200: "#c7e0f4",
          300: "#a9d3f2",
          400: "#479ef5",
          500: "#0f6cbd",
          600: "#115ea3",
          700: "#0c3b5e",
          800: "#0b3350",
          900: "#082b43",
          950: "#04253b",
        },
        ink: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#d5d9e3",
          300: "#b1b8ca",
          400: "#8691ac",
          500: "#667193",
          600: "#525a78",
          700: "#444a62",
          800: "#3b4053",
          900: "#343847",
          950: "#1e2230",
        },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "PingFang SC",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 2px 8px -2px rgba(20, 30, 80, 0.08), 0 6px 24px -8px rgba(20, 30, 80, 0.12)",
        /**
         * 卡片 hover 用的描边。之前是带蓝色光晕的 shadow-glow，
         * 属于典型"AI 生成感"的装饰；改成中性的 1px 描边，安静一些。
         */
        ring: "0 0 0 1px rgba(15, 108, 189, 0.28)",
      },
      animation: {
        "fade-in": "fadeIn 0.18s ease-out",
        "slide-up": "slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 1.4s linear infinite",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-468px 0" },
          "100%": { backgroundPosition: "468px 0" },
        },
      },
    },
  },
  plugins: [],
};
