import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import ja from './locales/ja.json';

const i18n = createI18n({
  legacy: false, // usage with Composition API
  locale: 'ja', // set locale
  fallbackLocale: 'en', // set fallback locale
  messages: {
    en,
    ja
  }
});

export default i18n;
