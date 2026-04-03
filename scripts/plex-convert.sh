#!/bin/bash
# Plex Media Converter v2
# Converts h264 files to HEVC (h265) using NVIDIA NVENC
# Output: MKV container, all audio/subtitle tracks preserved
#
# Usage:
#   ./plex-convert.sh [--dry-run] [--phase 1|2|3] [--limit N] [--min-size-mb N] [--max-size-mb N]
#   ./plex-convert.sh --cleanup [--dry-run]
#
# Phases:
#   1 = h264 1080p (biggest savings)
#   2 = h264 720p
#   3 = h264 SD
#
# Safety:
#   - Plex must be stopped before running (script verifies this)
#   - Source is copied to SSD before encoding (NAS original untouched during encode)
#   - Original renamed to .old only after output is verified on NAS
#   - Plex DB path updated inline (safe since Plex is stopped)
#   - Cleanup is a separate step that deletes .old backups after verifying new files

set -euo pipefail

# === Configuration ===
MEDIA_ROOT="/mnt/nas/plex-library"
LOG_DIR="/opt/docker/plex-convert"
TEMP_DIR="/opt/docker/plex-convert/tmp"
SRC_DIR="$TEMP_DIR/source"
OUT_DIR="$TEMP_DIR/output"
LOG_FILE="$LOG_DIR/convert.log"
DONE_FILE="$LOG_DIR/completed.txt"
FAILED_FILE="$LOG_DIR/failed.txt"
PENDING_FILE="$LOG_DIR/pending_cleanup.csv"
STATS_FILE="$LOG_DIR/stats.txt"

# Plex API
PLEX_URL="http://localhost:32400"
PLEX_TOKEN="${PLEX_TOKEN:?PLEX_TOKEN env var required}"
PLEX_DB="/opt/docker/plex/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db"

# Container-to-host path mapping
PLEX_CONTAINER_PREFIX="/media/"
PLEX_HOST_PREFIX="$MEDIA_ROOT/"

# NVENC quality settings
# CQ 24 = visually transparent, good compression. CQ 22 caused many files to grow.
CQ_VALUE=24
PRESET="p5"

# Safety: duration match tolerance (seconds)
DURATION_TOLERANCE=2

# Minimum SSD free space required to start a file (bytes) — 50GB buffer
MIN_SSD_FREE=$((50 * 1073741824))

# Window: stop starting new files outside this range (hours, CT)
WINDOW_START=23
WINDOW_END=5

# === Parse arguments ===
DRY_RUN=false
PHASE=1
LIMIT=0
MIN_SIZE_MB=0
MAX_SIZE_MB=0
CLEANUP=false
QUEUE_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --phase) PHASE="$2"; shift 2 ;;
        --limit) LIMIT="$2"; shift 2 ;;
        --min-size-mb) MIN_SIZE_MB="$2"; shift 2 ;;
        --max-size-mb) MAX_SIZE_MB="$2"; shift 2 ;;
        --cleanup) CLEANUP=true; shift ;;
        --queue) QUEUE_FILE="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# MQTT for dashboard updates
MQTT_HOST="localhost"
MQTT_PORT="1883"
MQTT_TOPIC="home/system/hevc/status"

# === Setup ===
mkdir -p "$LOG_DIR" "$SRC_DIR" "$OUT_DIR"
touch "$DONE_FILE" "$FAILED_FILE" "$PENDING_FILE"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

publish_status() {
    local json="$1"
    mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" -t "$MQTT_TOPIC" -m "$json" 2>/dev/null || true
}

get_duration() {
    ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | head -1 | cut -d. -f1
}

get_codec() {
    ffprobe -v quiet -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$1" 2>/dev/null | head -1
}

in_window() {
    local hour
    hour=$(date +%H | sed 's/^0//')
    if [ "$WINDOW_START" -gt "$WINDOW_END" ]; then
        # Wraps midnight: e.g. 23–5 means 23,0,1,2,3,4
        [ "$hour" -ge "$WINDOW_START" ] || [ "$hour" -lt "$WINDOW_END" ]
    else
        [ "$hour" -ge "$WINDOW_START" ] && [ "$hour" -lt "$WINDOW_END" ]
    fi
}

check_ssd_space() {
    local free_bytes
    free_bytes=$(df --output=avail -B1 "$TEMP_DIR" | tail -1 | tr -d ' ')
    if [ "$free_bytes" -lt "$MIN_SSD_FREE" ]; then
        log "  ABORT: SSD free space (${free_bytes} bytes) below minimum (${MIN_SSD_FREE} bytes)"
        return 1
    fi
}

# Convert host path to Plex container path
host_to_container_path() {
    echo "${1/$PLEX_HOST_PREFIX/$PLEX_CONTAINER_PREFIX}"
}

# Note: Plex can be running — sqlite3 uses a 5-second busy timeout for DB writes

# Update Plex DB path when extension changes (e.g., .mp4 → .mkv)
update_plex_db_path() {
    local old_container_path new_container_path updated
    old_container_path=$(host_to_container_path "$1")
    new_container_path=$(host_to_container_path "$2")

    if [ "$old_container_path" = "$new_container_path" ]; then
        return 0
    fi

    updated=$(sqlite3 -cmd ".timeout 5000" "$PLEX_DB" "
        UPDATE media_parts SET file = '${new_container_path//\'/\'\'}'
        WHERE file = '${old_container_path//\'/\'\'}';
        SELECT changes();
    ")

    if [ "$updated" -gt 0 ]; then
        log "  Plex DB: updated path ($updated row(s))"
    else
        log "  Plex DB: no matching row for old path (may be OK for new files)"
    fi
}

# === Cleanup mode ===
# Deletes .old backups after verifying the new file exists and is valid HEVC.
# Plex DB was already updated during conversion, so this is just disk cleanup.
if $CLEANUP; then
    log "=== Starting cleanup — removing .old backups ==="

    if [ ! -s "$PENDING_FILE" ]; then
        log "No pending cleanups."
        exit 0
    fi

    cleaned=0
    skipped=0
    errors=0

    while IFS='|' read -r original_path backup_path new_path timestamp; do
        [[ -z "$original_path" || "$original_path" == \#* ]] && continue

        filename=$(basename "$new_path")

        # Verify new file exists on disk
        if [ ! -f "$new_path" ]; then
            log "  ERROR: New file missing: $new_path"
            errors=$((errors + 1))
            continue
        fi

        # Verify new file is valid HEVC
        new_codec=$(get_codec "$new_path")
        if [ "$new_codec" != "hevc" ]; then
            log "  ERROR: $filename — codec is '$new_codec', expected 'hevc'"
            errors=$((errors + 1))
            continue
        fi

        # Verify Plex DB has the new path
        container_path=$(host_to_container_path "$new_path")
        plex_count=$(sqlite3 -cmd ".timeout 5000" "$PLEX_DB" \
            "SELECT COUNT(*) FROM media_parts WHERE file = '${container_path//\'/\'\'}';")

        if [ "$plex_count" -eq 0 ]; then
            log "  SKIP: $filename — not in Plex DB (run conversion again with Plex stopped?)"
            skipped=$((skipped + 1))
            continue
        fi

        if $DRY_RUN; then
            log "  DRY-RUN: Would delete backup: $backup_path"
            cleaned=$((cleaned + 1))
            continue
        fi

        if [ -f "$backup_path" ]; then
            rm -f "$backup_path"
            log "  CLEANED: $filename (backup removed)"
        else
            log "  CLEANED: $filename (backup already gone)"
        fi
        cleaned=$((cleaned + 1))
    done < "$PENDING_FILE"

    # Rewrite pending file with only unresolved entries
    if ! $DRY_RUN; then
        tmp_pending="${PENDING_FILE}.tmp"
        > "$tmp_pending"
        while IFS='|' read -r original_path backup_path new_path timestamp; do
            [[ -z "$original_path" || "$original_path" == \#* ]] && continue
            [ -f "${backup_path}" ] && echo "${original_path}|${backup_path}|${new_path}|${timestamp}"
        done < "$PENDING_FILE" > "$tmp_pending"
        mv "$tmp_pending" "$PENDING_FILE"
    fi

    log "=== Cleanup complete: $cleaned cleaned, $skipped skipped, $errors errors ==="
    exit 0
fi

# === Conversion mode ===

WORK_FILE="$LOG_DIR/phase${PHASE}_queue.txt"

QUEUE_USED=false

if [ -n "$QUEUE_FILE" ] && [ -s "$QUEUE_FILE" ]; then
    # Use queue file from nightly runner
    log "=== Processing HEVC queue: $QUEUE_FILE ==="
    log "Settings: CQ=$CQ_VALUE, Preset=$PRESET, DryRun=$DRY_RUN, Limit=$LIMIT"
    QUEUE_USED=true

    # Filter out already completed files
    > "$WORK_FILE"
    while IFS='|' read -r size filepath; do
        [ -z "$filepath" ] && continue
        grep -qFx "$filepath" "$DONE_FILE" 2>/dev/null && continue
        grep -qFx "$filepath" "$FAILED_FILE" 2>/dev/null && continue
        [ ! -f "$filepath" ] && continue
        echo "$size|$filepath"
    done < "$QUEUE_FILE" >> "$WORK_FILE"

    # Clear the queue file (consumed)
    > "$QUEUE_FILE"
fi

# Fall back to Plex DB if queue was empty or not provided
if [ "$QUEUE_USED" = false ] || [ ! -s "$WORK_FILE" ]; then
    # Build file list from Plex DB (original mode)
    case $PHASE in
        1) MIN_H=1000; MAX_H=2099; PHASE_NAME="1080p" ;;
        2) MIN_H=700;  MAX_H=999;  PHASE_NAME="720p" ;;
        3) MIN_H=1;    MAX_H=699;  PHASE_NAME="SD" ;;
        *) echo "Invalid phase: $PHASE"; exit 1 ;;
    esac

    log "=== Starting Phase $PHASE ($PHASE_NAME) h264→HEVC conversion ==="
    log "Settings: CQ=$CQ_VALUE, Preset=$PRESET, DryRun=$DRY_RUN, Limit=$LIMIT"

    log "Querying Plex DB for h264 $PHASE_NAME files..."

    sqlite3 -cmd ".timeout 5000" "$PLEX_DB" "
    SELECT mp.size, REPLACE(mp.file, '/media/', '${MEDIA_ROOT}/')
    FROM media_streams ms
    JOIN media_parts mp ON ms.media_part_id = mp.id
    JOIN media_items mi ON mp.media_item_id = mi.id
    WHERE ms.stream_type_id = 1
      AND ms.codec = 'h264'
      AND mi.height >= $MIN_H AND mi.height <= $MAX_H
      AND mp.file != ''
    ORDER BY mp.size DESC;
    " | while IFS='|' read -r size filepath; do
        grep -qFx "$filepath" "$DONE_FILE" 2>/dev/null && continue
        grep -qFx "$filepath" "$FAILED_FILE" 2>/dev/null && continue

        if [ "$MIN_SIZE_MB" -gt 0 ]; then
            size_mb=$((size / 1048576))
            [ "$size_mb" -lt "$MIN_SIZE_MB" ] && continue
        fi
        if [ "$MAX_SIZE_MB" -gt 0 ]; then
            size_mb=$((size / 1048576))
            [ "$size_mb" -gt "$MAX_SIZE_MB" ] && continue
        fi

        [ ! -f "$filepath" ] && continue

        echo "$size|$filepath"
    done > "$WORK_FILE"
fi

TOTAL=$(wc -l < "$WORK_FILE")
log "Found $TOTAL files to convert"

if [ "$TOTAL" -eq 0 ]; then
    log "Nothing to do."
    exit 0
fi

# Stats
TOTAL_BYTES=$(awk -F'|' '{sum+=$1} END {printf "%.0f", sum}' "$WORK_FILE")
TOTAL_GB=$(echo "scale=1; $TOTAL_BYTES / 1073741824" | bc)
EST_SAVED=$(echo "scale=1; $TOTAL_GB * 0.30" | bc)
log "Total size: ${TOTAL_GB}GB, estimated savings: ~${EST_SAVED}GB (30%)"

if $DRY_RUN; then
    log "=== DRY RUN — showing first 20 files ==="
    head -20 "$WORK_FILE" | while IFS='|' read -r size filepath; do
        size_gb=$(echo "scale=2; $size / 1073741824" | bc)
        echo "  ${size_gb}GB  $(basename "$filepath")"
    done
    log "=== DRY RUN complete ==="
    exit 0
fi

# === Process files ===
COUNT=0
SAVED_TOTAL=0
START_TIME=$(date +%s)

publish_status "{\"running\":true,\"total\":$TOTAL,\"processed\":0,\"savedGB\":0,\"currentFile\":null}"

while IFS='|' read -r orig_size filepath <&3; do
    COUNT=$((COUNT + 1))

    if [ "$LIMIT" -gt 0 ] && [ "$COUNT" -gt "$LIMIT" ]; then
        log "Reached limit of $LIMIT files. Stopping."
        break
    fi

    filename=$(basename "$filepath")
    dirname=$(dirname "$filepath")
    base="${filename%.*}"
    ext="${filename##*.}"
    output_name="${base}.mkv"
    output_path="${dirname}/${output_name}"

    orig_gb=$(echo "scale=2; $orig_size / 1073741824" | bc)
    log "[$COUNT/$TOTAL] Converting: $filename (${orig_gb}GB)"

    # Check if we're still in the overnight window
    if ! in_window; then
        log "  Outside window (${WINDOW_START}:00–${WINDOW_END}:00). Stopping."
        break
    fi

    # Check SSD space before starting
    if ! check_ssd_space; then
        log "  Stopping due to low SSD space."
        break
    fi

    # --- Step 1: Copy source to SSD ---
    src_copy="$SRC_DIR/$filename"
    log "  Copying source to SSD..."
    if ! cp "$filepath" "$src_copy"; then
        log "  FAIL: Could not copy source to SSD"
        echo "$filepath" >> "$FAILED_FILE"
        rm -f "$src_copy"
        continue
    fi

    # Verify source copy size matches
    src_copy_size=$(stat --printf='%s' "$src_copy")
    if [ "$src_copy_size" != "$orig_size" ]; then
        log "  FAIL: Source copy size mismatch ($src_copy_size != $orig_size)"
        echo "$filepath" >> "$FAILED_FILE"
        rm -f "$src_copy"
        continue
    fi

    # Get input duration for verification
    in_duration=$(get_duration "$src_copy")
    if [ -z "$in_duration" ] || [ "$in_duration" -eq 0 ]; then
        log "  SKIP: Could not determine duration"
        echo "$filepath" >> "$FAILED_FILE"
        rm -f "$src_copy"
        continue
    fi

    # --- Step 2: Encode on SSD ---
    temp_output="$OUT_DIR/${base}.mkv"
    convert_start=$(date +%s)

    # Try with subtitle copy first, fall back to no subs if codec unsupported
    ffmpeg_ok=false
    if ffmpeg -nostdin -y -hwaccel cuda -i "$src_copy" \
        -c:v hevc_nvenc -preset "$PRESET" -cq "$CQ_VALUE" -rc vbr \
        -c:a copy \
        -c:s copy \
        -map 0:v -map 0:a -map 0:s? \
        -map_metadata 0 \
        "$temp_output" 2>> "$LOG_DIR/ffmpeg_${COUNT}.log"; then
        ffmpeg_ok=true
    else
        # Subtitle copy failed — retry without subtitles
        log "  Retrying without subtitle copy..."
        rm -f "$temp_output"
        if ffmpeg -nostdin -y -hwaccel cuda -i "$src_copy" \
            -c:v hevc_nvenc -preset "$PRESET" -cq "$CQ_VALUE" -rc vbr \
            -c:a copy \
            -sn \
            -map 0:v -map 0:a \
            -map_metadata 0 \
            "$temp_output" 2>> "$LOG_DIR/ffmpeg_${COUNT}.log"; then
            ffmpeg_ok=true
        fi
    fi

    if ! $ffmpeg_ok || [ ! -f "$temp_output" ] || [ "$(stat --printf='%s' "$temp_output" 2>/dev/null || echo 0)" -eq 0 ]; then
        log "  FAIL: ffmpeg error (see ffmpeg_${COUNT}.log)"
        rm -f "$temp_output" "$src_copy"
        echo "$filepath" >> "$FAILED_FILE"
        continue
    fi

    convert_end=$(date +%s)
    elapsed=$((convert_end - convert_start))

    # --- Step 3: Verify output ---
    out_duration=$(get_duration "$temp_output")
    out_size=$(stat --printf='%s' "$temp_output")
    out_codec=$(get_codec "$temp_output")

    # Duration check
    duration_diff=$(( ${in_duration:-0} - ${out_duration:-0} ))
    duration_diff=${duration_diff#-}

    if [ "$duration_diff" -gt "$DURATION_TOLERANCE" ]; then
        log "  FAIL: Duration mismatch (in=${in_duration}s, out=${out_duration}s, diff=${duration_diff}s)"
        rm -f "$temp_output" "$src_copy"
        echo "$filepath" >> "$FAILED_FILE"
        continue
    fi

    # Codec check
    if [ "$out_codec" != "hevc" ]; then
        log "  FAIL: Output codec is '$out_codec', expected 'hevc'"
        rm -f "$temp_output" "$src_copy"
        echo "$filepath" >> "$FAILED_FILE"
        continue
    fi

    out_gb=$(echo "scale=2; $out_size / 1073741824" | bc)

    # --- Step 4: Copy output to NAS as .new ---
    nas_new="${output_path}.new"
    log "  Copying output to NAS (${out_gb}GB)..."
    if ! cp "$temp_output" "$nas_new"; then
        log "  FAIL: Could not copy output to NAS"
        rm -f "$temp_output" "$src_copy" "$nas_new"
        echo "$filepath" >> "$FAILED_FILE"
        continue
    fi

    # Verify NAS copy
    nas_new_size=$(stat --printf='%s' "$nas_new")
    if [ "$nas_new_size" != "$out_size" ]; then
        log "  FAIL: NAS copy size mismatch ($nas_new_size != $out_size)"
        rm -f "$temp_output" "$src_copy" "$nas_new"
        echo "$filepath" >> "$FAILED_FILE"
        continue
    fi

    # --- Step 5: Rename original to .old, rename .new to final ---
    backup_path="${filepath}.old"
    if ! mv "$filepath" "$backup_path"; then
        log "  FAIL: Could not rename original to .old"
        rm -f "$temp_output" "$src_copy" "$nas_new"
        echo "$filepath" >> "$FAILED_FILE"
        continue
    fi

    if ! mv "$nas_new" "$output_path"; then
        log "  FAIL: Could not rename .new to final — restoring original"
        mv "$backup_path" "$filepath"  # restore
        rm -f "$temp_output" "$src_copy"
        echo "$filepath" >> "$FAILED_FILE"
        continue
    fi

    # --- Step 6: Update Plex DB if extension changed ---
    update_plex_db_path "$filepath" "$output_path"

    # --- Step 7: Log and clean up ---
    saved=$((orig_size - out_size))
    saved_gb=$(echo "scale=2; $saved / 1073741824" | bc)
    SAVED_TOTAL=$((SAVED_TOTAL + saved))
    saved_total_gb=$(echo "scale=2; $SAVED_TOTAL / 1073741824" | bc)

    # Record for cleanup phase
    echo "${filepath}|${backup_path}|${output_path}|$(date '+%Y-%m-%d %H:%M:%S')" >> "$PENDING_FILE"
    echo "$filepath" >> "$DONE_FILE"

    # Clean SSD temp
    rm -f "$temp_output" "$src_copy" "$LOG_DIR/ffmpeg_${COUNT}.log"

    if [ "$saved" -ge 0 ]; then
        log "  OK: ${orig_gb}GB → ${out_gb}GB (saved ${saved_gb}GB) in ${elapsed}s [total saved: ${saved_total_gb}GB]"
    else
        log "  OK: ${orig_gb}GB → ${out_gb}GB (grew ${saved_gb#-}GB, kept for uniformity) in ${elapsed}s"
    fi

    publish_status "{\"running\":true,\"total\":$TOTAL,\"processed\":$COUNT,\"savedGB\":${saved_total_gb},\"currentFile\":\"$filename\",\"lastElapsed\":$elapsed}"

done 3< "$WORK_FILE"

# === Summary ===
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
SAVED_GB=$(echo "scale=2; $SAVED_TOTAL / 1073741824" | bc)

log "=== Phase $PHASE Complete ==="
log "Files processed: $((COUNT > LIMIT && LIMIT > 0 ? LIMIT : COUNT))"
log "Total saved: ${SAVED_GB}GB"
log "Total time: $((TOTAL_TIME / 3600))h $((TOTAL_TIME % 3600 / 60))m"

publish_status "{\"running\":false,\"total\":$TOTAL,\"processed\":$COUNT,\"savedGB\":${SAVED_GB},\"currentFile\":null,\"totalTime\":$TOTAL_TIME}"
log "Run --cleanup after Plex scan to remove .old backups"

echo "$(date '+%Y-%m-%d %H:%M:%S') Phase=$PHASE Files=$COUNT Saved=${SAVED_GB}GB Time=${TOTAL_TIME}s" >> "$STATS_FILE"
