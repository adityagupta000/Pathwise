import { NextResponse } from "next/server";
import { FALLBACK_EXTRACTIONS } from "@/lib/engines";

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

const SYSTEM_PROMPT = `You are a document analysis AI for Indian government and institutional notices analyzing MULTIPLE documents simultaneously.

Your task is to extract structured information from each document AND detect relationships BETWEEN documents.

For each document, extract:

1. document_type: The category (e.g., "Government Notice", "Bank Notice", "Tax Notice")
2. organization: The issuing body (e.g., "UIDAI", "XYZ Bank", "Income Tax Department")
3. title: A short descriptive title for the document
4. required_action: The specific action the citizen must take (be precise)
5. required_documents: List of documents/items the citizen needs to bring or have
6. prerequisites: List of actions that MUST be completed BEFORE this action. Look for explicit dependencies like "cannot be processed until", "requires", "must have", "depends on". If Document B references a requirement from Document A, list Document A's action here.
7. deadline: The deadline as stated in the document
8. deadline_days: Numeric estimate of days until deadline (from today)
9. estimated_time: How long the action typically takes to complete
10. consequence: What happens if the citizen does not comply
11. confidence: Your confidence in the extraction (0.0 to 1.0)
12. source_document: The title/filename of the source document
13. source_page: Page number or "Full document" if not paginated
14. dependency_reason: WHY this action depends on its prerequisites. Example: "Bank states KYC requires updated Aadhaar per RBI guidelines". ONLY fill this if prerequisites exist, otherwise use "No dependencies detected".

CRITICAL RULES:
- Analyze ALL documents together to find cross-document dependencies
- If Document B says "requires updated Aadhaar" and Document A is about Aadhaar updates, Document B MUST list Document A's action in prerequisites
- NEVER invent dependencies. Only extract what is explicitly stated or strongly implied in the documents
- Each prerequisite MUST be traceable to a phrase in one of the uploaded documents
- If no dependencies exist, return empty prerequisites array and "No dependencies detected" for dependency_reason`;

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
        { error: "No documents provided" },
        { status: 400 }
      );
    }

    const apiKey = process.env.SARVAM_API_KEY;

    // If no API key or it's the placeholder, use fallback
    if (!apiKey || apiKey === "your_sarvam_api_key_here") {
      console.log("[PathWise] No Sarvam API key — using fallback extraction");
      return NextResponse.json({
        extractions: FALLBACK_EXTRACTIONS,
        source: "fallback",
      });
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
        model: "sarvam-m",
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
      console.log("[PathWise] Switching to demo mode (fallback extraction)");
      // Graceful fallback on API error
      return NextResponse.json({
        extractions: FALLBACK_EXTRACTIONS,
        source: "fallback",
        message: "Sarvam API unavailable - using demo mode",
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("[PathWise] No content in Sarvam response");
      return NextResponse.json({
        extractions: FALLBACK_EXTRACTIONS,
        source: "fallback",
        error: "No content in API response",
      });
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
      extractions: FALLBACK_EXTRACTIONS,
      source: "fallback",
      error: err.message,
    });
  }
}
