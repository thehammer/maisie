#!/bin/bash
#
# Interactive resolver for unsorted 3D printing files
# Usage: resolve-unsorted.sh [folder]
# Defaults to all _Unsorted folders under 3D Printing
#

BASE="/Volumes/Shared/3D Printing"

if [ ! -d "$BASE" ]; then
    echo "ERROR: $BASE not mounted"
    exit 1
fi

TARGET="${1:-}"

# Find all _Unsorted folders, or use the specified one
if [ -n "$TARGET" ]; then
    FOLDERS=("$TARGET")
else
    mapfile -t FOLDERS < <(find "$BASE" -type d -name "_Unsorted" 2>/dev/null | sort)
fi

if [ ${#FOLDERS[@]} -eq 0 ]; then
    echo "No _Unsorted folders found."
    exit 0
fi

# List contents of each _Unsorted folder as JSON for Claude to process
for folder in "${FOLDERS[@]}"; do
    rel="${folder#$BASE/}"
    count=$(ls -1 "$folder" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -eq 0 ]; then continue; fi

    echo "=== $rel ($count items) ==="
    ls -1 "$folder" 2>/dev/null | while read -r item; do
        # Check if it's a directory or file
        if [ -d "$folder/$item" ]; then
            echo "  [DIR]  $item"
        else
            size=$(du -h "$folder/$item" 2>/dev/null | cut -f1 | tr -d ' ')
            echo "  [FILE] $item ($size)"
        fi
    done
    echo ""
done
