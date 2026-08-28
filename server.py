#!/usr/bin/env python3
import io
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "vendor"))
import qrcode
from qrcode.image.svg import SvgPathImage

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/qr":
            data = parse_qs(parsed.query).get("data", [""])[0]
            if not data:
                self.send_error(400, "Missing data")
                return
            # ZATCA QR codes require a clear quiet zone. Four modules matches the
            # spacing in the supplied multi-product PDF and keeps rows away from it.
            qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=4)
            qr.add_data(data)
            qr.make(fit=True)
            img = qr.make_image(image_factory=SvgPathImage)
            buf = io.BytesIO()
            img.save(buf)
            payload = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        return super().do_GET()

if __name__ == "__main__":
    port = 8000
    print(f"\nInvoice / Receipt generator running at: http://127.0.0.1:{port}\n")
    try:
        ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
