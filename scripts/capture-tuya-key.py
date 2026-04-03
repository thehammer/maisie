"""
mitmproxy script to capture Tuya local keys from Gemstone app traffic.
Run with: mitmdump -s scripts/capture-tuya-key.py -p 8888

Then configure your phone to use this Mac as HTTP proxy on port 8888.
"""
import json
import re

def response(flow):
    # Look for Tuya API responses containing device info / local keys
    url = flow.request.pretty_url

    # Tuya cloud API patterns that return device info with local keys
    tuya_patterns = [
        "tuya",
        "gw.tuyaus.com",
        "gw.tuyaeu.com",
        "gw.tuyacn.com",
        "a1.tuyaus.com",
        "a1.tuyaeu.com",
        "openapi.tuyaus.com",
        "openapi.tuyaeu.com",
        "px1.tuyaus.com",
        "px1.tuyaeu.com",
    ]

    is_tuya = any(p in url.lower() for p in tuya_patterns)

    if is_tuya:
        content_type = flow.response.headers.get("content-type", "")
        body = flow.response.get_text()

        print(f"\n{'='*60}")
        print(f"TUYA REQUEST: {flow.request.method} {url}")
        print(f"Content-Type: {content_type}")

        # Try to parse as JSON
        try:
            data = json.loads(body)
            pretty = json.dumps(data, indent=2)

            # Look for local key patterns
            if "localKey" in pretty or "local_key" in pretty or "localkey" in pretty:
                print(f"\n*** FOUND LOCAL KEY ***")
                print(pretty[:5000])

                # Save to file
                with open("tuya-keys-found.json", "a") as f:
                    f.write(json.dumps({
                        "url": url,
                        "data": data,
                    }, indent=2))
                    f.write("\n---\n")
                print(f"*** Saved to tuya-keys-found.json ***")
            else:
                # Still log all Tuya responses for debugging
                print(f"Response ({len(body)} bytes):")
                print(pretty[:2000])

        except (json.JSONDecodeError, UnicodeDecodeError):
            print(f"Response ({len(body)} bytes, non-JSON)")
            if len(body) < 500:
                print(body[:500])
