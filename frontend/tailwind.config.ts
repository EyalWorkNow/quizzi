import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: "#071224",
        ink: "#e6f0ff",
        accent: "#2ed3b7",
        accent2: "#1ab8a0",
        gold: "#f4b546",
        slate: "#a7b9d6",
        card: "rgba(13, 25, 44, 0.78)",
        panel: "rgba(17, 34, 58, 0.95)",
        highlight: "rgba(46, 211, 183, 0.14)",
        danger: "#ff6b6b",
        info: "#64b5ff",
        success: "#35d49a",
      },
      borderRadius: {
        lg: "1.25rem",
        md: "1rem",
        sm: "0.75rem"
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))',
      }
    }
  },
  plugins: []
};

export default config;
