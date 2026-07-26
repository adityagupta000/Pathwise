@echo off
echo Starting PathWise OCR Service...
echo.

REM Check if virtual environment exists
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
    echo.
)

REM Activate virtual environment
call venv\Scripts\activate

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt
echo.

REM Start the OCR service
echo Starting FastAPI server on http://localhost:8000
echo Press Ctrl+C to stop
echo.
python ocr_service.py
