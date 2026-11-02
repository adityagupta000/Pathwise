"use client";

import { useEffect, useRef, useState } from "react";
import { LANGUAGES } from "@/lib/languages";
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_TEXT_CHARS } from "@/lib/limits";
import Notice from "@/components/Notice";
import { sampleDates } from "@/lib/deadlines";

export function getDefaultDocs() {
  const { submissionDate, appointmentDate } = sampleDates();

  return [
    {
      id: "doc1",
      source: "UIDAI",
      title: "Aadhaar Update Form - Demographic Update",
      text: `AADHAAR UPDATE FORM
Unique Identification Authority of India
Under Section 3 of THE AADHAAR (TARGETED DELIVERY OF FINANCIAL AND OTHER SUBSIDIES, BENEFITS AND SERVICES) ACT,2016 (Aadhaar Act)

Submission Date: ${submissionDate}
Aadhaar Number: XXXX XXXX 1234
Application Type: UPDATE

Fields to be updated in Aadhaar: [ Address, Email, ]*
*Only fields mentioned here will be updated at ASK center.

Applicant Details:
Full Name: SAMPLE USER
Date Of Birth/Age: 01-04-2001
Address: 12 Sample Road, Sample Nagar, New Delhi, 110001
Email: sample.user@example.com

Appointment Details:
Appointment Id: 1000000000001
Aadhaar Seva Kendra Address: Lower Ground Floor Akshardham Metro Mall (Parshuvanath), Delhi
Appointment Date and Time: ${appointmentDate} (08:30)
Service Type: Demographic Update (Address, Email,)
Payment Type: Online
Payment Status: Success

Documents to Carry:
- Bring original documents for Enrolment/Update. No photocopy required.
- Original documents are scanned and given back to you.
- Carry/Bring appointment print copy.

Proof of address:
Voter Identity Card Card/e-Voter Identity Card

Disclosure under section 3(2) of THE AADHAAR ACT, 2016:
I confirm that I have been residing in India for at least 182 days in the preceding 12 months. I am a Non Resident Indian (NRI) & information (including biometrics) provided by me to the UIDAI is my own and is true, correct and accurate. I am aware that my information including biometrics will be used for generation of Aadhaar and authentication.`,
      fileName: "aadhaar_update_form.txt",
      fileType: "text",
    },
    {
      id: "doc2",
      source: "Bank",
      title: "Bank KYC Re-verification Notice",
      text: `IMPORTANT NOTICE - KYC RE-VERIFICATION REQUIRED

Dear Customer,

As per Reserve Bank of India (RBI) guidelines, periodic KYC re-verification is mandatory for all bank accounts.

Your KYC details are due for re-verification. Please visit your nearest branch within 10 days to complete the KYC update process.

Required Documents:
1. Updated Aadhaar card with current address
2. PAN card
3. Recent passport-sized photograph
4. Proof of current address (if different from Aadhaar)

Important: KYC cannot be processed until your Aadhaar details (including address) are updated. If your Aadhaar address is outdated, please update it at the nearest Aadhaar Seva Kendra first.

Deadline: Within 10 days from receipt of this notice

Consequence of Non-Compliance:
- Account restrictions on transactions
- Account may be frozen as per RBI guidelines
- Limited access to banking services

For any queries, please contact your branch or call our helpline.`,
      fileName: "bank_kyc_notice.txt",
      fileType: "text",
    },
  ];
}

// Sarvam Document AI accepts PDF, PNG and JPEG (not WebP), so WebP is converted in the browser.
async function webpToPng(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close(); // Release GPU memory.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Canvas toBlob returned null - conversion failed");
  return new File([blob], file.name.replace(/\.webp$/i, ".png"), { type: "image/png" });
}

function detectType(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (file.type === "application/pdf" || ext === "pdf") return "pdf";
  if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
  return "text";
}

/**
 * DocumentCards - fully controlled component.
 * `documents` and `docLanguage` are lifted to the parent (app/page.js).
 * Receives setters and an `onDocumentsReady` callback.
 */
export default function DocumentCards({
  documents,
  setDocuments,
  docLanguage,
  setDocLanguage,
  onDocumentsReady,
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const uploadSuccessTimerRef = useRef(null);
  const addMoreRef = useRef(null);


  const updateDocText = (idx, newText) => {
    setDocuments((prev) => prev.map((doc, i) => i === idx ? { ...doc, text: newText } : doc));
  };

  /** Remove a single document card by index (item 3.5). */
  const removeDoc = (idx) => {
    setDocuments((prev) => prev.filter((_, i) => i !== idx));
  };

  const processFiles = async (files, append = false, input = null) => {
    files = Array.from(files);
    if (files.length === 0) return;

    setUploadError(null);

    const existing = append ? documents : [];
    const combinedCount = existing.length + files.length;

    if (combinedCount > MAX_FILES) {
      setUploadError(
        `You can have at most ${MAX_FILES} documents. Currently ${existing.length} loaded; adding ${files.length} would exceed the limit.`
      );
      if (input) input.value = "";
      return;
    }

    // Per-file size check.
    const tooLarge = files.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooLarge.length > 0) {
      setUploadError(
        `File size limit exceeded: ${tooLarge
          .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`)
          .join(", ")}. Maximum 25 MB per file.`
      );
      if (input) input.value = "";
      return;
    }

    // Supported types.
    const SUPPORTED_TYPES = ["text/plain", "application/pdf", "image/png", "image/jpeg", "image/webp"];
    const SUPPORTED_EXTS = [".txt", ".pdf", ".png", ".jpg", ".jpeg", ".webp"];
    const unsupported = files.filter((f) => {
      const ext = "." + f.name.split(".").pop().toLowerCase();
      return !SUPPORTED_EXTS.includes(ext) ||
        (!SUPPORTED_TYPES.includes(f.type) && f.type !== "");
    });
    if (unsupported.length > 0) {
      setUploadError(
        `Unsupported file type: ${unsupported.map((f) => f.name).join(", ")}. ` +
          "Supported formats: TXT, PDF, PNG, JPG, JPEG, WEBP."
      );
      if (input) input.value = "";
      return;
    }

    setUploading(true);
    setUploadSuccess(false);

    const newDocs = [];
    const errors = [];

    for (let idx = 0; idx < files.length; idx++) {
      const original = files[idx];
      try {
        const fileType = detectType(original);
        const base = {
          id: `upload${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 11)}`,
          source: "Uploaded Document",
          title: original.name.replace(/\.[^/.]+$/, ""),
          fileType,
        };

        if (fileType === "text") {
          newDocs.push({ ...base, text: await original.text(), fileName: original.name });
        } else {
          // WebP conversion - per-file error handling so one bad file doesn't block others.
          let file = original;
          if (/\.webp$/i.test(original.name) || original.type === "image/webp") {
            file = await webpToPng(original);
          }
          newDocs.push({
            ...base,
            fileName: file.name,
            file,
            text: "",
          });
        }
      } catch (err) {
        console.error(`Error processing ${original.name}:`, err.message);
        errors.push(original.name);
      }
    }

    if (errors.length > 0) {
      setUploadError(`Could not process: ${errors.join(", ")}. Other files were loaded successfully.`);
    }

    if (newDocs.length > 0) {
      if (append) {
        setDocuments((prev) => [...prev, ...newDocs]);
      } else {
        setDocuments(newDocs);
      }
      setUploadSuccess(true);
      if (uploadSuccessTimerRef.current) clearTimeout(uploadSuccessTimerRef.current);
      uploadSuccessTimerRef.current = setTimeout(() => setUploadSuccess(false), 3000);
    }

    setUploading(false);
    if (input) input.value = "";
  };

  const handleFileUpload = (e, append = false) => {
    processFiles(e.target.files, append, e.target);
  };

  const handleAnalyze = () => {
    // Client-side total size check (item 3.5).
    const totalBytes = documents.reduce((sum, doc) => sum + (doc.file?.size ?? 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      setUploadError(
        `Total upload size (${(totalBytes / 1024 / 1024).toFixed(1)} MB) exceeds the 60 MB limit. Please remove some files.`
      );
      return;
    }

    // Block if any text doc is whitespace-only (item 3.5).
    const emptyTextDocs = documents.filter(
      (doc) => (!doc.fileType || doc.fileType === "text") && (!doc.text || !doc.text.trim())
    );
    if (emptyTextDocs.length > 0) {
      setUploadError(
        `Some text documents are empty: ${emptyTextDocs.map((d) => d.title || d.fileName || "untitled").join(", ")}. Please add content or remove them.`
      );
      return;
    }

    // B19: Check text length on text docs
    const tooLongDocs = documents.filter(
      (doc) => (!doc.fileType || doc.fileType === "text") && doc.text && doc.text.length > MAX_TEXT_CHARS
    );
    if (tooLongDocs.length > 0) {
      setUploadError(
        `Text too long: ${tooLongDocs.map((d) => d.title || d.fileName || "untitled").join(", ")}. Maximum ${MAX_TEXT_CHARS.toLocaleString()} characters per document.`
      );
      return;
    }
    if (onDocumentsReady) {
      onDocumentsReady(documents, docLanguage);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files || []);
    if (dropped.length === 0) return;
    processFiles(dropped, documents.length > 0);
  };

  // B19: clear uploadSuccess timer on unmount
  useEffect(() => () => {
    if (uploadSuccessTimerRef.current) clearTimeout(uploadSuccessTimerRef.current);
  }, []);

  return (
    <>
      <section className="documents-section">
        <div className="container">
          <div className="section-label">
            Uploaded Documents
            <span style={{ fontSize: "13px", opacity: 0.7, marginLeft: "10px" }}>
              ({documents.length} {documents.length === 1 ? "document" : "documents"})
            </span>
          </div>

          {/* C4: aria-live drop status */}
          <div aria-live="polite" className="sr-only">
            {isDragOver ? "Drop files to upload" : ""}
          </div>
          {/* Inline upload error notice */}
          {uploadError && (
            <Notice
              type="error"
              title="Upload error"
              message={uploadError}
              onDismiss={() => setUploadError(null)}
            />
          )}

          {/* Primary file upload zone */}
          <div
            className={`upload-zone${isDragOver ? " drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-label="Upload zone — drag files here or click to browse"
          >
            <input
              type="file"
              id="file-upload"
              multiple
              accept=".txt,.pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => handleFileUpload(e, false)}
              className="sr-only"
            />
            <label htmlFor="file-upload" className="upload-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {uploading ? "Uploading..." : "Upload Documents"}
              <span className="upload-hint">
                {uploadSuccess ? "Uploaded Successfully!" : "Supports PDF, PNG, JPG, JPEG, WEBP, and TXT files"}
              </span>
            </label>
          </div>

          {/* Add more files (appends, doesn't replace) */}
          {documents.length > 0 && documents.length < MAX_FILES && (
            <>
              <input
                ref={addMoreRef}
                type="file"
                id="file-upload-more"
                multiple
                accept=".txt,.pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => handleFileUpload(e, true)}
                className="sr-only"
              />
              <button
                type="button"
                className="btn-add-more"
                onClick={() => document.getElementById("file-upload-more").click()}
                disabled={uploading}
                aria-label={`Add more files - ${MAX_FILES - documents.length} slot${MAX_FILES - documents.length !== 1 ? "s" : ""} remaining`}
              >
                + Add more files ({MAX_FILES - documents.length} remaining)
              </button>
            </>
          )}

          <div className="doc-language-row">
            <label htmlFor="doc-language">Language of your documents</label>
            <select
              id="doc-language"
              className="doc-language-select"
              value={docLanguage}
              onChange={(e) => setDocLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.native})
                </option>
              ))}
            </select>
            <span className="doc-language-note">Helps the scanner read scanned pages and photos accurately.</span>
          </div>

          <div className="doc-grid">
            {documents.length === 0 && (
              <button type="button" className="btn-load-samples" onClick={() => setDocuments(getDefaultDocs())}>
                Load sample documents
              </button>
            )}
            {documents.map((doc, idx) => (
              <div className="doc-card" key={doc.id}>
                <div className="doc-card-header">
                  <div className="doc-icon">
                    {doc.fileType === "pdf" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    ) : doc.fileType === "image" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="doc-source">{doc.source}</div>
                    <div className="doc-title">{doc.title}</div>
                    {doc.fileName && <div className="doc-filename">{doc.fileName}</div>}
                    {doc.file && (
                      <div className="doc-filename">
                        {doc.fileType.toUpperCase()} - {(doc.file.size / 1024).toFixed(1)} KB
                      </div>
                    )}
                  </div>
                  {/* Remove button (item 3.5) */}
                  <button
                    type="button"
                    className="doc-remove-btn"
                    onClick={() => removeDoc(idx)}
                    aria-label={`Remove document: ${doc.title || doc.fileName || "document"}`}
                  >
                    &#10005; Remove
                  </button>
                </div>
                {doc.file && (doc.fileType === "pdf" || doc.fileType === "image") ? (
                  <div className="doc-metadata" aria-label={`${doc.fileType} metadata`}>
                    {doc.fileType.toUpperCase()} - {(doc.file.size / 1024).toFixed(1)} KB
                  </div>
                ) : (
                  <textarea
                    className="doc-textarea"
                    value={doc.text}
                    onChange={(e) => updateDocText(idx, e.target.value)}
                    rows={6}
                    aria-label={`Content of ${doc.title || doc.fileName || "document"}`}
                  />
                )}
                {/* Character count for text docs (item 3.5) */}
                {(!doc.fileType || doc.fileType === "text") && (
                  <p
                    className={`char-count${
                      (doc.text?.length ?? 0) >= MAX_TEXT_CHARS
                        ? " at-limit"
                        : (doc.text?.length ?? 0) >= MAX_TEXT_CHARS * 0.9
                        ? " near-limit"
                        : ""
                    }`}
                    aria-live="polite"
                  >
                    {(doc.text?.length ?? 0).toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()} characters
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="analyze-section">
        <div className="container">
          <button
            className="btn-analyze"
            onClick={handleAnalyze}
            disabled={uploading || documents.length === 0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Analyze Documents
          </button>
          {/* Privacy notice (item 3.9) */}
          <p className="privacy-notice">
            Your files are sent to Sarvam AI for processing and are not stored by PathWise.
          </p>
        </div>
      </section>
    </>
  );
}
