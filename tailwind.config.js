/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hud: {
          dark: "rgba(10, 15, 29, 0.85)",
          glass: "rgba(18, 24, 38, 0.75)",
          border: "rgba(59, 130, 246, 0.3)",
          accent: "#38bdf8",
          neon: "#22d3ee",
          gold: "#fbbf24",
          success: "#34d399",
        }
      },
      boxShadow: {
        'neon': '0 0 15px rgba(34, 211, 238, 0.25)',
        'neon-gold': '0 0 15px rgba(251, 191, 36, 0.25)',
      }
    },
  },
  plugins: [],
}

