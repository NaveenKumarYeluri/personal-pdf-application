#!/usr/bin/env bash
# Personal PDF Suite - Linux Local Runner (Zero-RAM Mode)
set -e

echo "======================================================="
echo " Starting Personal PDF Suite on Linux"
echo " Minimal RAM mode enabled (< 30 MB RAM)"
echo "======================================================="

if command -v python3 &>/dev/null; then
    python3 serve.py
elif command -v python &>/dev/null; then
    python serve.py
else
    echo "Error: Python 3 is required to run the local server."
    exit 1
fi
