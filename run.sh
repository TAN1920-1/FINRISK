#!/bin/bash
# Startup script for FinRisk AI
# Starts the FastAPI backend and the Vite frontend dev servers.
#
# Prefer reading README.md first: it documents the manual commands and the
# environment variables.  This script is a convenience wrapper around them.

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo "Starting FinRisk AI..."

# Check if Python venv exists, create if not
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$BACKEND_DIR/venv"
fi

# Activate venv and install requirements
echo "Installing Python dependencies..."
cd "$BACKEND_DIR"
# shellcheck source=/dev/null
source venv/bin/activate
pip install --upgrade pip > /dev/null 2>&1
pip install -q -r requirements.txt

# Migrations run automatically on startup (see the app lifespan handler).
echo "Starting FastAPI backend on http://127.0.0.1:8000..."
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload > /tmp/finrisk-backend.log 2>&1 &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Check if node_modules exists, install if not
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "Installing Node.js dependencies..."
    cd "$FRONTEND_DIR"
    npm install
fi

# Start React dev server
echo "Starting React frontend on http://localhost:5173..."
cd "$FRONTEND_DIR"
npm run dev > /tmp/finrisk-frontend.log 2>&1 &
FRONTEND_PID=$!

echo ""
echo "FinRisk AI is running."
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://127.0.0.1:8000"
echo "   API Docs: http://127.0.0.1:8000/docs"
echo ""
echo "Open the frontend and create the first account; it becomes the administrator."
echo ""
echo "Logs:"
echo "   Backend:  tail -f /tmp/finrisk-backend.log"
echo "   Frontend: tail -f /tmp/finrisk-frontend.log"
echo ""

# Wait for user interrupt
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
