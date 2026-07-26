// Sarvam Document Digitization API - Asynchronous Job-based Workflow
// Production-ready implementation using OFFICIAL Sarvam API endpoints
// Documentation: https://docs.sarvam.ai/api/api-guides-tutorials/document-digitization/overview

const SARVAM_API_BASE = "https://api.sarvam.ai";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_TIME_MS = 120000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class DigitizationError extends Error {
  constructor(message, statusCode, details) {
    super(message);
    this.name = 'DigitizationError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

class DigitizationTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DigitizationTimeoutError';
  }
}

/**
 * Sleep utility for polling
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const shouldRetry =
        error.statusCode === 429 ||
        error.statusCode === 502 ||
        error.statusCode === 503;

      if (!shouldRetry || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.log(`[Digitization] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Initialize a digitization job
 * OFFICIAL ENDPOINT: POST /doc-digitization/job/v1/initialise
 */
async function createJob(apiKey, language = "en-IN", outputFormat = "md") {
  console.log(`[Digitization] Initializing job with language=${language}, format=${outputFormat}`);

  const response = await fetch(`${SARVAM_API_BASE}/doc-digitization/job/v1/initialise`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      job_parameters: {
        language,
        output_format: outputFormat
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Digitization] Job initialization failed:`, response.status, errorText);

    let message = "Failed to initialize digitization job";
    if (response.status === 403) {
      message = "Invalid API key";
    } else if (response.status === 429) {
      message = "Rate limit exceeded (10 requests/minute)";
    } else if (response.status >= 500) {
      message = "Sarvam server error";
    }

    throw new DigitizationError(message, response.status, errorText);
  }

  const data = await response.json();
  const jobId = data.job_id;

  if (!jobId) {
    throw new DigitizationError("No job_id returned from API", 500, JSON.stringify(data));
  }

  console.log(`[Digitization] Job initialized: ${jobId}`);
  return jobId;
}

/**
 * Upload file to job
 * OFFICIAL ENDPOINT: POST /doc-digitization/job/v1/{job_id}/upload
 */
async function uploadFile(apiKey, jobId, fileBuffer, fileName, mimeType) {
  console.log(`[Digitization] Uploading ${fileName} to job ${jobId}`);

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append("file", blob, fileName);

  const response = await fetch(`${SARVAM_API_BASE}/doc-digitization/job/v1/${jobId}/upload`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Digitization] Upload failed:`, response.status, errorText);

    let message = "File upload failed";
    if (response.status === 400) {
      message = "File exceeds 10-page limit or invalid parameters";
    } else if (response.status === 413) {
      message = "File too large (max 200MB)";
    } else if (response.status === 422) {
      message = "Invalid or corrupted file format";
    } else if (response.status === 404) {
      message = "Job not found";
    }

    throw new DigitizationError(message, response.status, errorText);
  }

  console.log(`[Digitization] Upload complete for ${fileName}`);
  return await response.json();
}

/**
 * Start job processing
 * OFFICIAL ENDPOINT: POST /doc-digitization/job/v1/{job_id}/start
 */
async function startJob(apiKey, jobId) {
  console.log(`[Digitization] Starting job ${jobId}`);

  const response = await fetch(`${SARVAM_API_BASE}/doc-digitization/job/v1/${jobId}/start`, {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Digitization] Start failed:`, response.status, errorText);
    throw new DigitizationError("Failed to start job", response.status, errorText);
  }

  console.log(`[Digitization] Job ${jobId} started`);
  return await response.json();
}

/**
 * Poll job status until completed or failed
 * OFFICIAL ENDPOINT: GET /doc-digitization/job/v1/{job_id}/status
 */
async function pollJobStatus(apiKey, jobId) {
  console.log(`[Digitization] Polling job ${jobId}`);

  const startTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_POLL_TIME_MS) {
      throw new DigitizationTimeoutError(`Job ${jobId} timed out after ${MAX_POLL_TIME_MS / 1000}s`);
    }

    const response = await fetch(`${SARVAM_API_BASE}/doc-digitization/job/v1/${jobId}/status`, {
      method: "GET",
      headers: {
        "api-subscription-key": apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Digitization] Status check failed:`, response.status, errorText);
      throw new DigitizationError("Failed to check job status", response.status, errorText);
    }

    const status = await response.json();
    const state = status.job_state;

    console.log(`[Digitization] Job ${jobId} state: ${state}`);

    if (state === "Completed") {
      console.log(`[Digitization] Job ${jobId} completed successfully`);
      return status;
    }

    if (state === "Failed") {
      const error = status.error_message || "Job processing failed";
      throw new DigitizationError(`Job failed: ${error}`, 500, JSON.stringify(status));
    }

    if (state === "PartiallyCompleted") {
      console.log(`[Digitization] Job ${jobId} partially completed, proceeding`);
      return status;
    }

    // States: Accepted, Pending, Running - continue polling
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Download output ZIP
 * OFFICIAL ENDPOINT: GET /doc-digitization/job/v1/{job_id}/download-files
 */
async function downloadOutput(apiKey, jobId) {
  console.log(`[Digitization] Downloading output for job ${jobId}`);

  const response = await fetch(`${SARVAM_API_BASE}/doc-digitization/job/v1/${jobId}/download-files`, {
    method: "GET",
    headers: {
      "api-subscription-key": apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Digitization] Download failed:`, response.status, errorText);
    throw new DigitizationError("Failed to download output", response.status, errorText);
  }

  const buffer = await response.arrayBuffer();
  console.log(`[Digitization] Downloaded ${buffer.byteLength} bytes`);
  return Buffer.from(buffer);
}

/**
 * Extract text from ZIP archive
 */
async function extractTextFromZip(zipBuffer) {
  console.log(`[Digitization] Extracting text from ZIP`);

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  console.log(`[Digitization] ZIP contains ${entries.length} entries`);

  // Try to find markdown files first
  const mdEntries = entries.filter(e => !e.isDirectory && e.entryName.endsWith('.md'));
  if (mdEntries.length > 0) {
    console.log(`[Digitization] Found ${mdEntries.length} markdown files`);

    // Sort by name to get correct page order
    mdEntries.sort((a, b) => a.entryName.localeCompare(b.entryName));

    const pages = mdEntries.map(entry => {
      const content = entry.getData().toString('utf8');
      return content.trim();
    });

    const text = pages.join('\n\n');
    console.log(`[Digitization] Extracted ${text.length} chars from markdown`);

    return {
      text,
      pages: pages.length,
      format: 'markdown'
    };
  }

  // Try HTML files
  const htmlEntries = entries.filter(e => !e.isDirectory && (e.entryName.endsWith('.html') || e.entryName.endsWith('.htm')));
  if (htmlEntries.length > 0) {
    console.log(`[Digitization] Found ${htmlEntries.length} HTML files`);

    htmlEntries.sort((a, b) => a.entryName.localeCompare(b.entryName));

    const pages = htmlEntries.map(entry => {
      const content = entry.getData().toString('utf8');
      // Strip HTML tags for plain text extraction
      return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    });

    const text = pages.join('\n\n');
    console.log(`[Digitization] Extracted ${text.length} chars from HTML`);

    return {
      text,
      pages: pages.length,
      format: 'html'
    };
  }

  // Fallback to JSON (always included according to docs)
  const jsonEntries = entries.filter(e => !e.isDirectory && e.entryName.endsWith('.json'));
  if (jsonEntries.length > 0) {
    console.log(`[Digitization] Found ${jsonEntries.length} JSON files`);

    jsonEntries.sort((a, b) => a.entryName.localeCompare(b.entryName));

    const pages = [];
    for (const entry of jsonEntries) {
      try {
        const jsonData = JSON.parse(entry.getData().toString('utf8'));
        const pageText = extractTextFromJson(jsonData);
        if (pageText) {
          pages.push(pageText.trim());
        }
      } catch (err) {
        console.warn(`[Digitization] Failed to parse JSON ${entry.entryName}:`, err.message);
      }
    }

    if (pages.length === 0) {
      throw new DigitizationError("No text extracted from JSON files", 500, "Empty pages");
    }

    const text = pages.join('\n\n');
    console.log(`[Digitization] Extracted ${text.length} chars from JSON`);

    return {
      text,
      pages: pages.length,
      format: 'json'
    };
  }

  throw new DigitizationError("No markdown, HTML, or JSON files found in ZIP", 500, "Invalid ZIP structure");
}

/**
 * Extract text from JSON structure
 */
function extractTextFromJson(jsonData) {
  // Handle different JSON structures
  if (typeof jsonData === 'string') {
    return jsonData;
  }

  if (jsonData.text) {
    return jsonData.text;
  }

  if (jsonData.content) {
    return jsonData.content;
  }

  if (jsonData.lines && Array.isArray(jsonData.lines)) {
    return jsonData.lines.map(l => l.text || l.content || '').join('\n');
  }

  if (jsonData.blocks && Array.isArray(jsonData.blocks)) {
    return jsonData.blocks.map(b => b.text || b.content || '').join('\n');
  }

  if (Array.isArray(jsonData)) {
    return jsonData.map(item => extractTextFromJson(item)).filter(Boolean).join('\n');
  }

  return '';
}

/**
 * Main digitization function - production-ready implementation
 *
 * @param {Array|Buffer} fileData - File data as array or buffer
 * @param {string} fileType - File type ("pdf" or "image")
 * @param {string} fileName - Original file name
 * @param {string} apiKey - Sarvam API key
 * @returns {Promise<{success: boolean, text?: string, pages?: number, fileName: string, error?: string}>}
 */
async function digitizeDocument(fileData, fileType, fileName, apiKey) {
  try {
    console.log(`[Digitization] Starting async workflow for ${fileName}`);

    // Convert to buffer
    const buffer = Buffer.isBuffer(fileData) ? fileData : Buffer.from(fileData);

    // Validate file size (200MB limit per API docs)
    const MAX_SIZE = 200 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      return {
        success: false,
        error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum 200MB.`,
        fileName
      };
    }

    // Determine MIME type
    let mimeType;
    if (fileType === "pdf") {
      mimeType = "application/pdf";
    } else if (fileType === "image") {
      // Detect image format from file extension
      const ext = fileName.toLowerCase().split('.').pop();
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
      else if (ext === 'webp') mimeType = 'image/webp';
      else mimeType = 'image/jpeg'; // fallback
    } else {
      return {
        success: false,
        error: "Unsupported file type",
        fileName
      };
    }

    // Step 1: Initialize job with retry
    const jobId = await retryWithBackoff(() => createJob(apiKey, "en-IN", "md"));

    // Step 2: Upload file with retry
    await retryWithBackoff(() => uploadFile(apiKey, jobId, buffer, fileName, mimeType));

    // Step 3: Start processing with retry
    await retryWithBackoff(() => startJob(apiKey, jobId));

    // Step 4: Poll until completed
    await pollJobStatus(apiKey, jobId);

    // Step 5: Download output ZIP with retry
    const zipBuffer = await retryWithBackoff(() => downloadOutput(apiKey, jobId));

    // Step 6: Extract text from ZIP
    const { text, pages, format } = await extractTextFromZip(zipBuffer);

    if (!text || text.length < 10) {
      return {
        success: false,
        error: "Insufficient text extracted from document",
        fileName
      };
    }

    console.log(`[Digitization] Successfully processed ${fileName}: ${pages} pages, ${text.length} chars (${format})`);

    return {
      success: true,
      text,
      pages,
      fileName
    };

  } catch (error) {
    console.error(`[Digitization] Error processing ${fileName}:`, error.message);

    let errorMessage = error.message;

    if (error instanceof DigitizationTimeoutError) {
      errorMessage = "Processing timeout - document may be too complex";
    } else if (error instanceof DigitizationError) {
      errorMessage = error.message;
      if (error.statusCode === 403) {
        errorMessage = "Authentication failed - check API key";
      } else if (error.statusCode === 429) {
        errorMessage = "Rate limit exceeded (10 requests/minute) - please wait";
      } else if (error.statusCode >= 500) {
        errorMessage = "Sarvam server error - please try again later";
      }
    }

    return {
      success: false,
      error: errorMessage,
      fileName
    };
  }
}

module.exports = {
  digitizeDocument,
  DigitizationError,
  DigitizationTimeoutError
};
