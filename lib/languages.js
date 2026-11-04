// Languages supported by Sarvam's sarvam-translate:v1 (all 22 scheduled languages + English).
// Codes are based on the Sarvam API reference; live endpoint verification is incomplete.
// `rtl` is true for scripts written right-to-left (used for dir="rtl" in the UI).

export const LANGUAGES = [
  { code: "en-IN", name: "English", native: "English" },
  { code: "hi-IN", name: "Hindi", native: "हिन्दी" },
  { code: "bn-IN", name: "Bengali", native: "বাংলা" },
  { code: "ta-IN", name: "Tamil", native: "தமிழ்" },
  { code: "te-IN", name: "Telugu", native: "తెలుగు" },
  { code: "mr-IN", name: "Marathi", native: "मराठी" },
  { code: "gu-IN", name: "Gujarati", native: "ગુજરાતી" },
  { code: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml-IN", name: "Malayalam", native: "മലയാളം" },
  // TODO (P-3 unverified): Sarvam docs show Odia as "or-IN" but this file uses "od-IN".
  // A real OCR call with an Odia document is needed to confirm which code the API accepts.
  // If "od-IN" is rejected, change this to "or-IN" and update lib/languages.js accordingly.
  { code: "od-IN", name: "Odia", native: "ଓଡ଼ିଆ" },
  { code: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "as-IN", name: "Assamese", native: "অসমীয়া" },
  { code: "ur-IN", name: "Urdu", native: "اردو", rtl: true },
  { code: "ne-IN", name: "Nepali", native: "नेपाली" },
  { code: "sa-IN", name: "Sanskrit", native: "संस्कृतम्" },
  { code: "kok-IN", name: "Konkani", native: "कोंकणी" },
  { code: "mai-IN", name: "Maithili", native: "मैथिली" },
  { code: "doi-IN", name: "Dogri", native: "डोगरी" },
  { code: "brx-IN", name: "Bodo", native: "बर'" },
  { code: "ks-IN", name: "Kashmiri", native: "کٲشُر", rtl: true },
  { code: "sd-IN", name: "Sindhi", native: "سنڌي", rtl: true },
  { code: "mni-IN", name: "Manipuri", native: "মৈতৈলোন্" },
  { code: "sat-IN", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ" },
];

export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || null;
}
