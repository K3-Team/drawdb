// Shipped right-to-left (Arabic/Hebrew-script) locales. Keep this in sync with
// the RTL locale files under src/i18n/locales (ug = Uyghur, sd = Sindhi, both
// Arabic-script and RTL). Pashto (ps) is RTL too but no `ps` locale ships, so
// it is not listed until one does.
const rtlLanguages = ["ar", "he", "fa", "ug", "ur", "sd"];
export const isRtl = (language) => rtlLanguages.includes(language);
