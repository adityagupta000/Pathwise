# Quick Start Guide

Get PathWise running locally in 5 minutes.

## Prerequisites

- Node.js 18+ installed
- Sarvam AI API key ([Get one here](https://dashboard.sarvam.ai/key-management))

## Installation

### 1. Clone and Install

```bash
cd sarvam.ai
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your Sarvam API key:

```env
SARVAM_API_KEY=your_actual_api_key_here
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## First Analysis

### 1. Upload Documents

Click **"Upload Documents"** and select:

- PDFs (digital or scanned)
- Images (PNG, JPG, JPEG, WEBP)
- Text files

**Tip:** Start with 2-3 documents to see dependency detection in action.

### 2. Select Document Language

Choose the language your documents are written in (helps OCR accuracy for scanned documents).

### 3. Analyze

Click **"Analyze Documents"** and wait 10-30 seconds while PathWise:

- Extracts text from documents
- Identifies actions and deadlines
- Detects dependencies
- Prioritizes your workflow

### 4. Review Action Plan

PathWise displays:

- **Priority order** - What to do first
- **Status indicators** - Ready, Blocked, or Urgent
- **Dependencies** - What needs to be completed before each action
- **Deadlines** - Time remaining for each task

### 5. Translate (Optional)

Click **"Read this plan in your language"** and select from 22+ Indian languages.

## What's Next?

- Read [How It Works](HOW_IT_WORKS.md) to understand the processing pipeline
- Check [Configuration](CONFIGURATION.md) for advanced settings
- See [Document Types](DOCUMENT_TYPES.md) for supported formats
- Review [Troubleshooting](TROUBLESHOOTING.md) if you encounter issues

## Example Use Cases

### Government Documents

Upload multiple notices (Aadhaar update, bank KYC, passport renewal) and PathWise identifies which must be completed first.

### Legal Documents

Process contracts, agreements, and correspondence to identify action items and deadlines.

### Medical Records

Organize prescriptions, test reports, and appointment letters into a clear action plan.

### Business Documents

Analyze invoices, contracts, and compliance documents to prioritize tasks.

## Need Help?

- Check [FAQ](FAQ.md) for common questions
- Review [Common Issues](TROUBLESHOOTING.md) for error solutions
- Consult [API Reference](API_REFERENCE.md) for integration details
