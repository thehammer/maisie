#!/usr/bin/env bash
# Build Maisie Bridge extension for target browsers
# Usage: ./scripts/build-extension.sh [--chrome] [--firefox] [--safari] [--all]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
SRC="$ROOT/packages/extension"
BUILD="$ROOT/build/extension"

build_chrome() {
  local OUT="$BUILD/chrome"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -r "$SRC"/* "$OUT"/
  echo "Chrome/Edge build ready at: $OUT"
  echo "  Load unpacked from chrome://extensions or edge://extensions"
}

build_firefox() {
  local OUT="$BUILD/firefox"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -r "$SRC"/* "$OUT"/
  # Inject gecko settings
  python3 -c "
import json
with open('$OUT/manifest.json') as f:
    m = json.load(f)
m['browser_specific_settings'] = {
    'gecko': {
        'id': 'maisie-bridge@maisie.local',
        'strict_min_version': '109.0'
    }
}
with open('$OUT/manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
"
  echo "Firefox build ready at: $OUT"
  echo "  Run: cd $OUT && web-ext run"
  echo "  Or load as temporary add-on at about:debugging"
}

build_safari() {
  local OUT="$BUILD/safari-src"
  local XCODE_OUT="$BUILD/safari-xcode"
  rm -rf "$OUT" "$XCODE_OUT"
  mkdir -p "$OUT"
  cp -r "$SRC"/* "$OUT"/

  # Safari doesn't support "type": "module" service workers.
  # Concatenate background scripts into a single non-module file.
  cat "$OUT/background/bridge-client.js" \
      "$OUT/background/keepalive.js" \
      "$OUT/background/command-handlers.js" \
      "$OUT/background/service-worker.js" \
    | sed 's/^export //g; s/^import.*from.*//g; /^$/d' \
    > "$OUT/background/_bundled-service-worker.js"
  rm "$OUT/background/bridge-client.js" "$OUT/background/keepalive.js" \
     "$OUT/background/command-handlers.js" "$OUT/background/service-worker.js"
  mv "$OUT/background/_bundled-service-worker.js" "$OUT/background/service-worker.js"

  # Update manifest: remove "type": "module" from background
  python3 -c "
import json
with open('$OUT/manifest.json') as f:
    m = json.load(f)
if 'type' in m.get('background', {}):
    del m['background']['type']
with open('$OUT/manifest.json', 'w') as f:
    json.dump(m, f, indent=2)
"

  # Run the converter
  echo "Converting to Xcode project..."
  xcrun safari-web-extension-converter "$OUT" \
    --project-location "$XCODE_OUT" \
    --app-name "Maisie Bridge" \
    --bundle-identifier com.maisie.bridge-extension \
    --swift --no-open --macos-only 2>&1

  # Fix extension bundle ID to be prefixed by parent app bundle ID
  sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = "com.maisie.bridge-extension.Extension"/PRODUCT_BUNDLE_IDENTIFIER = "com.maisie.Maisie-Bridge.Extension"/g' \
    "$XCODE_OUT/Maisie Bridge/Maisie Bridge.xcodeproj/project.pbxproj"

  # Build the Xcode project
  echo "Building Xcode project..."
  cd "$XCODE_OUT/Maisie Bridge" && xcodebuild -scheme "Maisie Bridge" -configuration Debug build \
    CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO 2>&1 | tail -5
  cd "$ROOT"

  echo ""
  echo "Safari extension built successfully."
  echo "  1. Open in Xcode: open '$XCODE_OUT/Maisie Bridge/Maisie Bridge.xcodeproj'"
  echo "  2. Build and run (Cmd+R)"
  echo "  3. Safari > Settings > Extensions > Enable 'Maisie Bridge'"
  echo "  4. Safari > Develop > Allow Unsigned Extensions"
}

# Parse arguments
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --chrome) TARGETS+=(chrome) ;;
    --firefox) TARGETS+=(firefox) ;;
    --safari) TARGETS+=(safari) ;;
    --edge) TARGETS+=(chrome) ;; # Edge uses Chrome build
    --all) TARGETS=(chrome firefox safari) ;;
    *) echo "Unknown flag: $arg"; echo "Usage: $0 [--chrome] [--firefox] [--safari] [--edge] [--all]"; exit 1 ;;
  esac
done

# Default to all if no flags
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=(chrome firefox safari)
fi

# Remove duplicates and build
TARGETS=($(echo "${TARGETS[@]}" | tr ' ' '\n' | sort -u))
for target in "${TARGETS[@]}"; do
  echo "==> Building for $target..."
  "build_$target"
  echo ""
done

echo "Done."
