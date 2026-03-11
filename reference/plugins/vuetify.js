import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import '@mdi/font/css/materialdesignicons.css'

const mediumLightTheme = {
  dark: false,
  colors: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    primary: '#1A1A1A',
    secondary: '#757575',
    accent: '#242424',
    error: '#B91C1C',
    info: '#2563EB',
    success: '#059669',
    warning: '#D97706',
    'on-surface': '#242424',
    'on-background': '#242424',
  },
}

export default createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'mediumLightTheme',
    themes: {
      mediumLightTheme,
    },
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: {
      mdi,
    },
  },
})
