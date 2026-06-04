/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        manuscript: ['"PingFang SC"', '"Songti SC"', '"Source Han Serif SC"', 'serif'],
      },
    },
  },
  plugins: [typography],
}
