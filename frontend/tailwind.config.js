/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: '#FAFAF7',      // warm paper background
        surface: '#FFFFFF',    // raised surfaces
        ink: '#1A1712',        // warm near-black text
        muted: '#6E675C',      // secondary text
        faint: '#A39A8B',      // tertiary text / placeholders
        hairline: '#E9E2D5',   // borders, dividers
        wash: '#F3EFE6',       // subtle tinted background
        pine: {
          DEFAULT: '#1D4A38',  // primary: deep green
          deep: '#143A2C',
          soft: '#EBF1EC',     // tinted fills
        },
        ember: {
          DEFAULT: '#C2521E',  // thermal accent — heat only
          deep: '#A33F14',     // text-safe on light backgrounds
          soft: '#FAEDE3',
        },
        clay: '#C98A2D',       // mid thermal step (markers/legend only)
        offline: '#B3372A',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
      },
      boxShadow: {
        // one restrained level; use sparingly, only where hierarchy needs it
        restrained: '0 1px 3px rgba(26, 23, 18, 0.08), 0 1px 2px rgba(26, 23, 18, 0.06)',
      },
    },
  },
  plugins: [],
}
