import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}","./src/components/**/*.{ts,tsx}","./src/lib/**/*.{ts,tsx}"],
  theme: { extend: { fontFamily: { sans: ["system-ui","ui-sans-serif","system","sans-serif"] } } },
  plugins: []
};
export default config;