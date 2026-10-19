# Startup script for FinRisk AI (Windows / PowerShell)
# Starts the FastAPI backend and the Vite frontend dev server.
#
# Prefer reading README.md first: it documents the manual commands and the
# environment variables.  This script is a convenience wrapper around them.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BackendDir = Join-Path $ScriptDir "backend"
$FrontendDir = Join-Path $ScriptDir "frontend"

Write-Host "Starting FinRisk AI..."

# --- Backend ---
if (-not (Test-Path (Join-Path $BackendDir "venv"))) {
    Write-Host "Creating Python virtual environment..."
    python -m venv (Join-Path $BackendDir "venv")
}

$Python = Join-Path $BackendDir "venv\Scripts\python.exe"
Write-Host "Installing Python dependencies..."
& $Python -m pip install --upgrade pip --quiet
& $Python -m pip install -r (Join-Path $BackendDir "requirements.txt") --quiet

# Migrations run automatically on startup (see the app lifespan handler).
Write-Host "Starting FastAPI backend on http://127.0.0.1:8000..."
Start-Process -FilePath $Python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload" `
    -WorkingDirectory $BackendDir

# --- Frontend ---
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "Installing Node.js dependencies..."
    Push-Location $FrontendDir
    npm install
    Pop-Location
}

Write-Host "Starting React frontend on http://localhost:5173..."
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $FrontendDir

Write-Host ""
Write-Host "FinRisk AI is starting up."
Write-Host "   Frontend: http://localhost:5173"
Write-Host "   Backend:  http://127.0.0.1:8000"
Write-Host "   API Docs: http://127.0.0.1:8000/docs"
Write-Host ""
Write-Host "Open the frontend and create the first account; it becomes the administrator."
Write-Host "Each server runs in its own window. Close those windows to stop them."
