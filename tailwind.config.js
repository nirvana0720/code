/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontSize: {
        // 大字模式，年長者友善
        'kiosk-sm': ['1.125rem', '1.75rem'],
        'kiosk-base': ['1.375rem', '2rem'],
        'kiosk-lg': ['1.75rem', '2.5rem'],
        'kiosk-xl': ['2.25rem', '3rem'],
        'kiosk-2xl': ['3rem', '3.75rem'],
      }
    }
  },
  plugins: []
}
