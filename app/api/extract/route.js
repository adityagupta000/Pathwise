import { NextResponse } from "next/server";

const SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions";
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || "http://localhost:8000";

const EXTRACTION_SCHEMA = {
  name: "document_extractions",
  strict: true,
  schema: {
    type: "object",
    properties: {
      extractions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            document_type: { type: "string" },
            organization: { type: "string" },
            title: { type: "string" },
            required_action: { type: "string" },
            required_documents: {
              type: "array",
              items: { type: "string" },
            },
            prerequisites: {
              type: "array",
              items: { type: "string" },
            },
            deadline: { type: "string" },
            deadline_days: { type: "integer" },
            appointment_date: { type: ["string", "null"] },
            appointment_time: { type: ["string", "null"] },
            office_location: { type: ["string", "null"] },
            estimated_time: { type: "string" },
            fees: { type: ["string", "null"] },
            reference_number: { type: ["string", "null"] },
            government_department: { type: ["string", "null"] },
            consequence: { type: "string" },
            confidence: { type: "number" },
            source_document: { type: "string" },
            source_page: { type: "string" },
            dependency_reason: { type: "string" },
            evidence_snippet: { type: ["string", "null"] },
          },
          required: [
            "document_type",
            "organization",
            "title",
            "required_action",
            "required_documents",
            "prerequisites",
            "deadline",
            "deadline_days",
            "appointment_date",
            "appointment_time",
            "office_location",
            "estimated_time",
            "fees",
            "reference_number",
            "government_department",
            "consequence",
            "confidence",
            "source_document",
            "source_page",
            "dependency_reason",
            "evidence_snippet",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["extractions"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are an expert document analysis AI for Indian government forms, notices, and institutional documents. You analyze MULTIPLE documents simultaneously to create actionable workflows.

Your task is to extract structured information from each document AND detect relationships BETWEEN documents.

For each document, extract:

1. document_type: Category (e.g., "Aadhaar Update Form", "Bank KYC Notice", "Passport Application")
2. organization: Full issuing authority (e.g., "UIDAI", "Reserve Bank of India")
3. title: Clear descriptive title
4. required_action: EXACT action with specifics - location, date, time if mentioned
5. required_documents: ALL documents to carry - note originals vs photocopies
6. prerequisites: Actions that MUST be completed BEFORE this. Look for "requires", "cannot process until", "must have", "depends on". Match against other uploaded documents.
7. deadline: EXACT deadline with date/time if mentioned
8. deadline_days: Days until deadline from today
9. appointment_date: Specific appointment date if mentioned (YYYY-MM-DD format or null)
10. appointment_time: Specific appointment time if mentioned (HH:MM format or null)
11. office_location: Full address/location where action must be taken (or null)
12. estimated_time: Time to complete (e.g., "30-45 minutes", "1-2 hours")
13. fees: Any fees mentioned (e.g., "Rs. 500", "Free", or null)
14. reference_number: Application/Reference/Appointment number (or null)
15. government_department: Specific department if different from organization (or null)
16. consequence: What happens if not completed
17. confidence: Extraction accuracy (0.0 to 1.0)
18. source_document: Document name with reference numbers
19. source_page: Page number or "Full document"
20. dependency_reason: WHY prerequisites exist with document evidence. Use "No dependencies detected" if none.
21. evidence_snippet: SHORT quote from document supporting the action/deadline (1-2 sentences max, or null)

MULTI-DOCUMENT REASONING:
- Analyze ALL documents together
- Detect shared offices, appointments, documents
- Find blocking dependencies (A must happen before B)
- Identify deadline conflicts
- Match prerequisites across documents
- Detect duplicate work

CRITICAL RULES:
- NEVER hallucinate. If information unavailable, return null
- NEVER invent dependencies not in documents
- Extract EXACT text for dates, times, locations
- Every prerequisite MUST reference uploaded content
- Quote actual document text for evidence_snippet
- If unsure, lower confidence score

EXAMPLES OF DEPENDENCIES:
- "KYC requires updated Aadhaar" → KYC depends on Aadhaar update
- "Passport needs police verification after address proof" → Passport depends on address proof
- Document A mentions Document B by name → dependency exists

Return accurate, verifiable extractions only.`;

/**
 * Send a PDF/image file to the local FastAPI OCR service.
 * @param {Array|Buffer} fileData - File bytes as array
 * @param {string} fileName - Original filename
 * @returns {Promise<{success: boolean, text?: string, pages?: number, error?: string}>}
 */
async function ocrViaLocalService(fileData, fileName) {
  try {
    const buffer = Buffer.from(fileData);

    // Determine MIME type from extension
    const ext = fileName.toLowerCase().split(".").pop();
    const mimeMap = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
    const mimeType = mimeMap[ext] || "application/octet-stream";

    // Build multipart form data
    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append("file", blob, fileName);

    console.log(`[PathWise] Sending '${fileName}' to OCR service at ${OCR_SERVICE_URL}/ocr`);

    const ocrResponse = await fetch(`${OCR_SERVICE_URL}/ocr`, {
      method: "POST",
      body: formData,
    });

    if (!ocrResponse.ok) {
      const errText = await ocrResponse.text();
      console.error(`[PathWise] OCR service error (${ocrResponse.status}):`, errText);
      return {
        success: false,
        error: `OCR service error (${ocrResponse.status}): ${errText}`,
      };
    }

    const ocrData = await ocrResponse.json();

    if (!ocrData.success) {
      return {
        success: false,
        error: ocrData.error || "OCR returned no text",
      };
    }

    console.log(`[PathWise] OCR extracted ${ocrData.characters} chars from ${ocrData.pages} page(s)`);

    return {
      success: true,
      text: ocrData.text,
      pages: ocrData.pages,
      characters: ocrData.characters,
      confidence: ocrData.confidence,
    };
  } catch (err) {
    console.error(`[PathWise] OCR service connection failed:`, err.message);
    return {
      success: false,
      error: `Cannot connect to OCR service at ${OCR_SERVICE_URL}. Is the backend running? (${err.message})`,
    };
  }
}

export async function POST(request) {
  try {
    const { documents } = await request.json();

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return NextResponse.json(
        {
          error: "No documents provided",
          details: "Please upload at least one document to analyze."
        },
        { status: 400 }
      );
    }

    const apiKey = process.env.SARVAM_API_KEY;

    // Require valid API key - no fallback
    if (!apiKey || apiKey === "your_sarvam_api_key_here") {
      console.error("[PathWise] Missing or invalid Sarvam API key");
      return NextResponse.json(
        {
          error: "API Configuration Error",
          details: "SARVAM_API_KEY is not configured. Please add your Sarvam AI API key to .env.local file.",
          solution: "Get your API key from https://sarvam.ai and add it to .env.local as SARVAM_API_KEY=your_key"
        },
        { status: 500 }
      );
    }

    // Process documents: OCR for PDFs/images via local service
    // Use Promise.all for parallel processing (MUCH FASTER for multiple documents)
    console.log(`[PathWise] Processing ${documents.length} document(s) in parallel`);

    const processingPromises = documents.map(async (doc) => {
      // Text documents pass through immediately
      if (doc.fileType !== "pdf" && doc.fileType !== "image") {
        return {
          success: true,
          doc: doc,
        };
      }

      // Process PDF/image through OCR
      console.log(`[PathWise] Processing ${doc.fileType}: ${doc.fileName}`);

      try {
        const result = await ocrViaLocalService(doc.fileData, doc.fileName);

        if (result.success) {
          return {
            success: true,
            doc: {
              ...doc,
              text: result.text,
              digitized: true,
              pages: result.pages,
              characters: result.characters,
              confidence: result.confidence,
            },
          };
        } else {
          return {
            success: false,
            fileName: doc.fileName,
            error: result.error,
          };
        }
      } catch (err) {
        console.error(`[PathWise] Error processing ${doc.fileName}:`, err.message);
        return {
          success: false,
          fileName: doc.fileName,
          error: err.message,
        };
      }
    });

    // Wait for all documents to process in parallel
    const results = await Promise.all(processingPromises);

    // Separate successful and failed documents
    const processedDocs = results
      .filter((r) => r.success)
      .map((r) => r.doc);

    const ocrErrors = results
      .filter((r) => !r.success)
      .map((r) => ({ fileName: r.fileName, error: r.error }));

    // If all documents failed, return error
    if (processedDocs.length === 0) {
      return NextResponse.json({
        error: "Document Processing Failed",
        details: "Could not extract text from any uploaded documents.",
        solution: "Make sure the OCR backend is running (backend/start_ocr.bat), or upload text files instead.",
        failures: ocrErrors,
      }, { status: 400 });
    }

    // If some documents failed, log warnings but continue
    if (ocrErrors.length > 0) {
      console.warn("[PathWise] Some documents failed OCR:", ocrErrors);
    }

    // Build the user message with all documents
    const userMessage = processedDocs
      .map(
        (doc, idx) =>
          `--- DOCUMENT ${idx + 1} ---\nTitle: ${doc.title}\nFilename: ${doc.fileName || "Unknown"}\nSource: ${doc.source || "Unknown"}\nContent:\n${doc.text}\n---`
      )
      .join("\n\n");

    const response = await fetch(SARVAM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sarvam-30b",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: {
          type: "json_schema",
          json_schema: EXTRACTION_SCHEMA,
        },
        temperature: 0,
        max_tokens: 3072,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[PathWise] Sarvam API error:", response.status, errText);

      let errorMessage = "Sarvam API request failed";
      let errorDetails = errText;

      if (response.status === 401) {
        errorMessage = "Authentication Failed";
        errorDetails = "Invalid API key. Please check your SARVAM_API_KEY in .env.local";
      } else if (response.status === 429) {
        errorMessage = "Rate Limit Exceeded";
        errorDetails = "Too many requests. Please wait a moment and try again.";
      } else if (response.status >= 500) {
        errorMessage = "Sarvam API Server Error";
        errorDetails = "Sarvam AI service is temporarily unavailable. Please try again later.";
      }

      return NextResponse.json({
        error: errorMessage,
        details: errorDetails,
        statusCode: response.status
      }, { status: response.status });
    }

    const data = await response.json();
    console.log("[PathWise] Full Sarvam response:", JSON.stringify(data).substring(0, 500));

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[PathWise] No content in Sarvam response");
      console.error("[PathWise] Response structure:", JSON.stringify(data));
      return NextResponse.json({
        error: "Empty Response",
        details: "Sarvam API returned an empty response. The document may not contain extractable information.",
      }, { status: 500 });
    }

    console.log("[PathWise] Content to parse:", content.substring(0, 500));

    // Safe JSON parsing with validation
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error("[PathWise] JSON parsing failed:", parseErr.message);
      console.error("[PathWise] Raw content (first 1000 chars):", content.substring(0, 1000));
      console.error("[PathWise] Raw content (last 200 chars):", content.substring(Math.max(0, content.length - 200)));
      return NextResponse.json({
        error: "Invalid Response Format",
        details: "Received malformed JSON from AI extraction. The AI model may have returned text instead of structured JSON. Please try again.",
      }, { status: 500 });
    }

    // Validate extractions exist and is array
    if (!parsed || !Array.isArray(parsed.extractions)) {
      console.error("[PathWise] Invalid extraction structure:", parsed);
      return NextResponse.json({
        error: "Invalid Extraction Structure",
        details: "AI extraction did not return expected format. Please try again.",
      }, { status: 500 });
    }

    // Add IDs and validate required fields
    const extractions = parsed.extractions
      .filter(ext => ext && typeof ext === 'object')
      .map((ext, idx) => ({
        ...ext,
        id: `doc${idx + 1}`,
        // Ensure critical fields exist
        required_action: ext.required_action || "Action not specified",
        document_type: ext.document_type || "Unknown",
        organization: ext.organization || "Unknown",
        confidence: typeof ext.confidence === 'number' ? ext.confidence : 0.5,
      }));

    if (extractions.length === 0) {
      return NextResponse.json({
        error: "No Valid Extractions",
        details: "Could not extract valid information from the uploaded documents.",
      }, { status: 400 });
    }

    return NextResponse.json({
      extractions,
      source: "sarvam",
    });
  } catch (err) {
    console.error("[PathWise] Extraction error:", err);
    return NextResponse.json({
      error: "Processing Error",
      details: err.message || "An unexpected error occurred while processing your documents.",
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    }, { status: 500 });
  }
}
