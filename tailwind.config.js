/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1E1B3A',
        'ink-soft': '#4B4770',
        brand: '#5B3FE0',
        canvas: '#F5F1FF',
        sun: '#FFE27A',
        mint: '#BFF0DA',
        rose: '#F0568C',
        pine: '#087F63',
        debt: '#C2255C',
      },
      fontFamily: {
        display: ['"Baloo 2"', 'system-ui', 'sans-serif'],
        sans: ['Nunito', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        chunk: '0 5px 0 rgba(30,27,58,.12)',
        'chunk-lg': '0 7px 0 rgba(30,27,58,.28)',
      },
    },
  },
  plugins: [],
};
