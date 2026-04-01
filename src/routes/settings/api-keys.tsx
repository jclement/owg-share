import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "../../api/hooks";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Spinner } from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/Toast";
import { Key, Plus, Trash2, Copy, Check, Download } from "lucide-react";

export const Route = createFileRoute("/settings/api-keys")({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { data: apiKeys, isLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyResult, setNewKeyResult] = useState<{ key: string; name: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const { toast } = useToast();

  const handleCreate = () => {
    if (!newKeyName.trim()) { toast("error", "Name is required"); return; }
    createApiKey.mutate(
      { name: newKeyName.trim() },
      {
        onSuccess: (data) => {
          setNewKeyResult({ key: data.key, name: data.name });
          setNewKeyName("");
        },
        onError: (e) => toast("error", e.message),
      }
    );
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this API key?")) return;
    deleteApiKey.mutate(id, { onSuccess: () => toast("success", "API key deleted") });
  };

  const copyKey = () => {
    if (newKeyResult) {
      navigator.clipboard.writeText(newKeyResult.key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-3">API Keys</h1>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            API keys allow programmatic access to create and manage shares.
          </p>
          <Button size="sm" variant="secondary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create Key
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : apiKeys && apiKeys.length > 0 ? (
          <div className="space-y-2">
            {apiKeys.map((key) => (
              <div key={key.id} className="flex items-center gap-4 p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg">
                <Key size={18} className="text-neutral-500 dark:text-neutral-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-800 dark:text-neutral-200">{key.name}</div>
                  <div className="text-xs text-neutral-500">
                    <span className="font-mono">{key.key_prefix}...</span>
                    {" · "}Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                  </div>
                </div>
                <button onClick={() => handleDelete(key.id)} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-red-500 dark:hover:text-red-400">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-neutral-500 text-sm">No API keys yet. Create one to get started.</div>
        )}
      </div>

      {/* API Usage Examples */}
      <div>
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mb-3">API Usage</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          Use your API key in the <code className="text-xs bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-mono">Authorization</code> header.
        </p>
        <div className="space-y-4">
          <CurlExample
            title="Create a link share"
            command={`curl -X POST $BASE_URL/api/shares/links \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "title": "Example Link",
    "comment": "Internal note"
  }'`}
          />
          <CurlExample
            title="Create a markdown share"
            command={`curl -X POST $BASE_URL/api/shares/markdown \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "# Hello World\\nSome **markdown** content.",
    "title": "My Document"
  }'`}
          />
          <CurlExample
            title="Create a code share"
            command={`curl -X POST $BASE_URL/api/shares/code \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "console.log(\\\"hello world\\\");",
    "language": "javascript",
    "filename": "hello.js",
    "title": "Hello World"
  }'`}
          />
          <CurlExample
            title="Upload a file (two steps)"
            command={`# Step 1: Get an upload URL
curl -X POST $BASE_URL/api/upload/presign \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "photo.jpg",
    "contentType": "image/jpeg",
    "size": 102400
  }'
# Returns: { "uploadId": "...", "r2Key": "..." }

# Step 2: Upload the file
curl -X PUT $BASE_URL/api/upload/file/UPLOAD_ID \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  --data-binary @photo.jpg

# Step 3: Create the file share
curl -X POST $BASE_URL/api/shares/files \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "filename": "photo.jpg",
    "content_type": "image/jpeg",
    "size": 102400,
    "r2_key": "R2_KEY_FROM_STEP_1",
    "title": "My Photo"
  }'`}
          />
          <CurlExample
            title="List all shares"
            command={`curl $BASE_URL/api/shares \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
          />
          <CurlExample
            title="Delete a share"
            command={`curl -X DELETE $BASE_URL/api/shares/SHARE_ID \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
          />
        </div>
      </div>

      <Modal open={showCreate} onClose={() => { setShowCreate(false); setNewKeyResult(null); }} title="Create API Key">
        {newKeyResult ? (
          <div className="space-y-4">
            <p className="text-sm text-neutral-700 dark:text-neutral-300">Your API key has been created. Copy it now — you won't be able to see it again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-green-600 dark:text-green-400 bg-neutral-100 dark:bg-neutral-950 px-3 py-2 rounded-lg font-mono break-all">
                {newKeyResult.key}
              </code>
              <Button variant="secondary" size="sm" onClick={copyKey}>
                {copiedKey ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
            <Button onClick={() => downloadShareScript(newKeyResult.key)} variant="secondary" className="w-full">
              <Download size={16} /> Download share.sh
            </Button>
            <Button onClick={() => { setShowCreate(false); setNewKeyResult(null); }} className="w-full" variant="ghost">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Input label="Key name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="My script" autoFocus onKeyDown={(e) => e.key === "Enter" && handleCreate()} />
            <Button onClick={handleCreate} loading={createApiKey.isPending} className="w-full">Create Key</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function downloadShareScript(apiKey: string) {
  const baseUrl = window.location.origin;
  const script = generateShareScript(apiKey, baseUrl);
  const blob = new Blob([script], { type: "application/x-shellscript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "share.sh";
  a.click();
  URL.revokeObjectURL(url);
}

function generateShareScript(apiKey: string, baseUrl: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

API_KEY="${apiKey}"
BASE_URL="${baseUrl}"

# ── Colors ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$'\\e[1m' DIM=$'\\e[2m' RESET=$'\\e[0m'
  GREEN=$'\\e[32m' CYAN=$'\\e[36m' RED=$'\\e[31m' YELLOW=$'\\e[33m'
else
  BOLD="" DIM="" RESET="" GREEN="" CYAN="" RED="" YELLOW=""
fi

# ── Helpers ─────────────────────────────────────────────────────────────────
die() { printf "%s%serror:%s %s\\n" "" "\${RED}" "\${RESET}" "$1" >&2; exit 1; }

check_deps() {
  command -v curl >/dev/null 2>&1 || die "curl is required but not installed"
  command -v jq   >/dev/null 2>&1 || die "jq is required but not installed (brew install jq)"
}

api_post() {
  local path="$1" data="$2"
  local resp
  resp=$(curl -sf -X POST "\${BASE_URL}\${path}" \\
    -H "Authorization: Bearer \${API_KEY}" \\
    -H "Content-Type: application/json" \\
    -d "$data" 2>/dev/null) || die "API request failed: POST \${path}"
  local ok
  ok=$(echo "$resp" | jq -r '.success // false')
  if [ "$ok" != "true" ]; then
    local msg
    msg=$(echo "$resp" | jq -r '.error.message // "Unknown error"')
    die "$msg"
  fi
  echo "$resp" | jq -r '.data'
}

api_get() {
  local path="$1"
  local resp
  resp=$(curl -sf "\${BASE_URL}\${path}" \\
    -H "Authorization: Bearer \${API_KEY}" 2>/dev/null) || die "API request failed: GET \${path}"
  echo "$resp"
}

api_delete() {
  local path="$1"
  local resp
  resp=$(curl -sf -X DELETE "\${BASE_URL}\${path}" \\
    -H "Authorization: Bearer \${API_KEY}" 2>/dev/null) || die "API request failed: DELETE \${path}"
  local ok
  ok=$(echo "$resp" | jq -r '.success // false')
  if [ "$ok" != "true" ]; then
    local msg
    msg=$(echo "$resp" | jq -r '.error.message // "Unknown error"')
    die "$msg"
  fi
  echo "$resp"
}

api_put_file() {
  local path="$1" file="$2"
  local resp
  resp=$(curl -sf -X PUT "\${BASE_URL}\${path}" \\
    -H "Authorization: Bearer \${API_KEY}" \\
    --data-binary "@\${file}" 2>/dev/null) || die "File upload failed"
  echo "$resp"
}

api_put_chunk() {
  local path="$1"
  local resp
  resp=$(curl -sf -X PUT "\${BASE_URL}\${path}" \\
    -H "Authorization: Bearer \${API_KEY}" \\
    --data-binary @- 2>/dev/null) || die "Chunk upload failed"
  echo "$resp"
}

human_size() {
  local bytes="$1"
  if [ "$bytes" -ge 1073741824 ]; then
    printf "%.1f GB" "$(echo "$bytes / 1073741824" | bc -l)"
  elif [ "$bytes" -ge 1048576 ]; then
    printf "%.1f MB" "$(echo "$bytes / 1048576" | bc -l)"
  elif [ "$bytes" -ge 1024 ]; then
    printf "%.1f KB" "$(echo "$bytes / 1024" | bc -l)"
  else
    printf "%d B" "$bytes"
  fi
}

progress_bar() {
  local current="$1" total="$2" filename="$3"
  local width=30
  local pct=$((current * 100 / total))
  local filled=$((current * width / total))
  local empty=$((width - filled))
  local bar=""
  local i=0
  while [ "$i" -lt "$filled" ]; do bar+="█"; i=$((i + 1)); done
  i=0
  while [ "$i" -lt "$empty" ]; do bar+="░"; i=$((i + 1)); done
  printf "  %s%s%s %s[%s]%s %s / %s  %s(%d%%)%s\\r" \\
    "\${BOLD}" "$filename" "\${RESET}" \\
    "\${CYAN}" "$bar" "\${RESET}" \\
    "$(human_size "$current")" "$(human_size "$total")" \\
    "\${DIM}" "$pct" "\${RESET}" >&2
}

detect_mime() {
  local f="$1"
  if command -v file >/dev/null 2>&1; then
    file -b --mime-type "$f" 2>/dev/null || echo "application/octet-stream"
  else
    echo "application/octet-stream"
  fi
}

output_url() {
  local slug="$1" share_type="$2" title="\${3:-}"
  local url="\${BASE_URL}/s/\${slug}"
  if [ -t 1 ]; then
    echo ""
    printf "  \${GREEN}\${BOLD}✓\${RESET} \${BOLD}%s\${RESET} shared" "$share_type"
    [ -n "$title" ] && printf " — \${CYAN}%s\${RESET}" "$title"
    echo ""
    printf "  \${DIM}→\${RESET} \${BOLD}%s\${RESET}\\n\\n" "$url"
  else
    printf "%s\\n" "$url"
  fi
}

# ── Expiry parsing ─────────────────────────────────────────────────────────
parse_expiry() {
  local val="$1"
  case "$val" in
    never|none) echo "" ;;
    *d) local n="\${val%d}"
        date -u -v+"\${n}"d "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \\
          || date -u -d "+\${n} days" "+%Y-%m-%dT%H:%M:%SZ" ;;
    *w) local n="\${val%w}"; local days=$((n * 7))
        date -u -v+"\${days}"d "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \\
          || date -u -d "+\${days} days" "+%Y-%m-%dT%H:%M:%SZ" ;;
    *h) local n="\${val%h}"
        date -u -v+"\${n}"H "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \\
          || date -u -d "+\${n} hours" "+%Y-%m-%dT%H:%M:%SZ" ;;
    *)  echo "$val" ;;
  esac
}

# ── Shared option parsing ───────────────────────────────────────────────────
parse_common_opts() {
  TITLE="" COMMENT="" EXPIRES="90d" MAX_HITS="" SLUG=""
  while [ \$# -gt 0 ]; do
    case "$1" in
      -t|--title)    TITLE="$2";    shift 2 ;;
      -c|--comment)  COMMENT="$2";  shift 2 ;;
      -e|--expires)  EXPIRES="$2";  shift 2 ;;
      -m|--max-hits) MAX_HITS="$2"; shift 2 ;;
      -s|--slug)     SLUG="$2";     shift 2 ;;
      *)             EXTRA_ARGS+=("$1"); shift ;;
    esac
  done
}

json_common() {
  local parts=""
  [ -n "$TITLE" ]    && parts+=", \\"title\\": $(printf '%s' "$TITLE" | jq -Rs .)"
  [ -n "$COMMENT" ]  && parts+=", \\"comment\\": $(printf '%s' "$COMMENT" | jq -Rs .)"
  [ -n "$MAX_HITS" ] && parts+=", \\"max_hits\\": $MAX_HITS"

  # Custom slug
  if [ -n "$SLUG" ]; then
    parts+=", \\"slug_type\\": \\"custom\\", \\"custom_slug\\": $(printf '%s' "$SLUG" | jq -Rs .)"
  fi

  # Expiry (default 90d, -e never to disable)
  local iso_expiry
  iso_expiry=$(parse_expiry "$EXPIRES")
  [ -n "$iso_expiry" ] && parts+=", \\"expires_at\\": \\"$iso_expiry\\""

  echo "$parts"
}

# ── Commands ────────────────────────────────────────────────────────────────
cmd_link() {
  EXTRA_ARGS=()
  parse_common_opts "$@"
  [ "\${#EXTRA_ARGS[@]}" -eq 0 ] && die "Usage: share link <url> [-t title] [-c comment]"

  local url="\${EXTRA_ARGS[0]}"
  local common
  common=$(json_common)
  local payload="{\\"url\\": $(printf '%s' "$url" | jq -Rs .)$common}"

  local result
  result=$(api_post "/api/shares/links" "$payload")
  local slug
  slug=$(echo "$result" | jq -r '.slug')

  output_url "$slug" "Link" "$TITLE"
}

cmd_markdown() {
  EXTRA_ARGS=()
  parse_common_opts "$@"

  local filepath="\${EXTRA_ARGS[0]:-}"
  local content
  if [ -n "$filepath" ]; then
    [ -f "$filepath" ] || die "File not found: $filepath"
    content=$(cat "$filepath")
  elif [ ! -t 0 ]; then
    content=$(cat)
  else
    die "Usage: share markdown <file> [-t title]\\n       cat doc.md | share markdown"
  fi

  local common
  common=$(json_common)
  local payload="{\\"content\\": $(printf '%s' "$content" | jq -Rs .)$common}"

  local result
  result=$(api_post "/api/shares/markdown" "$payload")
  local slug
  slug=$(echo "$result" | jq -r '.slug')

  output_url "$slug" "Markdown" "\${TITLE:-\${filepath:+$(basename "$filepath")}}"
}

cmd_code() {
  local LANGUAGE=""
  EXTRA_ARGS=()
  local args=()
  while [ \$# -gt 0 ]; do
    case "$1" in
      -l|--language) LANGUAGE="$2"; shift 2 ;;
      *)             args+=("$1");  shift ;;
    esac
  done
  parse_common_opts "\${args[@]+\${args[@]}}"

  local filepath="\${EXTRA_ARGS[0]:-}"
  local content
  if [ -n "$filepath" ]; then
    [ -f "$filepath" ] || die "File not found: $filepath"
    content=$(cat "$filepath")
  elif [ ! -t 0 ]; then
    content=$(cat)
  else
    die "Usage: share code <file> [-l language] [-t title]\\n       echo 'code' | share code -l python"
  fi

  local common
  common=$(json_common)
  local extra=""
  [ -n "$LANGUAGE" ]  && extra+=", \\"language\\": \\"$LANGUAGE\\""
  [ -n "$filepath" ]  && extra+=", \\"filename\\": $(printf '%s' "$(basename "$filepath")" | jq -Rs .)"
  local payload="{\\"content\\": $(printf '%s' "$content" | jq -Rs .)$extra$common}"

  local result
  result=$(api_post "/api/shares/code" "$payload")
  local slug
  slug=$(echo "$result" | jq -r '.slug')

  output_url "$slug" "Code" "\${TITLE:-\${filepath:+$(basename "$filepath")}}"
}

CHUNK_SIZE=$((10 * 1024 * 1024))  # 10 MB per chunk
MULTIPART_THRESHOLD=$((95 * 1024 * 1024))  # Use multipart above 95 MB

upload_simple() {
  local filepath="$1" upload_id="$2" size="\${3:-0}" filename="\${4:-}"
  if [ -t 2 ] && [ "$size" -gt 0 ]; then
    local bs=262144
    local total_chunks=$(( (size + bs - 1) / bs ))
    local i=0 sent=0
    (
      while [ "$i" -lt "$total_chunks" ]; do
        dd if="$filepath" bs="$bs" skip="$i" count=1 2>/dev/null
        sent=$(( (i + 1) * bs ))
        [ "$sent" -gt "$size" ] && sent="$size"
        progress_bar "$sent" "$size" "$filename"
        i=$((i + 1))
      done
    ) | curl -sf -X PUT "\${BASE_URL}/api/upload/file/\${upload_id}" \\
        -H "Authorization: Bearer \${API_KEY}" \\
        --data-binary @- >/dev/null 2>/dev/null || die "File upload failed"
  else
    api_put_file "/api/upload/file/\${upload_id}" "$filepath" >/dev/null
  fi
}

upload_multipart() {
  local filepath="$1" filename="$2" mime="$3" size="$4"

  # Init multipart
  local init_payload="{\\"filename\\": $(printf '%s' "$filename" | jq -Rs .), \\"contentType\\": \\"$mime\\"}"
  local init
  init=$(api_post "/api/upload/presign-multipart" "$init_payload")
  local upload_id r2_key
  upload_id=$(echo "$init" | jq -r '.uploadId')
  r2_key=$(echo "$init" | jq -r '.r2_key // .r2Key')

  # Upload chunks
  local part_num=0 uploaded=0
  local parts="["
  local total_chunks=$(( (size + CHUNK_SIZE - 1) / CHUNK_SIZE ))

  [ -t 2 ] && progress_bar 0 "$size" "$filename"

  while [ "$part_num" -lt "$total_chunks" ]; do
    local part_resp
    part_resp=$(dd if="$filepath" bs="$CHUNK_SIZE" skip="$part_num" count=1 2>/dev/null | api_put_chunk "/api/upload/multipart-part/\${upload_id}/$((part_num + 1))")
    local ok
    ok=$(echo "$part_resp" | jq -r '.success // false')
    if [ "$ok" != "true" ]; then
      [ -t 2 ] && echo >&2
      die "Chunk upload failed (part $((part_num + 1)))"
    fi
    local etag
    etag=$(echo "$part_resp" | jq -r '.data.etag')

    [ "$part_num" -gt 0 ] && parts+=","
    part_num=$((part_num + 1))
    parts+="{\\"partNumber\\": $part_num, \\"etag\\": \\"$etag\\"}"

    uploaded=$((part_num * CHUNK_SIZE))
    [ "$uploaded" -gt "$size" ] && uploaded=$size
    [ -t 2 ] && progress_bar "$uploaded" "$size" "$filename"
  done
  parts+="]"

  if [ -t 2 ]; then
    printf "\\r\\033[K" >&2
  fi

  # Complete multipart
  local complete_payload="{\\"uploadId\\": \\"$upload_id\\", \\"r2Key\\": $(printf '%s' "$r2_key" | jq -Rs .), \\"parts\\": $parts}"
  api_post "/api/upload/complete-multipart" "$complete_payload" >/dev/null

  # Return r2_key for share creation
  printf '%s' "$r2_key"
}

cmd_file() {
  local FILENAME=""
  EXTRA_ARGS=()
  local args=()
  while [ \$# -gt 0 ]; do
    case "$1" in
      -n|--name) FILENAME="$2"; shift 2 ;;
      *)         args+=("$1");  shift ;;
    esac
  done
  parse_common_opts "\${args[@]+\${args[@]}}"

  local filepath="\${EXTRA_ARGS[0]:-}"
  local tmpfile=""

  if [ -n "$filepath" ]; then
    [ -f "$filepath" ] || die "File not found: $filepath"
    [ -z "$FILENAME" ] && FILENAME=$(basename "$filepath")
  elif [ ! -t 0 ]; then
    tmpfile=$(mktemp)
    cat > "$tmpfile"
    filepath="$tmpfile"
    [ -z "$FILENAME" ] && FILENAME="stdin"
  else
    die "Usage: share file <path> [-t title]\\n       cat data | share file -n data.bin"
  fi

  local mime
  mime=$(detect_mime "$filepath")
  local size
  size=$(wc -c < "$filepath" | tr -d ' ')

  local r2_key

  if [ "$size" -gt "$MULTIPART_THRESHOLD" ]; then
    # Large file → multipart upload
    r2_key=$(upload_multipart "$filepath" "$FILENAME" "$mime" "$size")
  else
    # Small file → single upload
    local presign_payload="{\\"filename\\": $(printf '%s' "$FILENAME" | jq -Rs .), \\"contentType\\": \\"$mime\\", \\"size\\": $size}"
    local presign
    presign=$(api_post "/api/upload/presign" "$presign_payload")
    local upload_id
    upload_id=$(echo "$presign" | jq -r '.uploadId')
    r2_key=$(echo "$presign" | jq -r '.r2_key // .r2Key')

    upload_simple "$filepath" "$upload_id" "$size" "$FILENAME"
  fi

  if [ -t 2 ]; then
    printf "\\r\\033[K" >&2
  fi

  # Create share
  local common
  common=$(json_common)
  local share_payload="{\\"filename\\": $(printf '%s' "$FILENAME" | jq -Rs .), \\"content_type\\": \\"$mime\\", \\"size\\": $size, \\"r2_key\\": $(printf '%s' "$r2_key" | jq -Rs .)$common}"
  local result
  result=$(api_post "/api/shares/files" "$share_payload")
  local slug
  slug=$(echo "$result" | jq -r '.slug')

  [ -n "$tmpfile" ] && rm -f "$tmpfile"
  output_url "$slug" "File" "\${TITLE:-$FILENAME}"
}

cmd_list() {
  local page=1 type_filter="" count=20
  local search_args=()
  while [ \$# -gt 0 ]; do
    case "$1" in
      -p|--page)  page="$2";        shift 2 ;;
      -T|--type)  type_filter="$2";  shift 2 ;;
      -n|--count) count="$2";        shift 2 ;;
      *)          search_args+=("$1"); shift ;;
    esac
  done

  local query="page=\${page}&per_page=\${count}"
  [ -n "$type_filter" ] && query+="&type=\${type_filter}"
  [ "\${#search_args[@]}" -gt 0 ] && query+="&search=$(printf '%s' "\${search_args[0]}" | jq -Rr @uri)"

  local resp
  resp=$(api_get "/api/shares?\${query}")

  if [ -t 1 ]; then
    local total page_num
    total=$(echo "$resp" | jq -r '.meta.total')
    page_num=$(echo "$resp" | jq -r '.meta.page')
    local count_shown
    count_shown=$(echo "$resp" | jq -r '.data | length')

    if [ "$count_shown" -eq 0 ]; then
      printf "\\n  \${DIM}No shares found.\${RESET}\\n\\n"
      return
    fi

    printf "\\n  \${BOLD}%-8s %-20s %-28s %6s  %s\${RESET}\\n" "TYPE" "SLUG" "TITLE" "VIEWS" "CREATED"
    printf "  \${DIM}%-8s %-20s %-28s %6s  %s\${RESET}\\n" "────────" "────────────────────" "────────────────────────────" "──────" "──────────"

    echo "$resp" | jq -r '.data[] | [.type, .slug, (.title // "—"), (.hits | tostring), .created_at[:10]] | @tsv' | while IFS=\$'\\t' read -r t s title h created; do
      local color=""
      case "$t" in
        link)     color="\${CYAN}" ;;
        markdown) color="\${GREEN}" ;;
        code)     color="\${YELLOW}" ;;
        *)        color="" ;;
      esac
      local td="\${title:0:28}"
      local pad=$((28 - \${#td}))
      printf -v td '%s%*s' "$td" "$pad" ""
      printf "  %s%-8s\${RESET} %-20s %s %6s  \${DIM}%s\${RESET}\\n" "$color" "$t" "\${s:0:20}" "$td" "$h" "$created"
    done

    printf "\\n  \${DIM}%s shares · page %s\${RESET}\\n\\n" "$total" "$page_num"
  else
    echo "$resp" | jq -r '.data[] | .slug'
  fi
}

cmd_delete() {
  [ \$# -eq 0 ] && die "Usage: share delete <slug>"
  local slug="$1"

  # Find the share by slug
  local resp
  resp=$(api_get "/api/shares?search=\${slug}&per_page=100")
  local share_id
  share_id=$(echo "$resp" | jq -r --arg slug "$slug" '.data[] | select(.slug == \$slug) | .id')

  [ -z "$share_id" ] && die "Share not found: $slug"

  # Confirm unless piped
  if [ -t 0 ] && [ -t 1 ]; then
    printf "  Delete share \${BOLD}%s\${RESET}? [y/N] " "$slug"
    read -r confirm
    [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && { echo "  Cancelled."; exit 0; }
  fi

  api_delete "/api/shares/\${share_id}" >/dev/null

  if [ -t 1 ]; then
    printf "\\n  \${GREEN}\${BOLD}✓\${RESET} Deleted \${BOLD}%s\${RESET}\\n\\n" "$slug"
  fi
}

cmd_help() {
  cat <<HELP
\${BOLD}share\${RESET} — CLI for OWG Share (\${DIM}\${BASE_URL}\${RESET})

\${BOLD}USAGE\${RESET}
  share <command> [file] [options]

\${BOLD}COMMANDS\${RESET}
  \${GREEN}link\${RESET} <url>                Share a URL redirect
  \${GREEN}markdown\${RESET} [file]           Share markdown (file or stdin)
  \${GREEN}code\${RESET} [file] [-l lang]      Share code (file or stdin)
  \${GREEN}file\${RESET} [path]                Upload and share a file (path or stdin)
  \${GREEN}list\${RESET} [search]             List shares (with optional search)
  \${GREEN}delete\${RESET} <slug>              Delete a share by slug
  \${GREEN}help\${RESET}                       Show this help

\${BOLD}OPTIONS\${RESET}
  -t, --title <title>     Set share title
  -c, --comment <text>    Add internal comment
  -s, --slug <slug>       Set a custom slug (vanity URL)
  -e, --expires <when>    Set expiration (default: 90d)
                          Formats: 90d, 2w, 24h, never, or ISO 8601
  -m, --max-hits <n>      Set maximum view count
  -l, --language <lang>   Set language (code only)
  -n, --name <filename>   Override filename (file only, useful with stdin)

\${BOLD}LIST OPTIONS\${RESET}
  -p, --page <n>          Page number (default: 1)
  -T, --type <type>       Filter by type (link, markdown, code, file, gallery)
  -n, --count <n>         Results per page (default: 20)

\${BOLD}EXAMPLES\${RESET}
  share link https://example.com -t "Example"
  share link https://example.com -s my-link       \${DIM}# custom slug\${RESET}
  share markdown README.md -e 7d                  \${DIM}# expires in 7 days\${RESET}
  share code main.py -l python -e never            \${DIM}# no expiry\${RESET}
  share file photo.jpg -t "Vacation photo"
  echo "hello world" | share markdown
  cat backup.tar.gz | share file -n backup.tar.gz
  share list                                       \${DIM}# list recent shares\${RESET}
  share list -T code                               \${DIM}# list code shares only\${RESET}
  share delete abc123                              \${DIM}# delete by slug\${RESET}
  share link https://x.com/post | pbcopy           \${DIM}# pipe-friendly output\${RESET}
HELP
}

# ── Main ────────────────────────────────────────────────────────────────────
check_deps

cmd="\${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  link)     cmd_link "$@" ;;
  markdown|md) cmd_markdown "$@" ;;
  code)     cmd_code "$@" ;;
  file)     cmd_file "$@" ;;
  list|ls)  cmd_list "$@" ;;
  delete|rm) cmd_delete "$@" ;;
  help|-h|--help) cmd_help ;;
  *)        die "Unknown command: $cmd. Run 'share help' for usage." ;;
esac
`;
}

function CurlExample({ title, command }: { title: string; command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{title}</span>
        <button onClick={copy} className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto whitespace-pre">{command}</pre>
    </div>
  );
}
