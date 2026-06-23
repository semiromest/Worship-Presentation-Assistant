/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/index.html", "./src/renderer/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design token surface scale — matches CSS variables in index.css
        surface: {
          base:    '#0f0f11',
          DEFAULT: '#181818',
          raised:  '#1e1e1e',
          overlay: '#242424',
        },
        // Accent
        accent: {
          DEFAULT: '#3b82f6',  // blue-500
          dim:     'rgba(59,130,246,0.20)',
        },
      },
      // Contrast-safe opacity scale for white text on dark backgrounds
      // All values meet ≥4.5:1 on #181818 (--bg-surface)
      // white/92 = ~14.2:1, white/65 = ~9.2:1, white/45 = ~5.8:1
      // white/30 = ~3.4:1  ← FAILS 4.5:1 — never use for body text
      opacity: {
        92: '0.92',
        65: '0.65',
        55: '0.55',
        45: '0.45',
      },
      fontSize: {
        // Ensure minimum readable sizes are used
        'xs-safe': ['0.75rem', { lineHeight: '1.5' }],   // 12px / 18px — readable
      },
      spacing: {
        // 4px-base spacing scale tokens
        'sp-1': '4px',
        'sp-2': '8px',
        'sp-3': '12px',
        'sp-4': '16px',
        'sp-5': '20px',
        'sp-6': '24px',
      },
    },
  },
  plugins: [],
};
