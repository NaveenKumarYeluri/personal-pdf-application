#!/usr/bin/env python3
"""Headless smoke test for Personal PDF Suite using the installed Edge browser."""
import argparse
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test-output"
OUT.mkdir(exist_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8080/")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    logs = []
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=not args.headed)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: logs.append((m.type, m.text)))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "01-home.png"), full_page=True)

        print("TITLE:", page.title())
        print("WELCOME VISIBLE:", page.locator("#welcome-screen").is_visible())

        # Load the built-in sample PDF
        page.click("#btn-load-sample")
        page.wait_for_timeout(4000)
        page.screenshot(path=str(OUT / "02-sample.png"), full_page=True)

        info = page.evaluate(
            """() => ({
                pages: document.querySelectorAll('.page-wrapper').length,
                canvases: document.querySelectorAll('.page-wrapper canvas').length,
                pageCount: (document.getElementById('page-count')||{}).textContent,
                status: (document.getElementById('status-text')||{}).textContent,
                title: (document.getElementById('current-doc-name')||{}).textContent,
                bodyClass: document.body.className,
            })"""
        )
        print("DOC INFO:", json.dumps(info, indent=2))

        print("\n--- CONSOLE (last 80) ---")
        for t, msg in logs[-80:]:
            print(f"[{t}] {msg}")
        print("\n--- PAGE ERRORS ---")
        for e in errors:
            print(e)

        browser.close()

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
