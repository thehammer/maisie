# HEVC Conversion Pipeline — Tokyo Server

## Context

The Maisie host is an HP Z620 running Ubuntu 24.04 with an NVIDIA GTX 1050 Ti (4GB VRAM, NVENC supports H.264/HEVC/AV1). It serves as the Docker host for Plex and other media services. Media lives on a Synology NAS at {SYNOLOGY_HOST}, mounted via NFS4 at `/mnt/nas/plex-library`.

The NAS is **93% full** (52TB used of 56TB). The goal is to convert H.264 media to HEVC using GPU-accelerated encoding to reclaim space.

## Library Analysis

| Library | Size | Files |
|---------|------|-------|
| Movies | 14.8 TB | 3,656 |
| TV Shows | 16.4 TB | 11,304 |
| Anime | 4.2 TB | 8,192 |
| Concerts | 238 GB | 58 |
| Home Movies | 14 GB | 553 |
| **Total** | **~36 TB** | **~23,763** |

### Codec + Resolution Breakdown (biggest targets first)

| Codec | Resolution | Files | Total Size | Avg Size |
|-------|-----------|-------|-----------|----------|
| h264 | 1080p | 6,943 | 15.1 TB | 2.18 GB |
| hevc | 1080p | 5,093 | 7.8 TB | 1.54 GB |
| h264 | 720p | 3,206 | 5.4 TB | 1.69 GB |
| hevc | 4K | 378 | 3.4 TB | 8.91 GB |
| h264 | SD | 5,068 | 1.7 TB | 0.33 GB |
| hevc | 720p | 995 | 1.4 TB | 1.44 GB |

### Conversion Phases

- **Phase 1**: h264 1080p → HEVC (6,943 files, ~15.1TB → ~10.5TB, saves ~4.6TB)
- **Phase 2**: h264 720p → HEVC (3,206 files, ~5.4TB → ~3.5TB, saves ~1.9TB)
- **Phase 3**: h264 SD → HEVC (5,068 files, ~1.7TB → ~1.1TB, saves ~0.6TB)

Estimated total savings: ~7-8 TB.

## Script Location

`/opt/docker/plex-convert/plex-convert.sh` on Tokyo.

### Usage

```bash
./plex-convert.sh [--dry-run] [--phase 1|2|3] [--limit N] [--min-size-mb N] [--max-size-mb N]
```

### How It Works

1. Queries the **Plex SQLite DB** for h264 files at the target resolution (fast, no ffprobe scanning)
2. Sorts by file size descending (biggest savings first)
3. Encodes to HEVC via `ffmpeg` with NVENC (`hevc_nvenc`, preset p5, CQ 22)
4. Writes temp output to **SSD** at `/opt/docker/plex-convert/tmp/` (not NAS)
5. Copies completed file back to NAS, replaces original
6. Output is MKV container with all audio tracks copied, subtitles copied (falls back to no subs if codec unsupported by MKV)

### Safety Checks

- **Duration verification**: Output duration must match input within 2 seconds
- **Codec verification**: Confirms output is HEVC
- **Size check**: If output is larger than input, keeps original (skips)
- **Resume support**: `completed.txt` and `failed.txt` track processed files
- Temp files use SSD, only written to NAS after verification

### State Files

All in `/opt/docker/plex-convert/`:
- `convert.log` — main log
- `completed.txt` — successfully processed files (one path per line)
- `failed.txt` — files that failed (one path per line)
- `phase{N}_queue.txt` — generated work queue
- `stats.txt` — run summaries
- `ffmpeg_{N}.log` — per-file ffmpeg output (deleted on success)

### Plex DB Location

```
/opt/docker/plex/Library/Application Support/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db
```

The DB query maps container paths (`/media/...`) to host paths (`/mnt/nas/plex-library/...`).

## Known Issues

1. **Very large files (50GB+)** may fail with NVENC — the first Infinity Saga file (85GB) only partially encoded. Consider splitting or using CPU encoding for those.
2. **CQ 22 may be too generous** for already-efficient H.264 encodes — the test file (Darkest Hour, 4.9GB) produced a *larger* HEVC output (6.4GB). The script correctly skips these. Could bump to CQ 24-26 for better compression ratio, at slight quality cost.
3. **Subtitle codec 94213 (mov_text/tx3g)** from MP4 containers is unsupported by MKV. The script retries without subtitles when this happens.
4. **After conversion, Plex needs to be aware** of the new file paths (.mkv replacing .mp4/.m4v). A library scan after batch conversions will pick up the changes. The old file paths in the Plex DB will become stale but Plex handles this gracefully on scan.

## Recommended Approach

1. Start with `--dry-run --phase 1` to see the queue
2. Test with `--limit 5 --min-size-mb 1000 --max-size-mb 10000` to verify on a small batch
3. Run in a tmux session: `tmux new -s convert` then launch the full phase
4. Monitor with `tail -f /opt/docker/plex-convert/convert.log`
5. After a batch completes, trigger a Plex library scan to update paths

## SSH Access

```bash
ssh user@{LAN_IP}
```

Key auth, passwordless sudo.
