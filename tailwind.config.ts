import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  safelist: [
    // Entity type badges — used via dynamic lookup, must be safelisted
    'bg-purple-600', 'text-white',
    'bg-blue-600',
    'bg-emerald-600',
  ],
  plugins: [],
};
export default config;
