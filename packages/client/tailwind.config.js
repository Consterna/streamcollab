/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obs: {
          dark: '#18181b',
          panel: '#27272a',
          border: '#3f3f46',
          accent: '#6366f1',
          rec: '#ef4444',
          pause: '#f59e0b',
        }
      },
      animation: {
        'toast-in': 'toastIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'toast-out': 'toastOut 0.3s cubic-bezier(0.7, 0, 0.84, 0) forwards',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        toastIn: {
          '0%': { transform: 'translateY(-20px) scale(0.95)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        toastOut: {
          '0%': { transform: 'translateY(0) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-20px) scale(0.95)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
