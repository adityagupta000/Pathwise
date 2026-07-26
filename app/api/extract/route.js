import { NextResponse } from "next/server";

const SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_DIGITIZATION_URL = "https://api.sarvam.ai/v1/document/digitize";

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

async function digitizeDocument(fileData, fileType, fileName, apiKey) {
  try {
    console.log(`[PathWise] Starting document digitization for ${fileName}`);

    // Convert fileData array back to Buffer
    const buffer = Buffer.from(fileData);

    // Create form data
    const formData = new FormData();
    const blob = new Blob([buffer], {
      type: fileType === "pdf" ? "application/pdf" : `image/${fileType}`,
    });
    formData.append("file", blob, fileName);

    const response = await fetch(SARVAM_DIGITIZATION_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[PathWise] Digitization failed for ${fileName}:`, response.status, errText);
      return {
        success: false,
        error: `Digitization failed (${response.status})`,
        fileName
      };
    }

    const data = await response.json();
    console.log(`[PathWise] Digitization successful for ${fileName}`);

    // Extract text from response (adjust based on actual API response format)
    const extractedText = data.text || data.content || data.result || "";

    if (!extractedText) {
      return {
        success: false,
        error: "No text extracted from document",
        fileName
      };
    }

    return {
      success: true,
      text: extractedText,
      fileName,
      pages: data.pages || 1
    };

  } catch (err) {
    console.error(`[PathWise] Digitization error for ${fileName}:`, err);
    return {
      success: false,
      error: err.message,
      fileName
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

    // Process documents: digitize PDFs/images
    const processedDocs = [];
    const digitizationErrors = [];

    for (const doc of documents) {
      if (doc.fileType === "pdf" || doc.fileType === "image") {
        console.log(`[PathWise] Processing ${doc.fileType}: ${doc.fileName}`);

        const result = await digitizeDocument(
          doc.fileData,
          doc.fileType,
          doc.fileName,
          apiKey
        );

        if (result.success) {
          processedDocs.push({
            ...doc,
            text: result.text,
            digitized: true,
            pages: result.pages
          });
        } else {
          digitizationErrors.push({
            fileName: doc.fileName,
            error: result.error
          });
        }
      } else {
        // Text documents pass through
        processedDocs.push(doc);
      }
    }

    // If all documents failed digitization, return error
    if (processedDocs.length === 0) {
      return NextResponse.json({
        error: "Document Digitization Failed",
        details: "Could not extract text from any uploaded documents.",
        failures: digitizationErrors
      }, { status: 400 });
    }

    // If some documents failed, log warnings but continue
    if (digitizationErrors.length > 0) {
      console.warn("[PathWise] Some documents failed digitization:", digitizationErrors);
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
        temperature: 0.1,
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
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[PathWise] No content in Sarvam response");
      return NextResponse.json({
        error: "Empty Response",
        details: "Sarvam API returned an empty response. The document may not contain extractable information.",
      }, { status: 500 });
    }

    const parsed = JSON.parse(content);
    // Add IDs to extractions
    const extractions = (parsed.extractions || []).map((ext, idx) => ({
      ...ext,
      id: `doc${idx + 1}`,
    }));

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
