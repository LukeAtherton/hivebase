/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Dark cockpit palette. Healthy = near-black; abnormal annunciators
        // get high-contrast accents (amber/red).
        ink: '#05070a',
        panel: '#0b0f14',
        border: '#1a212b',
        muted: '#5a6573',
        text: '#cbd5df',
        accent: '#7dd3fc', // info
        warn: '#f59e0b', // advisory
        alarm: '#ef4444', // required
        ok: '#22c55e',
      },
      keyframes: {
        // Master caution: peripheral pulse, low alpha, ~1Hz. Quiet enough
        // to live with for hours; visible enough to grab the eye.
        'caution-pulse': {
          '0%, 100%': { 'box-shadow': 'inset 0 0 0 0 rgba(239, 68, 68, 0.0)' },
          '50%': { 'box-shadow': 'inset 0 0 36px 4px rgba(239, 68, 68, 0.18)' },
        },
        'warn-pulse': {
          '0%, 100%': { 'box-shadow': 'inset 0 0 0 0 rgba(245, 158, 11, 0.0)' },
          '50%': { 'box-shadow': 'inset 0 0 24px 2px rgba(245, 158, 11, 0.12)' },
        },
      },
      animation: {
        'caution-pulse': 'caution-pulse 1800ms ease-in-out infinite',
        'warn-pulse': 'warn-pulse 2400ms ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
