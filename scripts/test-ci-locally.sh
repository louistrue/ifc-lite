#!/usr/bin/env bash
# File: scripts/test-ci-locally.sh
# Local CI test script for ifc-lite

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Testing CI Workflow Locally ===${NC}\n"

# Run cargo fmt check
echo -e "${YELLOW}Step 1: Running cargo fmt check...${NC}"
if cargo fmt --all -- --check; then
    echo -e "${GREEN}✓ cargo fmt passed${NC}\n"
else
    echo -e "${RED}✗ cargo fmt failed${NC}"
    echo -e "${YELLOW}Run 'cargo fmt --all' to fix formatting issues${NC}\n"
    exit 1
fi

# Run clippy
echo -e "${YELLOW}Step 2: Running clippy...${NC}"
if cargo clippy --workspace --all-targets -- -D warnings; then
    echo -e "${GREEN}✓ clippy passed${NC}\n"
else
    echo -e "${RED}✗ clippy failed${NC}\n"
    exit 1
fi

# Run cargo build (native)
echo -e "${YELLOW}Step 3: Running cargo build (native)...${NC}"
if cargo build --workspace; then
    echo -e "${GREEN}✓ build passed${NC}\n"
else
    echo -e "${RED}✗ build failed${NC}\n"
    exit 1
fi

# Run cargo doc
echo -e "${YELLOW}Step 4: Running cargo doc...${NC}"
if RUSTDOCFLAGS="-D warnings" cargo doc --workspace --document-private-items --no-deps; then
    echo -e "${GREEN}✓ doc generation passed${NC}\n"
else
    echo -e "${RED}✗ doc generation failed${NC}\n"
    exit 1
fi

# Additional checks
echo -e "${YELLOW}Step 5: Running additional checks...${NC}"

# Check cargo-sort FIRST (it should run before taplo)
if command -v cargo-sort &> /dev/null; then
    echo "Running cargo-sort check..."
    if cargo-sort -cwg; then
        echo -e "${GREEN}✓ cargo-sort passed${NC}"
    else
        echo -e "${RED}✗ cargo-sort failed${NC}"
        echo -e "${YELLOW}Run 'cargo-sort -wg' to fix Cargo.toml sorting${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ cargo-sort not installed, skipping Cargo.toml sort check${NC}"
    echo -e "${YELLOW}Install with: cargo install cargo-sort${NC}"
fi

# Check taplo AFTER cargo-sort (taplo formats what cargo-sort organized)
if command -v taplo &> /dev/null; then
    echo "Running taplo format check..."
    if taplo format --check; then
        echo -e "${GREEN}✓ taplo passed${NC}"
    else
        echo -e "${RED}✗ taplo failed${NC}"
        echo -e "${YELLOW}Run 'taplo format' to fix TOML formatting${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ taplo not installed, skipping TOML format check${NC}"
    echo -e "${YELLOW}Install with: cargo install taplo-cli${NC}"
fi

# Check cargo-deny (skip if deny.toml doesn't exist)
if command -v cargo-deny &> /dev/null && [[ -f "deny.toml" ]]; then
    echo "Running cargo-deny check..."
    if cargo-deny check bans licenses sources --hide-inclusion-graph --show-stats; then
        echo -e "${GREEN}✓ cargo-deny passed${NC}"
    else
        echo -e "${RED}✗ cargo-deny failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ cargo-deny not installed or deny.toml missing, skipping dependency check${NC}"
fi

echo ""

# Run Rust tests (native)
echo -e "${YELLOW}Step 6: Running Rust tests (native targets)...${NC}"
if cargo test --workspace -- --test-threads=1; then
    echo -e "${GREEN}✓ native tests passed${NC}\n"
else
    echo -e "${RED}✗ native tests failed${NC}\n"
    exit 1
fi

# Build WASM targets (only if crates/ directory exists)
echo -e "${YELLOW}Step 7: Building WASM targets...${NC}"

# Check for wasm32 target
if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
    echo -e "${YELLOW}⚠ wasm32-unknown-unknown target not installed${NC}"
    echo -e "${YELLOW}Install with: rustup target add wasm32-unknown-unknown${NC}"
    exit 1
fi

# Build Yew viewer with trunk (if properly configured with index.html)
if [[ -f "crates/ifc-lite-viewer/index.html" ]] || [[ -f "crates/ifc-lite-viewer/Trunk.toml" ]]; then
    if command -v trunk &> /dev/null; then
        echo "Building ifc-lite-viewer WASM with Trunk..."
        if (cd crates/ifc-lite-viewer && trunk build --release); then
            echo -e "${GREEN}✓ ifc-lite-viewer WASM build passed${NC}"
        else
            echo -e "${RED}✗ ifc-lite-viewer WASM build failed${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}⚠ trunk not installed, skipping Yew WASM build${NC}"
        echo -e "${YELLOW}Install with: cargo install trunk${NC}"
    fi
else
    echo -e "${YELLOW}⚠ crates/ifc-lite-viewer not configured for Trunk, skipping Yew WASM build${NC}"
fi

# Build Bevy WASM (if crate exists with Cargo.toml)
if [[ -f "crates/ifc-lite-bevy/Cargo.toml" ]]; then
    echo "Building ifc-lite-bevy WASM..."
    if cargo build --release --target wasm32-unknown-unknown -p ifc-lite-bevy; then
        echo -e "${GREEN}✓ ifc-lite-bevy WASM build passed${NC}\n"
    else
        echo -e "${RED}✗ ifc-lite-bevy WASM build failed${NC}\n"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ crates/ifc-lite-bevy not found, skipping Bevy WASM build${NC}\n"
fi

# Build existing WASM bindings
if [[ -d "rust/wasm-bindings" ]]; then
    echo "Building ifc-lite-wasm..."
    if cargo build --release --target wasm32-unknown-unknown -p ifc-lite-wasm; then
        echo -e "${GREEN}✓ ifc-lite-wasm build passed${NC}\n"
    else
        echo -e "${RED}✗ ifc-lite-wasm build failed${NC}\n"
        exit 1
    fi
fi

# Check for uncommitted changes
echo -e "${YELLOW}Step 8: Checking for uncommitted changes...${NC}"
if [[ -n $(git status --porcelain 2>/dev/null || echo "") ]]; then
    echo -e "${YELLOW}⚠ You have uncommitted changes:${NC}"
    git status --short
    echo -e "${YELLOW}Consider committing or stashing changes before publishing${NC}\n"
else
    echo -e "${GREEN}✓ No uncommitted changes${NC}\n"
fi

# Check if on main branch
echo -e "${YELLOW}Step 9: Checking git branch...${NC}"
current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
if [[ "$current_branch" != "main" && "$current_branch" != "master" ]]; then
    echo -e "${YELLOW}⚠ You are on branch '$current_branch', not 'main'${NC}"
    echo -e "${YELLOW}Consider switching to main branch before publishing${NC}\n"
else
    echo -e "${GREEN}✓ On $current_branch branch${NC}\n"
fi

echo -e "\n${GREEN}=== All CI checks passed! ===${NC}"
echo -e "${GREEN}Your code is ready to be pushed.${NC}"
echo -e "\n${BLUE}To build and deploy:${NC}"
echo -e "  ${YELLOW}./scripts/build-wasm-split.sh deploy${NC}"
