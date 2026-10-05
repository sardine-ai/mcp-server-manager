# PowerShell installation script for MCP Server Manager

$ErrorActionPreference = "Stop"

Write-Host "Installing MCP Server Manager..." -ForegroundColor Green

# Check if Node.js is installed
try {
    $nodeVersion = node -v
    Write-Host "Found Node.js: $nodeVersion" -ForegroundColor Cyan
} catch {
    Write-Host "Error: Node.js is not installed." -ForegroundColor Red
    Write-Host "Please install Node.js >= 18.0.0 from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check Node.js version
$nodeMajorVersion = [int](node -v).Substring(1).Split('.')[0]
if ($nodeMajorVersion -lt 18) {
    Write-Host "Error: Node.js version must be >= 18.0.0" -ForegroundColor Red
    Write-Host "Current version: $nodeVersion" -ForegroundColor Yellow
    exit 1
}

# Check if npm is installed
try {
    $npmVersion = npm -v
    Write-Host "Found npm: $npmVersion" -ForegroundColor Cyan
} catch {
    Write-Host "Error: npm is not installed." -ForegroundColor Red
    exit 1
}

# Install globally
Write-Host "Installing via npm..." -ForegroundColor Yellow
npm install -g mcp-server-manager

# Verify installation
try {
    $mcpsmVersion = mcpsm --version 2>$null
    if ($LASTEXITCODE -eq 0 -or $mcpsmVersion) {
        Write-Host "✓ MCP Server Manager installed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Run 'mcpsm' to start the TUI or 'mcpsm --help' for CLI commands."
        Write-Host "Documentation: https://sardine-ai.github.io/mcp-server-manager/docs/"
    } else {
        throw "Command not found"
    }
} catch {
    Write-Host "Error: Installation completed but 'mcpsm' command not found." -ForegroundColor Red
    Write-Host "Please check your PATH and ensure npm global bin directory is included." -ForegroundColor Yellow
    exit 1
}





