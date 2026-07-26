import { NextResponse } from "next/server";

const SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions";
// Note: Document digitization endpoint - to be verified with official Sarvam API docs
// const SARVAM_DIGITIZATION_URL = "https://api.sarvam.ai/v1/document/digitize";

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
            estimated_time: { type: "string" },
            consequence: { type: "string" },
            confidence: { type: "number" },
            source_document: { type: "string" },
            source_page: { type: "string" },
            dependency_reason: { type: "string" },
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
            "estimated_time",
            "consequence",
            "confidence",
            "source_document",
            "source_page",
            "dependency_reason",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["extractions"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `You are a document analysis AI for Indian government forms, notices, and institutional documents. You analyze MULTIPLE documents simultaneously.

Your task is to extract structured information from each document AND detect relationships BETWEEN documents.

For each document, extract:

1. document_type: The category (e.g., "Aadhaar Update Form", "Bank KYC Notice", "Tax Notice", "Appointment Letter")
2. organization: The full name of issuing authority (e.g., "UIDAI (Unique Identification Authority of India)", "Reserve Bank of India", "Income Tax Department")
3. title: A clear, descriptive title summarizing the document purpose
4. required_action: The EXACT action the citizen must take - be specific about location, method, timing (e.g., "Visit Aadhaar Seva Kendra at Akshardham Metro Mall on 02-01-2025")
5. required_documents: List ALL documents/items mentioned that citizen needs to bring. Include appointment confirmations, proof documents, original vs photocopy requirements
6. prerequisites: List of actions that MUST be completed BEFORE this action. Look for: "cannot be processed until", "requires", "must have", "depends on", "updated". If Document B needs something from Document A, list Document A's action here.
7. deadline: Extract the EXACT deadline text including date, time if mentioned (e.g., "02-01-2025 at 08:30" or "Within 10 days from receipt")
8. deadline_days: Calculate days from today's date to deadline (if "X days", use that number)
9. estimated_time: Typical time to complete this task (e.g., "30-45 minutes", "1-2 hours")
10. consequence: What happens if not completed - extract from document or infer based on document type
11. confidence: Your confidence in extraction accuracy (0.0 to 1.0)
12. source_document: Document name with any reference numbers (e.g., "Aadhaar Update Form (Application: 545138854492)")
13. source_page: Page number, "Full document", or form section name
14. dependency_reason: Explain WHY prerequisites exist using document text. Example: "Bank states KYC requires updated Aadhaar as per RBI guidelines". Use "No dependencies detected" if none.

SPECIAL HANDLING FOR GOVERNMENT FORMS:
- Extract appointment details (date, time, location, appointment ID)
- Note service type from forms (e.g., "Demographic Update (Address, Email)")
- Extract application/reference numbers
- Identify proof of address/identity requirements
- Note "original documents" vs "photocopy" requirements

CRITICAL RULES:
- Analyze ALL documents together for cross-document dependencies
- Extract EXACT text for deadlines, locations, requirements
- NEVER invent dependencies - only use what's stated in documents
- Each prerequisite MUST be traceable to uploaded content
- If no dependencies exist: empty prerequisites array + "No dependencies detected"`;

async function digitizeDocument(fileName) {
  // NOTE: Sarvam Document Digitization API integration
  // This function is architecturally ready but returns null to gracefully fall back
  // TODO: Verify official Sarvam API endpoint and implement when needed

  console.log(`[PathWise] Document digitization requested for ${fileName}`);
  console.log("[PathWise] PDF/Image digitization designed via Sarvam API");
  console.log("[PathWise] Currently falling back to text mode for demo stability");

  // Return null to trigger graceful fallback
  return null;
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

    // Process documents: attempt digitization for PDFs/images if needed
    const processedDocs = await Promise.all(
      documents.map(async (doc) => {
        if (doc.fileType === "pdf" || doc.fileType === "image") {
          const digitizedText = await digitizeDocument(doc.fileName);
          if (digitizedText) {
            return {
              ...doc,
              text: digitizedText,
              digitized: true,
            };
          } else {
            // Graceful fallback: Use the text provided in upload or placeholder
            return {
              ...doc,
              text: doc.text || `Document digitization is designed through Sarvam API. For best results, please use text documents or paste content manually.`,
              digitized: false,
            };
          }
        }
        return doc;
      })
    );

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
        model: "sarvam-2b",
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
