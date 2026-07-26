"use client";

import { useState } from "react";

const DEFAULT_DOCS = [
  {
    id: "doc1",
    source: "UIDAI",
    title: "Aadhaar Update Form - Demographic Update",
    text: `AADHAAR UPDATE FORM
Unique Identification Authority of India
Under Section 3 of THE AADHAAR (TARGETED DELIVERY OF FINANCIAL AND OTHER SUBSIDIES, BENEFITS AND SERVICES) ACT,2016 (Aadhaar Act)

Submission Date: 26-12-2024
Aadhaar Number: 545138854492
Application Type: UPDATE

Fields to be updated in Aadhaar: [ Address, Email, ]*
*Only fields mentioned here will be updated at ASK center.

Applicant Details:
Full Name: JEETENDRA RAM
Date Of Birth/Age: 01-04-2001
Address: C/O BABOOLAL RAM, VILLAGE MANDAR/ PO-POLDIH JADISHPUR, PS-HUSSAINABAD, Mandar, Rusha, Palamu, Jharkhand, 822118
Email: railwayi008@gmail.com

Appointment Details:
Appointment Id: 1735177660567
Aadhaar Seva Kendra Address: Lower Ground Floor Akshardham Metro Mall (Parshuvanath), Delhi
Appointment Date and Time: 02-01-2025 (08:30)
Service Type: Demographic Update (Address, Email,)
Payment Type: Online
Payment Status: Success

Documents to Carry:
• Bring original documents for Enrolment/Update. No photocopy required.
• Original documents are scanned and given back to you.
• Carry/Bring appointment print copy.

Proof of address:
Voter Identity Card Card/e-Voter Identity Card

Disclosure under section 3(2) of THE AADHAAR ACT, 2016:
I confirm that I have been residing in India for at least 182 days in the preceding 12 months. I am a Non Resident Indian (NRI) & information (including biometrics) provided by me to the UIDAI is my own and is true, correct and accurate. I am aware that my information including biometrics will be used for generation of Aadhaar and authentication.`,
    fileName: "aadhaar_update_form.txt",
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
• Account restrictions on transactions
• Account may be frozen as per RBI guidelines
• Limited access to banking services

For any queries, please contact your branch or call our helpline.`,
    fileName: "bank_kyc_notice.txt",
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

          // Add delay to ensure unique IDs
          await new Promise(resolve => setTimeout(resolve, idx * 10));

          // Handle different file types
          if (fileType === "application/pdf") {
            // PDF - designed for Sarvam Document Digitization
            const buffer = await file.arrayBuffer();
            text = `[PDF Document: ${fileName}]\n\nNote: PDF digitization is designed through Sarvam API. For best results, please paste the text content manually or upload as a .txt file.`;
            return {
              id: `upload${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
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
              id: `upload${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
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
              id: `upload${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
              source: "Uploaded Document",
              title: fileName.replace(/\.[^/.]+$/, ""),
              text,
              fileName,
              fileType: "text",
            };
          }
        })
      );

      // Replace ALL documents with newly uploaded ones
      setDocuments(newDocs);
      setUploadSuccess(true);

      // Hide success message after 3 seconds
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading files. Please try again.");
    } finally {
      setUploading(false);
      // Reset file input to allow re-uploading same files
      e.target.value = '';
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
