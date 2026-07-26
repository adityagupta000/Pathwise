# PathWise OCR Service

Local OCR extraction service using FastAPI + EasyOCR.

## Architecture

```
Upload PDF/Image
    ↓
FastAPI OCR Service (EasyOCR)
    ↓
Extract Plain Text
    ↓
Send Text to Sarvam Chat Completion API
    ↓
Structured JSON Extraction
    ↓
Dependency Engine (unchanged)
    ↓
Priority Engine (unchanged)
    ↓
Workflow Generation (unchanged)
```

## Features

- **PDF Support**: Multi-page PDF extraction using PyMuPDF
- **Image Support**: PNG, JPG, JPEG, WEBP
- **Preprocessing**: Auto-contrast, noise reduction, grayscale conversion
- **Quality OCR**: EasyOCR with English language support
- **Fast**: Singleton reader pattern (initialized once)
- **Robust**: Comprehensive error handling

## Installation

### 1. Create Virtual Environment (Optional but Recommended)

```bash
cd backend
python -m venv venv
```

### 2. Activate Virtual Environment

**Windows:**
```bash
venv\Scripts\activate
```

**Linux/Mac:**
```bash
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

**Note**: First installation may take 5-10 minutes as it downloads:
- EasyOCR models (~100MB)
- PyTorch (~1GB)
- Other dependencies

## Usage

### Start the Service

**Windows (Recommended):**
```bash
start_ocr.bat
```

**Manual Start:**
```bash
python ocr_service.py
```

The service will start on `http://localhost:8000`

### Health Check

```bash
curl http://localhost:8000/health
```

Response:
```json
{
  "status": "ok",
  "service": "PathWise OCR",
  "engine": "EasyOCR"
}
```

### OCR Endpoint

**POST** `/ocr`

**Request:**
```bash
curl -X POST http://localhost:8000/ocr \
  -F "file=@document.pdf"
```

**Response (Success):**
```json
{
  "success": true,
  "text": "Extracted text content...",
  "pages": 3,
  "characters": 5243,
  "confidence": 0.92
}
```

**Response (No Text):**
```json
{
  "success": false,
  "text": "",
  "pages": 1,
  "characters": 0,
  "error": "No text could be detected in the uploaded file."
}
```

## Supported Formats

| Format | Extension | Max Size | Max Pages |
|--------|-----------|----------|-----------|
| PDF    | `.pdf`    | 25 MB    | 100       |
| PNG    | `.png`    | 25 MB    | N/A       |
| JPEG   | `.jpg`, `.jpeg` | 25 MB | N/A      |
| WebP   | `.webp`   | 25 MB    | N/A       |

## How It Works

### PDF Processing

1. Open PDF with PyMuPDF (fitz)
2. Convert each page to high-res image (2x zoom)
3. Run EasyOCR on each page
4. Merge pages with separators:
   ```
   ===== PAGE 1 =====
   [text from page 1]
   
   ===== PAGE 2 =====
   [text from page 2]
   ```

### Image Processing

1. Open image with Pillow
2. Convert to RGB (handles all formats)
3. Preprocess:
   - Enhance contrast
   - Convert to grayscale
   - Apply CLAHE (adaptive histogram equalization)
   - Apply bilateral filter (noise reduction)
4. Run EasyOCR
5. Return extracted text

### Preprocessing Pipeline

```
Original Image
    ↓
Convert to RGB
    ↓
Contrast Enhancement (1.3x)
    ↓
Grayscale Conversion
    ↓
CLAHE (Adaptive Histogram)
    ↓
Bilateral Filter (Denoise)
    ↓
EasyOCR Extraction
```

## Configuration

### Environment Variables

None required - service is self-contained.

### File Limits

Edit in `ocr_service.py`:

```python
MAX_FILE_SIZE = 25 * 1024 * 1024   # 25 MB
MAX_PAGES = 100                     # PDF page limit
```

### EasyOCR Settings

```python
reader = easyocr.Reader(
    ["en"],                          # Languages
    gpu=False,                       # Use CPU (change to True for GPU)
    model_storage_directory=".easyocr",
    download_enabled=True,
    verbose=False
)
```

## Error Handling

| Error | HTTP Code | Cause |
|-------|-----------|-------|
| Unsupported file type | 400 | Wrong extension |
| File too large | 400 | Exceeds 25MB |
| Empty file | 400 | 0 bytes |
| Corrupted PDF | 400 | Cannot open |
| Too many pages | 400 | Exceeds 100 pages |
| Processing failed | 500 | Internal error |

## Logging

Service logs all operations:

```
[OCR] Received 'document.pdf' (2.3 MB)
[OCR] PDF detected — opening with PyMuPDF
[OCR] PDF has 3 page(s)
[OCR] Converting page 1/3 to image
[OCR] Running EasyOCR on page 1
[OCR] Converting page 2/3 to image
[OCR] Running EasyOCR on page 2
[OCR] Converting page 3/3 to image
[OCR] Running EasyOCR on page 3
[OCR] Extracted 5243 characters from 3 page(s) in 12.5s
```

## Performance

### First Request
- **Cold start**: 5-10 seconds (model loading)
- **Subsequent requests**: 1-5 seconds per page

### Typical Processing Times
- **Single image**: 1-3 seconds
- **PDF (1 page)**: 2-4 seconds
- **PDF (10 pages)**: 15-30 seconds
- **PDF (100 pages)**: 2-5 minutes

### Memory Usage
- **Idle**: ~500 MB (models loaded)
- **Processing**: +200-500 MB per request

## Troubleshooting

### Service Won't Start

**Problem**: `ModuleNotFoundError: No module named 'easyocr'`

**Solution**: Install dependencies
```bash
pip install -r requirements.txt
```

### Slow First Request

**Problem**: First OCR request takes 10+ seconds

**Solution**: This is normal - EasyOCR is loading models into memory. Subsequent requests will be fast.

### No Text Detected

**Problem**: `"No text could be detected"`

**Causes**:
- Image is blank or very low quality
- Text is too small or blurry
- Handwritten text (not supported)
- Non-English text (change language in code)

**Solutions**:
- Use higher resolution images
- Ensure text is clear and readable
- Check image orientation

### Out of Memory

**Problem**: Process crashes during large PDF

**Solution**: Reduce `MAX_PAGES` or process fewer pages at once

### Port Already in Use

**Problem**: `Address already in use: 8000`

**Solution**: Kill existing process or change port:
```python
uvicorn.run(app, host="0.0.0.0", port=8001)
```

## Integration with PathWise

The OCR service integrates seamlessly with PathWise:

1. **Frontend**: User uploads PDF/image
2. **Next.js API**: Receives upload, forwards to OCR service
3. **OCR Service**: Extracts text, returns plain text
4. **Next.js API**: Sends text to Sarvam Chat API
5. **Sarvam**: Returns structured JSON
6. **PathWise Engines**: Process as before (unchanged)

**No changes required to:**
- Dependency engine
- Priority engine
- Workflow generation
- Timeline generation
- UI components

## Development

### Running in Development

```bash
uvicorn ocr_service:app --reload
```

### Testing

```python
# Test health endpoint
import requests
r = requests.get("http://localhost:8000/health")
print(r.json())

# Test OCR
with open("test.pdf", "rb") as f:
    r = requests.post(
        "http://localhost:8000/ocr",
        files={"file": f}
    )
print(r.json())
```

### Adding More Languages

```python
reader = easyocr.Reader(
    ["en", "hi"],  # English + Hindi
    gpu=False
)
```

Supported languages: https://www.jaided.ai/easyocr/

## Production Deployment

### Recommendations

1. **Use GPU**: Change `gpu=True` for 3-5x speedup
2. **Add Rate Limiting**: Prevent abuse
3. **Add Authentication**: Secure the endpoint
4. **Use Redis**: Cache results for duplicate uploads
5. **Horizontal Scaling**: Run multiple instances behind load balancer
6. **Monitor Memory**: Set up alerts for high memory usage

### Docker Deployment

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY ocr_service.py .
EXPOSE 8000

CMD ["python", "ocr_service.py"]
```

### Environment Setup

```bash
docker build -t pathwise-ocr .
docker run -p 8000:8000 pathwise-ocr
```

## License

Part of the PathWise project.
