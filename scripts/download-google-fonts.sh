#!/usr/bin/env bash
# download-google-fonts.sh
#
# Downloads woff2 font files from Google Fonts CSS2 API for all 20 font
# families used in TaskSync and generates per-family font.css files with
# @font-face declarations using relative paths and font-display: block.
#
# Usage:
#   ./scripts/download-google-fonts.sh
#
# Requirements: curl, grep (with -oP), awk
# Idempotent: re-running overwrites existing files safely.
#
# The Google Fonts CSS2 API is queried with a Chrome user-agent to ensure
# woff2 format responses. The API returns multiple @font-face blocks per
# weight (one per unicode subset). All subsets are preserved so browsers
# only download the woff2 file for character ranges that appear on the page.
#
# Source: Google Fonts CSS2 API with Chrome user-agent (woff2 format).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FONTS_DIR="$REPO_ROOT/web/static/fonts"
CHROME_UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# Ordered list of font slugs
SLUGS=(
  sora sono inter inter-tight jetbrains-mono
  atkinson-hyperlegible atkinson-hyperlegible-next
  ibm-plex-sans ibm-plex-mono ibm-plex-serif
  roboto roboto-slab roboto-mono dm-mono comfortaa
  poppins victor-mono pt-sans pt-serif pt-mono
)

# font-family names — must match +layout.svelte CSS exactly (same index as SLUGS)
FAMILY_NAMES=(
  "Sora"
  "Sono"
  "Inter"
  "Inter Tight"
  "JetBrains Mono"
  "Atkinson Hyperlegible"
  "Atkinson Hyperlegible Next"
  "IBM Plex Sans"
  "IBM Plex Mono"
  "IBM Plex Serif"
  "Roboto"
  "Roboto Slab"
  "Roboto Mono"
  "DM Mono"
  "Comfortaa"
  "Poppins"
  "Victor Mono"
  "PT Sans"
  "PT Serif"
  "PT Mono"
)

# Google Fonts CSS2 URLs — same URLs as the fontFaceCSS map in app.html (same index as SLUGS)
FONT_URLS=(
  "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap"
  "https://fonts.googleapis.com/css2?family=Sono:wght@400;500;600;700;800&display=swap"
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
  "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&display=swap"
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap"
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;700&display=swap"
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@400;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap"
  "https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=Victor+Mono:wght@400;500;600;700&display=swap"
  "https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap"
  "https://fonts.googleapis.com/css2?family=PT+Serif:wght@400;700&display=swap"
  "https://fonts.googleapis.com/css2?family=PT+Mono&display=swap"
)

# weight number -> weight name suffix for woff2 filenames
weight_name() {
  case "$1" in
    100) echo "Thin" ;;
    200) echo "ExtraLight" ;;
    300) echo "Light" ;;
    400) echo "Regular" ;;
    500) echo "Medium" ;;
    600) echo "SemiBold" ;;
    700) echo "Bold" ;;
    800) echo "ExtraBold" ;;
    900) echo "Black" ;;
    *) echo "W$1" ;;
  esac
}

# Remove spaces from a family name for use in filenames (e.g. "Inter Tight" -> "InterTight")
family_no_space() {
  echo "$1" | tr -d ' '
}

echo "TaskSync Google Fonts downloader"
echo "Output directory: $FONTS_DIR"
echo ""

mkdir -p "$FONTS_DIR"

for i in "${!SLUGS[@]}"; do
  SLUG="${SLUGS[$i]}"
  FAMILY="${FAMILY_NAMES[$i]}"
  URL="${FONT_URLS[$i]}"
  OUT_DIR="$FONTS_DIR/$SLUG"
  FAMILY_FILE_PREFIX="$(family_no_space "$FAMILY")"

  echo "[$((i+1))/${#SLUGS[@]}] $FAMILY ($SLUG)"
  mkdir -p "$OUT_DIR"

  # Fetch the Google Fonts CSS2 response.
  # Chrome user-agent causes the API to return woff2 format files.
  CSS="$(curl -fsSL -A "$CHROME_UA" "$URL")"

  if [[ -z "$CSS" ]]; then
    echo "  ERROR: Empty CSS response for $SLUG" >&2
    exit 1
  fi

  # Write font.css header
  CSS_FILE="$OUT_DIR/font.css"
  {
    printf "/* %s - downloaded from Google Fonts CSS2 API */\n" "$FAMILY"
    printf "/* font-display: block prevents fallback font flash during load */\n"
    printf "/* Source: fonts.googleapis.com/css2 with Chrome user-agent (woff2) */\n"
    printf "\n"
  } > "$CSS_FILE"

  BLOCK_COUNT=0
  WOFF2_COUNT=0

  # Declare fresh weight counter for this family.
  # Tracks how many @font-face blocks we've written per weight so we can
  # give unique filenames to multiple subset files for the same weight
  # (e.g. Sora-Regular.woff2, Sora-Regular-1.woff2, Sora-Regular-2.woff2).
  # Unset before re-declaring so stale state never carries over if the loop
  # body exits early via continue.
  unset WEIGHT_COUNTER
  declare -A WEIGHT_COUNTER=()

  # Parse @font-face blocks from the Google Fonts CSS.
  # Strategy: awk collects lines between "@font-face {" and "}" into a single
  # block, then prints it followed by a \x01 byte as the record separator.
  # The shell while-loop reads one complete block at a time using -d $'\x01'.
  while IFS= read -r -d $'\x01' BLOCK; do
    [[ -z "$BLOCK" ]] && continue

    # Extract font-weight value
    WEIGHT="$(echo "$BLOCK" | grep -oP '(?<=font-weight: )[0-9]+' | head -1)"
    [[ -z "$WEIGHT" ]] && continue

    # Extract the woff2 src URL (format: url(...) format('woff2'))
    WOFF2_URL="$(echo "$BLOCK" | grep -oP "url\(\K[^)]+(?=\) format\('woff2'\))" | head -1)"
    [[ -z "$WOFF2_URL" ]] && continue

    # Extract unicode-range (present for latin, latin-ext, cyrillic subsets etc.)
    UNICODE_RANGE="$(echo "$BLOCK" | grep -oP '(?<=unicode-range: )[^;]+' | head -1 | xargs)"

    # Determine unique woff2 filename.
    # For families where a weight has multiple subsets, the first subset uses
    # the clean name (e.g. Sora-Regular.woff2) and subsequent ones are numbered
    # (e.g. Sora-Regular-1.woff2, Sora-Regular-2.woff2).
    WEIGHT_NAME="$(weight_name "$WEIGHT")"
    COUNTER="${WEIGHT_COUNTER[$WEIGHT]:-0}"
    WEIGHT_COUNTER[$WEIGHT]=$((COUNTER + 1))

    if [[ "$COUNTER" -eq 0 ]]; then
      WOFF2_FILENAME="${FAMILY_FILE_PREFIX}-${WEIGHT_NAME}.woff2"
    else
      WOFF2_FILENAME="${FAMILY_FILE_PREFIX}-${WEIGHT_NAME}-${COUNTER}.woff2"
    fi

    WOFF2_PATH="$OUT_DIR/$WOFF2_FILENAME"

    # Download the woff2 file from fonts.gstatic.com
    if curl -fsSL -o "$WOFF2_PATH" "$WOFF2_URL"; then
      WOFF2_COUNT=$((WOFF2_COUNT + 1))
      echo "  Downloaded: $WOFF2_FILENAME (weight $WEIGHT)"
    else
      echo "  ERROR: Failed to download $WOFF2_URL" >&2
      exit 1
    fi

    # Append the @font-face rule to font.css with a relative woff2 path
    {
      printf "@font-face {\n"
      printf "  font-family: '%s';\n" "$FAMILY"
      printf "  font-style: normal;\n"
      printf "  font-weight: %s;\n" "$WEIGHT"
      printf "  font-display: block;\n"
      printf "  src: url('./%s') format('woff2');\n" "$WOFF2_FILENAME"
      if [[ -n "$UNICODE_RANGE" ]]; then
        printf "  unicode-range: %s;\n" "$UNICODE_RANGE"
      fi
      printf "}\n\n"
    } >> "$CSS_FILE"

    BLOCK_COUNT=$((BLOCK_COUNT + 1))
  done < <(echo "$CSS" | awk '
    /^@font-face \{/ { in_block=1; block=""; next }
    in_block {
      if (/^\}/) {
        print block "\x01"
        in_block=0
        block=""
      } else {
        line=$0
        sub(/^[[:space:]]+/, "", line)
        block = block "\n" line
      }
    }
  ')

  if [[ "$BLOCK_COUNT" -eq 0 ]]; then
    echo "  WARNING: No @font-face blocks found for $SLUG" >&2
  else
    echo "  Generated font.css: $BLOCK_COUNT @font-face rules, $WOFF2_COUNT woff2 files"
  fi

  echo ""
done

echo "============================================"
echo "Download complete"
echo ""
echo "Summary per font:"
for SLUG in "${SLUGS[@]}"; do
  DIR="$FONTS_DIR/$SLUG"
  WOFF2_FILES="$(find "$DIR" -name '*.woff2' 2>/dev/null | wc -l | xargs)"
  printf "  %-35s %s woff2 file(s)\n" "$SLUG" "$WOFF2_FILES"
done

TOTAL_SIZE="$(du -sh "$FONTS_DIR" 2>/dev/null | cut -f1)"
TOTAL_WOFF2="$(find "$FONTS_DIR" -name '*.woff2' 2>/dev/null | wc -l | xargs)"
echo ""
echo "Total size of web/static/fonts/: $TOTAL_SIZE"
echo "Total woff2 files: $TOTAL_WOFF2"
