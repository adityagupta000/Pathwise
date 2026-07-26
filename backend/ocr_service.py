"""
PathWise OCR Service — OPTIMIZED FOR SPEED
FastAPI + EasyOCR with performance optimizations

Key optimizations:
1. Reduced image preprocessing
2. Batch size optimization
3. Disabled unnecessary features
4. Faster OCR parameters
"""

import io
import time
import logging
import traceback
from typing import Optional
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [OCR] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ocr")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MAX_FILE_SIZE = 25 * 1024 * 1024   # 25 MB
MAX_PAGES = 100
SUPPORTED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "webp"}

# ---------------------------------------------------------------------------
# EasyOCR — OPTIMIZED SETTINGS
# ---------------------------------------------------------------------------
log.info("Initializing EasyOCR reader with optimized settings...")
import easyocr  # noqa: E402

_ocr_reader: Optional[easyocr.Reader] = None


def get_reader() -> easyocr.Reader:
    """Lazy-initialize EasyOCR reader with SPEED optimizations."""
    global _ocr_reader
    if _ocr_reader is None:
        log.info("Creating OPTIMIZED EasyOCR Reader")
        _ocr_reader = easyocr.Reader(
            ["en"],
            gpu=False,  # Set to True if you have GPU
            model_storage_directory=".easyocr",
            download_enabled=True,
            verbose=False,
            quantize=True,  # ⚡ Enable model quantization for speed
            cudnn_benchmark=False  # Disable for CPU
        )
        log.info("EasyOCR reader ready (optimized)")
    return _ocr_reader


# Pre-warm
get_reader()

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="PathWise OCR Service (Optimized)", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# MINIMAL preprocessing — MUCH FASTER
# ---------------------------------------------------------------------------
def preprocess_image_fast(pil_img: Image.Image) -> np.ndarray:
    """
    Minimal preprocessing for SPEED.
    Only essential operations: RGB conversion and resize if needed.
    """
    # Ensure RGB
    if pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")

    # Resize if image is very large (speeds up OCR significantly)
    max_dimension = 2000
    width, height = pil_img.size
    if width > max_dimension or height > max_dimension:
        ratio = min(max_dimension / width, max_dimension / height)
        new_size = (int(width * ratio), int(height * ratio))
        pil_img = pil_img.resize(new_size, Image.Resampling.LANCZOS)
        log.info(f"Resized image from {width}x{height} to {new_size[0]}x{new_size[1]}")

    # Convert to numpy array
    img_array = np.array(pil_img)

    return img_array


# ---------------------------------------------------------------------------
# FAST OCR on single image
# ---------------------------------------------------------------------------
def ocr_image_fast(pil_img: Image.Image) -> tuple[str, float]:
    """
    Run EasyOCR with SPEED optimizations.
    """
    img_array = preprocess_image_fast(pil_img)
    reader = get_reader()

    # OPTIMIZED EasyOCR parameters for SPEED
    results = reader.readtext(
        img_array,
        detail=1,
        paragraph=True,  # ⚡ Faster than False
        batch_size=10,   # ⚡ Process multiple text regions at once
        workers=4,       # ⚡ Use multiple CPU cores
        decoder='greedy',  # ⚡ Fastest decoder (vs 'beamsearch')
        beamWidth=5,     # Lower = faster
        contrast_ths=0.1,  # Lower threshold = faster
        adjust_contrast=0.5,  # Minimal contrast adjustment
        text_threshold=0.7,  # Higher = fewer false positives
        low_text=0.4,
        link_threshold=0.4,
        canvas_size=2560,  # Lower = faster
        mag_ratio=1.0     # No magnification = faster
    )

    if not results:
        return "", 0.0

    lines: list[str] = []
    confidences: list[float] = []

    for bbox, text, conf in results:
        text = text.strip()
        if text:
            lines.append(text)
            confidences.append(conf)

    extracted = " ".join(lines)
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    return extracted, avg_confidence


# ---------------------------------------------------------------------------
# PDF → FAST processing
# ---------------------------------------------------------------------------
def process_pdf_fast(file_bytes: bytes) -> dict:
    """
    Convert PDF pages to images and run FAST OCR.
    """
    import fitz  # PyMuPDF

    log.info("PDF detected — opening with PyMuPDF")

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Corrupted PDF: {exc}")

    page_count = len(doc)
    log.info(f"PDF has {page_count} page(s)")

    if page_count > MAX_PAGES:
        raise HTTPException(
            status_code=400,
            detail=f"PDF has {page_count} pages — maximum is {MAX_PAGES}."
        )

    if page_count == 0:
        raise HTTPException(status_code=400, detail="PDF has no pages.")

    page_texts: list[str] = []
    all_confidences: list[float] = []

    for i, page in enumerate(doc):
        log.info(f"Processing page {i + 1}/{page_count}")

        # Render at NORMAL resolution (1.5x instead of 2x for speed)
        mat = fitz.Matrix(1.5, 1.5)
        pix = page.get_pixmap(matrix=mat)

        img_bytes = pix.tobytes("png")
        pil_img = Image.open(io.BytesIO(img_bytes))

        # FAST OCR
        text, conf = ocr_image_fast(pil_img)

        page_texts.append(f"===== PAGE {i + 1} =====\n{text}")
        if conf > 0:
            all_confidences.append(conf)

    doc.close()

    full_text = "\n\n".join(page_texts)
    avg_conf = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0

    return {
        "text": full_text,
        "pages": page_count,
        "confidence": round(avg_conf, 4),
    }


# ---------------------------------------------------------------------------
# Image → FAST OCR
# ---------------------------------------------------------------------------
def process_image_fast(file_bytes: bytes, filename: str) -> dict:
    """Process image with FAST OCR."""
    log.info(f"Image detected — {filename}")

    try:
        pil_img = Image.open(io.BytesIO(file_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {exc}")

    # Convert to RGB
    if pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")

    log.info(f"Image size: {pil_img.size[0]}x{pil_img.size[1]}")

    # FAST OCR
    text, conf = ocr_image_fast(pil_img)

    return {
        "text": text,
        "pages": 1,
        "confidence": round(conf, 4),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "service": "PathWise OCR (Optimized)",
        "engine": "EasyOCR",
        "optimizations": ["quantize", "batch_size=10", "greedy_decoder", "resize"]
    }


@app.post("/ocr")
async def ocr_endpoint(file: UploadFile = File(...)):
    """
    OPTIMIZED OCR endpoint with speed improvements.
    Target: 1-3 seconds per image (vs 90 seconds before).
    """
    start_time = time.time()

    # Validate
    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported: '.{ext}'. Use: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    # Read file
    try:
        file_bytes = await file.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read: {exc}")

    file_size = len(file_bytes)
    log.info(f"Received '{filename}' ({file_size / 1024:.1f} KB)")

    # Validate size
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({file_size / (1024 * 1024):.1f} MB). Max: 25MB"
        )

    if file_size == 0:
        raise HTTPException(status_code=400, detail="Empty file.")

    # Process with OPTIMIZED functions
    try:
        if ext == "pdf":
            result = process_pdf_fast(file_bytes)
        else:
            result = process_image_fast(file_bytes, filename)
    except HTTPException:
        raise
    except Exception as exc:
        log.error(f"OCR failed: {exc}")
        log.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}")

    extracted_text = result["text"]
    char_count = len(extracted_text)

    # Handle no text
    if not extracted_text.strip() or char_count < 5:
        elapsed = time.time() - start_time
        log.warning(f"No text detected in '{filename}' ({elapsed:.1f}s)")
        return JSONResponse(
            content={
                "success": False,
                "text": "",
                "pages": result["pages"],
                "characters": 0,
                "error": "No text detected",
            },
            status_code=200
        )

    elapsed = time.time() - start_time
    log.info(f"✓ {char_count} chars from {result['pages']} page(s) in {elapsed:.1f}s")

    return JSONResponse(content={
        "success": True,
        "text": extracted_text,
        "pages": result["pages"],
        "characters": char_count,
        "confidence": result.get("confidence", 0),
        "processing_time": round(elapsed, 2)
    })


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    log.info("Starting OPTIMIZED PathWise OCR Service on http://localhost:8000")
    log.info("Expected speed: 1-3 seconds per image (down from 90 seconds)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
