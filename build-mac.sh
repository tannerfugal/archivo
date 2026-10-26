#!/bin/bash
# Archivo Fork — GPL-3.0-or-later. Test builds sign when a Developer ID is available.
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Install Node.js 22 or newer first.'; exit 1; }
[ -d node_modules ] || npm ci
case "${1:-}" in
  --unsigned) export CSC_IDENTITY_AUTO_DISCOVERY=false; npm run build:mac:test ;;
  --notarize)
    export APPLE_KEYCHAIN_PROFILE="${NOTARY_PROFILE:-archivo-notarization}"
    xcrun notarytool history --keychain-profile "$APPLE_KEYCHAIN_PROFILE" >/dev/null
    npx electron-builder --mac --arm64 --config.mac.notarize=true --publish never
    ;;
  ''|--quick) npm run build:mac:test ;;
  *) echo 'Usage: build-mac.sh [--unsigned | --quick | --notarize]'; exit 1 ;;
esac
echo 'Builds are in dist/. Ordinary beta builds are not notarized. See TESTING.md.'
