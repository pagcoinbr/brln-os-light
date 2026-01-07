/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif']
      },
      colors: {
        ink: '#0b1020',
        slate: '#111827',
        fog: '#e5e7eb',
        ember: '#ef4444',
        glow: '#14b8a6',
        midnight: '#0f172a',
        brass: '#f59e0b'
      },
      boxShadow: {
        panel: '0 20px 40px rgba(2, 6, 23, 0.35)'
      }
    }
  },
  plugins: []
}
