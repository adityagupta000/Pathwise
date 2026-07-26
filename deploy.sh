#!/bin/bash

echo "================================"
echo "PathWise Deployment Script"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Run this from the project root."
    exit 1
fi

echo "📦 Step 1: Installing dependencies..."
npm install

echo ""
echo "🔨 Step 2: Building Next.js application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Fix errors above before deploying."
    exit 1
fi

echo ""
echo "✅ Build successful!"
echo ""
echo "Choose deployment option:"
echo "1) Vercel (Recommended - Frontend only)"
echo "2) Deploy both Frontend + Backend"
echo "3) Backend only (Railway)"
echo "4) Test locally"
read -p "Enter choice (1-4): " choice

case $choice in
    1)
        echo ""
        echo "🚀 Deploying to Vercel..."
        if ! command -v vercel &> /dev/null; then
            echo "Installing Vercel CLI..."
            npm i -g vercel
        fi
        vercel --prod
        ;;
    2)
        echo ""
        echo "📋 Deploy backend first:"
        echo "1. Go to https://railway.app"
        echo "2. Click 'New Project' → 'Deploy from GitHub'"
        echo "3. Select this repo"
        echo "4. Copy the backend URL"
        echo ""
        read -p "Enter backend URL: " BACKEND_URL
        export OCR_SERVICE_URL=$BACKEND_URL
        echo ""
        echo "🚀 Deploying frontend to Vercel..."
        vercel --prod
        ;;
    3)
        echo ""
        echo "🐳 Building backend Docker image..."
        cd backend
        docker build -t pathwise-backend .
        echo "✅ Backend image built!"
        echo ""
        echo "To deploy to Railway:"
        echo "railway login"
        echo "railway up"
        ;;
    4)
        echo ""
        echo "🧪 Starting local servers..."
        echo "Backend: http://localhost:8000"
        echo "Frontend: http://localhost:3000"
        echo ""

        # Start backend in background
        cd backend
        python ocr_service.py &
        BACKEND_PID=$!
        cd ..

        # Wait for backend to start
        sleep 3

        # Start frontend
        npm start

        # Cleanup on exit
        kill $BACKEND_PID
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "✅ Done!"
