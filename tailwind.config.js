/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        xs: ['var(--type-meta)', { lineHeight: 'var(--leading-meta)' }],
        sm: ['var(--type-body-sm)', { lineHeight: 'var(--leading-body-sm)' }],
        base: ['var(--type-body-lg)', { lineHeight: 'var(--leading-body)' }],
        lg: ['var(--type-card-title)', { lineHeight: 'var(--leading-card)' }],
        xl: ['var(--type-section-title)', { lineHeight: 'var(--leading-section)' }],
        '2xl': ['var(--type-page-title-mobile)', { lineHeight: 'var(--leading-page)' }],
        '3xl': ['var(--type-page-title)', { lineHeight: 'var(--leading-page)' }],
        page: ['var(--type-page-title)', { lineHeight: 'var(--leading-page)' }],
        section: ['var(--type-section-title)', { lineHeight: 'var(--leading-section)' }],
        card: ['var(--type-card-title)', { lineHeight: 'var(--leading-card)' }],
        body: ['var(--type-body)', { lineHeight: 'var(--leading-body)' }],
        'body-sm': ['var(--type-body-sm)', { lineHeight: 'var(--leading-body-sm)' }],
        meta: ['var(--type-meta)', { lineHeight: 'var(--leading-meta)' }],
        label: ['var(--type-badge)', { lineHeight: 'var(--leading-label)' }],
        kpi: ['var(--type-kpi)', { lineHeight: 'var(--leading-kpi)' }],
      },
      colors: {
        brand: {
          DEFAULT: '#5636D9',
          light: '#f0edff',
          dark: '#4224ba',
          hover: '#4b2ec7',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          app: '#F5F6F8',
          card: '#FFFFFF',
          border: '#E1E4EA',
          hover: '#F8F9FA',
          subtle: '#F0F2F5',
        },
        content: {
          primary: '#171A24',
          secondary: '#5D6472',
          muted: '#8A92A6',
        },
        badge: {
          green: '#E8F5E9',
          greenText: '#16845B',
          amber: '#FFF8E1',
          amberText: '#A85B08',
          red: '#FFEBEE',
          redText: '#B42332',
          blue: '#E3F2FD',
          blueText: '#1976D2',
          purple: '#F3E8FF',
          purpleText: '#6B21A8',
        },
      },
    },
  },
  plugins: [],
};
