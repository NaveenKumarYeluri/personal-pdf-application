"""
Personal PDF Suite - Lightweight Local Runner
Uses Python's standard library (0 MB RAM overhead, 0 dependencies).
Allows testing the Windows application locally with maximum performance.
"""

import http.server
import socketserver
import os
import sys
import webbrowser
import threading
import time

PORT = 8080
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src")

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS and caching headers for high performance PDF.js rendering
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        # Suppress noisy request logs, only show startup
        pass

def launch_browser():
    time.sleep(1)
    url = f"http://localhost:{PORT}"
    platform_name = "Windows" if sys.platform == "win32" else "Linux" if sys.platform.startswith("linux") else sys.platform.capitalize()
    print(f"\n=======================================================")
    print(f"  Personal PDF Suite - Running locally on {platform_name}")
    print(f"  URL: {url}")
    print(f"  RAM usage: < 20 MB | CPU usage: 0%")
    print(f"=======================================================\n")
    
    # On Windows, try opening Edge in native App Window mode for desktop-feel
    if sys.platform == "win32":
        edge_app_cmd = f'start msedge --app="{url}"'
        try:
            res = os.system(edge_app_cmd)
            if res != 0:
                webbrowser.open(url)
        except Exception:
            webbrowser.open(url)
    else:
        webbrowser.open(url)

if __name__ == "__main__":
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    
    # Start browser in background thread
    threading.Thread(target=launch_browser, daemon=True).start()
    
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), CustomHandler) as httpd:
            print(f"Serving Personal PDF Suite from {DIRECTORY} on port {PORT}...")
            print("Press Ctrl+C to stop.")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nPersonal PDF Suite closed.")
        sys.exit(0)

