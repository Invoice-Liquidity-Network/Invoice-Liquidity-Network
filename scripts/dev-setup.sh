#!/usr/bin/env bash
set -e
echo "Setting up local development environment..."

# 0. Check Node.js version (>= 18)
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js version 18 or higher."
  exit 1
else
  NODE_VER=$(node -v | sed 's/^v//')
  NODE_MAJOR=${NODE_VER%%.*}
  if (( NODE_MAJOR < 18 )); then
    echo "❌ Detected Node.js version $NODE_VER which is less than required 18. Please upgrade Node.js."
    exit 1
  else
    echo "✅ Node.js version $NODE_VER meets requirement."
  fi
fi

# 1. Check/Install Rust (>= 1.74)
if ! command -v rustc &> /dev/null; then
  echo "Rust not found. Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  RUST_VER=$(rustc --version | awk '{print $2}')
  # Extract major and minor
  RUST_MAJOR=$(echo $RUST_VER | cut -d. -f1)
  RUST_MINOR=$(echo $RUST_VER | cut -d. -f2)
  if (( RUST_MAJOR < 1 )) || (( RUST_MAJOR == 1 && RUST_MINOR < 74 )); then
    echo "❌ Detected Rust version $RUST_VER which is less than required 1.74. Please upgrade Rust."
    exit 1
  else
    echo "✅ Rust version $RUST_VER meets requirement."
  fi
fi
# Duplicate Rust check removed
# 2. Add proper WASM target
echo "Adding wasm32-unknown-unknown target..."
rustup target add wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown --toolchain stable
# Wait for a moment to ensure cargo is accessible
export PATH="$HOME/.cargo/bin:$PATH"
# 3. Check/Install Stellar CLI
if ! command -v stellar &> /dev/null; then
    echo "Stellar CLI not found. Installing via cargo..."
    cargo install --locked stellar-cli --features opt
else
    echo "Stellar CLI is already installed."
fi
# 4. Check Docker is installed and running
if ! command -v docker &>/dev/null; then
  echo "❌ Docker is not installed. Please install Docker."
  exit 1
else
  if ! docker info &>/dev/null; then
    echo "❌ Docker daemon is not running. Please start Docker."
    exit 1
  else
    echo "✅ Docker is installed and running."
  fi
fi

echo "Setup complete! You can now run 'make build'"
