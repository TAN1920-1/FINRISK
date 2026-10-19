# Startup script for TILT Dashboard (Windows / PowerShell)
# Starts the FastAPI backend and the Vite frontend dev server.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BackendDir = Join-Path $ScriptDir "backend"
$FrontendDir = Join-Path $ScriptDir "frontend"

Write-Host "Starting TILT Dashboard..."

# --- Backend ---
if (-not (Test-Path (Join-Path $BackendDir "venv"))) {
    Write-Host "Creating Python virtual environment..."
    python -m venv (Join-Path $BackendDir "venv")
}

$Python = Join-Path $BackendDir "venv\Scripts\python.exe"
Write-Host "Installing Python dependencies..."
& $Python -m pip install --upgrade pip --quiet
& $Python -m pip install -r (Join-Path $BackendDir "requirements.txt") --quiet

Write-Host "Starting FastAPI backend on http://127.0.0.1:8000..."
Start-Process -FilePath $Python `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000", "--reload" `
    -WorkingDirectory $BackendDir

# --- Frontend ---
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "Installing Node.js dependencies..."
    Push-Location $FrontendDir
    npm install
    Pop-Location
}

Write-Host "Starting React frontend on http://localhost:3000..."
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $FrontendDir

Write-Host ""
Write-Host "TILT Dashboard is starting up."
Write-Host "   Frontend: http://localhost:3000"
Write-Host "   Backend:  http://127.0.0.1:8000"
Write-Host "   API Docs: http://127.0.0.1:8000/docs"
Write-Host ""
Write-Host "Each server runs in its own window. Close those windows to stop them."
