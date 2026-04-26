/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        // Display face: stencil-monospace for instrument labels and
        // mission callsigns. Intentionally only used for short uppercase
        // strings — never for body copy. Falls back to mono if the
        // Google webfont fails to load.
        display: [
          'Major Mono Display',
          'JetBrains Mono',
          'SF Mono',
          'ui-monospace',
          'monospace',
        ],
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
        // Master caution: peripheral pulse, very low alpha, slower than
        // 1Hz. Quiet enough to live with for hours; visible enough to
        // grab the eye on the page edge without bleeding onto the map
        // canvas (the inset glow used to make the polygon appear to
        // throb).
        'caution-pulse': {
          '0%, 100%': { 'box-shadow': 'inset 0 0 0 0 rgba(239, 68, 68, 0.0)' },
          '50%': { 'box-shadow': 'inset 0 0 14px 1px rgba(239, 68, 68, 0.07)' },
        },
        'warn-pulse': {
          '0%, 100%': { 'box-shadow': 'inset 0 0 0 0 rgba(245, 158, 11, 0.0)' },
          '50%': { 'box-shadow': 'inset 0 0 10px 1px rgba(245, 158, 11, 0.05)' },
        },
        // Slow sweep across an empty instrument — signals "hot, awaiting
        // input" without demanding attention. Only used on the seed
        // prompt scan-line.
        'instrument-sweep': {
          '0%': { transform: 'translateY(-12%)', opacity: '0' },
          '15%': { opacity: '0.7' },
          '85%': { opacity: '0.7' },
          '100%': { transform: 'translateY(112%)', opacity: '0' },
        },
        // Cursor-style blink for the slate REC dot.
        'rec-pulse': {
          '0%, 100%': { opacity: '0.25' },
          '50%': { opacity: '1' },
        },
        // Stagger-mount: brief panels and editor frame fade + lift in
        // sequence. Driven via inline animation-delay (no JS).
        'briefing-rise': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'caution-pulse': 'caution-pulse 3000ms ease-in-out infinite',
        'warn-pulse': 'warn-pulse 3600ms ease-in-out infinite',
        'instrument-sweep': 'instrument-sweep 4200ms ease-in-out infinite',
        'rec-pulse': 'rec-pulse 1800ms ease-in-out infinite',
        'briefing-rise': 'briefing-rise 360ms cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
};
