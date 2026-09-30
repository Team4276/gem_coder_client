#!/bin/sh

cd -- "$(dirname -- "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed to start Gem Coder." >&2
  echo "Ask your instructor for help installing Node.js, then try again." >&2
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
case "$NODE_MAJOR" in
  ''|*[!0-9]*)
    echo "Node.js could not be started correctly." >&2
    exit 1
    ;;
esac
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Gem Coder requires Node.js 18 or newer. This computer has Node.js $NODE_MAJOR." >&2
  echo "Ask your instructor for help updating Node.js, then try again." >&2
  exit 1
fi

echo "Starting Gem Coder. Keep this terminal open while you use it."
echo "Press Ctrl+C to stop Gem Coder."
exec node ./companion.mjs --serve-app --open
