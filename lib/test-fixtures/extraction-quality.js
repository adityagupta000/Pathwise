export const kycNotice = {
  fileName: "sanitized-kyc-notice.txt",
  text: [
    "--- Page 1 ---",
    "Public sector bank notice.",
    "Customers must submit updated profile details, mobile number, income and occupation details, and identity or address proof to their home branch immediately.",
    "If an account remains pending, debit transactions will be restricted from 01.04.2022.",
  ].join("\n"),
};

export const trackingResult = {
  fileName: "sanitized-tracking-result.txt",
  text: [
    "--- Page 1 ---",
    "Article tracking result.",
    "Item status: Delivered.",
    "No further action stated.",
  ].join("\n"),
};

export const phaseTwoNotice = {
  fileName: "phase-two-synthetic-notice.txt",
  text: [
    "--- Page 1 ---",
    "Applicants must submit the renewal form by 15 December 2027.",
    "Applicants whose account remains pending after that date will have service access paused.",
  ].join("\n"),
};

export const multiPageNotice = {
  fileName: "sanitized-multi-page-notice.txt",
  pages: 2,
  text: [
    "--- Page 1 ---",
    "Applicants must submit the renewal form by 15 December 2027.",
    "--- Page 2 ---",
    "Applicants in the pilot group must also provide an address certificate.",
    "Applicants who already hold a valid residence card are exempt from this requirement.",
    "If the certificate is unavailable, submit it within 10 days of approval.",
  ].join("\n"),
};
