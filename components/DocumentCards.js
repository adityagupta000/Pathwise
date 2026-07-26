"use client";

import { useState } from "react";

const DEFAULT_DOCS = [
  {
    id: "doc1",
    source: "UIDAI",
    title: "Aadhaar Biometric Update Notice",
    text: `Your Aadhaar biometric data (fingerprint/iris) was last updated over 10 years ago. As per UIDAI guidelines, please visit your nearest Aadhaar Seva Kendra to complete a mandatory biometric update. Bring your Aadhaar card, a valid mobile number for OTP verification, and proof of address if applicable. Deadline: 7 days from receipt of this notice.`,
    fileName: "aadhaar_notice.txt",
  },
  {
    id: "doc2",
    source: "XYZ Bank",
    title: "Bank KYC Reminder",
    text: `Your KYC details are due for periodic re-verification. As per RBI guidelines, please complete KYC at your nearest branch within 10 days to avoid account restrictions. Required: valid Aadhaar with updated biometrics, PAN card, and a recent photograph. Note: KYC cannot be processed until Aadhaar biometrics are updated.`,
    fileName: "bank_kyc.txt",
  },
];

export default function DocumentCards({ onDocumentsReady }) {
  const [documents, setDocuments] = useState(DEFAULT_DOCS);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const updateDocText = (idx, newText) => {
    const updated = [...documents];
    updated[idx] = { ...updated[idx], text: newText };
    setDocuments(updated);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    setUploadSuccess(false);

    try {
      const newDocs = await Promise.all(
        files.map(async (file, idx) => {
          const fileType = file.type;
          const fileName = file.name;
          let text = "";

          // Handle different file types
          if (fileType === "application/pdf") {
            // PDF - designed for Sarvam Document Digitization
            const buffer = await file.arrayBuffer();
            text = `[PDF Document: ${fileName}]\n\nNote: PDF digitization is designed through Sarvam API. For best results, please paste the text content manually or upload as a .txt file.`;
            return {
              id: `upload${Date.now()}_${idx}`,
              source: "Uploaded Document",
              title: fileName.replace(/\.[^/.]+$/, ""),
              text,
              fileName,
              fileType: "pdf",
              fileData: Array.from(new Uint8Array(buffer)),
            };
          } else if (fileType.startsWith("image/")) {
            // Image - designed for Sarvam Document Digitization
            const buffer = await file.arrayBuffer();
            text = `[Image Document: ${fileName}]\n\nNote: Image digitization is designed through Sarvam API. For best results, please paste the text content manually or upload as a .txt file.`;
            return {
              id: `upload${Date.now()}_${idx}`,
              source: "Uploaded Document",
              title: fileName.replace(/\.[^/.]+$/, ""),
              text,
              fileName,
              fileType: "image",
              fileData: Array.from(new Uint8Array(buffer)),
            };
          } else {
            // Plain text
            text = await file.text();
            return {
              id: `upload${Date.now()}_${idx}`,
              source: "Uploaded Document",
              title: fileName.replace(/\.[^/.]+$/, ""),
              text,
              fileName,
              fileType: "text",
            };
          }
        })
      );

      setDocuments(newDocs);
      setUploadSuccess(true);

      // Hide success message after 3 seconds
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading files. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = () => {
    if (onDocumentsReady) {
      onDocumentsReady(documents);
    }
  };

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

          {/* File Upload Area */}
          <div className="upload-zone">
            <input
              type="file"
              id="file-upload"
              multiple
              accept=".pdf,.txt,.doc,.docx,image/*"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            <label htmlFor="file-upload" className="upload-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {uploading ? "Uploading..." : "Upload New Documents"}
              <span className="upload-hint">
                {uploadSuccess ? "✓ Uploaded Successfully!" : "Text files recommended (PDF/Image support designed via Sarvam API)"}
              </span>
            </label>
          </div>

          <div className="doc-grid">
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
                  </div>
                </div>
                <textarea
                  className="doc-textarea"
                  value={doc.text}
                  onChange={(e) => updateDocText(idx, e.target.value)}
                  rows={6}
                  disabled={doc.fileType === "pdf" || doc.fileType === "image"}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="analyze-section">
        <div className="container">
          <button className="btn-analyze" onClick={handleAnalyze} disabled={uploading || documents.length === 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Analyze Documents
          </button>
        </div>
      </section>
    </>
  );
}
