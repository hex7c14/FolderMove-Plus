/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dae6ff",
          200: "#bdd2ff",
          300: "#90b4ff",
          400: "#5e8bff",
          500: "#3b66ff",
          600: "#2948f5",
          700: "#1f37d6",
          800: "#1f30ab",
          900: "#1f2e87",
          950: "#161e52",
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
        glow: "0 0 0 1px rgba(59,102,255,0.18), 0 8px 28px -8px rgba(59,102,255,0.45)",
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
