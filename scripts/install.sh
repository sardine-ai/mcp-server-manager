#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Installing MCP Server Manager...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    echo "Please install Node.js >= 18.0.0 from https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js version must be >= 18.0.0${NC}"
    echo "Current version: $(node -v)"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed.${NC}"
    exit 1
fi

# Install globally
echo -e "${YELLOW}Installing via npm...${NC}"
npm install -g mcp-server-manager

# Verify installation
if command -v mcpsm &> /dev/null; then
    VERSION=$(mcpsm --version 2>/dev/null || echo "installed")
    echo -e "${GREEN}✓ MCP Server Manager installed successfully!${NC}"
    echo ""
    echo "Run 'mcpsm' to start the TUI or 'mcpsm --help' for CLI commands."
    echo "Documentation: https://sardine-ai.github.io/mcp-server-manager/docs/"
else
    echo -e "${RED}Error: Installation completed but 'mcpsm' command not found.${NC}"
    echo "Please check your PATH and ensure npm global bin directory is included."
    exit 1
fi





