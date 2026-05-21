import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Matched to lib/theme/app_colors.dart in the Flutter app
        'inzone-primary': '#2196F3',
        'inzone-light': '#14CFEE',
        'inzone-bg': '#E8F5FE',
        'inzone-dark-bg': '#121212',
        'inzone-dark-surface': '#1E1E1E',
        'inzone-divider': '#E0E0E0',
        'inzone-mid-grey': '#A4ACB9',
        'inzone-light-grey': '#F0F0F0',
      },
      fontFamily: {
        sans: [
          'AppleSDGothicNeo',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '14px',
        button: '10px',
      },
      boxShadow: {
        card: '0 2px 6px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
