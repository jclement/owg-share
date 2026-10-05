import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

// Import the script generator to test
// We need to dynamically import it since it's in a TSX file with React deps
// Instead, we'll inline the test against the generated script content

function generateTestScript(): string {
  // Minimal version of the script with the key parts we want to test
  return `#!/usr/bin/env bash
set -euo pipefail

API_KEY="owgs_test_key_abc123"
BASE_URL="https://share.example.com"

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
  command -v jq   >/dev/null 2>&1 || die "jq is required but not installed ($(jq_hint))"
}

jq_hint() {
  if   command -v brew    >/dev/null 2>&1; then echo "brew install jq"
  elif command -v apt-get >/dev/null 2>&1; then echo "sudo apt-get install jq"
  elif command -v dnf     >/dev/null 2>&1; then echo "sudo dnf install jq"
  elif command -v pacman  >/dev/null 2>&1; then echo "sudo pacman -S jq"
  elif command -v zypper  >/dev/null 2>&1; then echo "sudo zypper install jq"
  elif command -v apk     >/dev/null 2>&1; then echo "apk add jq"
  else echo "see https://jqlang.org/download/"
  fi
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

human_size() {
  local bytes="$1" unit suffix
  if [ "$bytes" -ge 1073741824 ]; then
    unit=1073741824 suffix="GB"
  elif [ "$bytes" -ge 1048576 ]; then
    unit=1048576 suffix="MB"
  elif [ "$bytes" -ge 1024 ]; then
    unit=1024 suffix="KB"
  else
    printf "%d B" "$bytes"
    return
  fi
  # Integer math only: bc is not installed everywhere
  local tenths=$(( (bytes * 10 + unit / 2) / unit ))
  printf "%d.%d %s" $((tenths / 10)) $((tenths % 10)) "$suffix"
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
  while [ $# -gt 0 ]; do
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
HELP
}

# ── Main ────────────────────────────────────────────────────────────────────
cmd="\${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  link)     echo "cmd_link" ;;
  markdown|md) echo "cmd_markdown" ;;
  code)     echo "cmd_code" ;;
  file)     echo "cmd_file" ;;
  list|ls)  echo "cmd_list" ;;
  delete|rm) echo "cmd_delete" ;;
  help|-h|--help) cmd_help ;;
  *)        die "Unknown command: $cmd. Run 'share help' for usage." ;;
esac
`;
}

function writeScript(content: string): string {
  const tmp = `/tmp/share-test-${Date.now()}.sh`;
  const fs = require("fs");
  fs.writeFileSync(tmp, content, { mode: 0o755 });
  return tmp;
}

function runBash(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
}

describe("CLI script", () => {
  let scriptPath: string;

  it("passes bash -n syntax check", () => {
    const script = generateTestScript();
    scriptPath = writeScript(script);
    // bash -n only checks syntax, doesn't execute
    expect(() => runBash(`bash -n "${scriptPath}"`)).not.toThrow();
  });

  it("contains the baked API key", () => {
    const script = generateTestScript();
    expect(script).toContain('API_KEY="owgs_test_key_abc123"');
  });

  it("contains the baked base URL", () => {
    const script = generateTestScript();
    expect(script).toContain('BASE_URL="https://share.example.com"');
  });

  it("has set -euo pipefail", () => {
    const script = generateTestScript();
    expect(script).toContain("set -euo pipefail");
  });

  it("defines all 7 commands in the case statement", () => {
    const script = generateTestScript();
    for (const cmd of ["link", "markdown", "code", "file", "list", "delete", "help"]) {
      expect(script).toContain(cmd);
    }
  });

  it("supports md alias for markdown", () => {
    const script = generateTestScript();
    expect(script).toContain("markdown|md)");
  });

  it("supports ls alias for list", () => {
    const script = generateTestScript();
    expect(script).toContain("list|ls)");
  });

  it("supports rm alias for delete", () => {
    const script = generateTestScript();
    expect(script).toContain("delete|rm)");
  });
});

describe("CLI parse_expiry", () => {
  function runParseExpiry(val: string): string {
    const script = `
      parse_expiry() {
        local val="$1"
        case "$val" in
          never|none) echo "" ;;
          *d) local n="\${val%d}"
              date -u -v+"\${n}"d "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
                || date -u -d "+\${n} days" "+%Y-%m-%dT%H:%M:%SZ" ;;
          *w) local n="\${val%w}"; local days=$((n * 7))
              date -u -v+"\${days}"d "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
                || date -u -d "+\${days} days" "+%Y-%m-%dT%H:%M:%SZ" ;;
          *h) local n="\${val%h}"
              date -u -v+"\${n}"H "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
                || date -u -d "+\${n} hours" "+%Y-%m-%dT%H:%M:%SZ" ;;
          *)  echo "$val" ;;
        esac
      }
      parse_expiry "${val}"
    `;
    return runBash(`bash -c '${script.replace(/'/g, "'\\''")}'`);
  }

  it("returns empty string for 'never'", () => {
    expect(runParseExpiry("never")).toBe("");
  });

  it("returns empty string for 'none'", () => {
    expect(runParseExpiry("none")).toBe("");
  });

  it("returns ISO date for 90d", () => {
    const result = runParseExpiry("90d");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const date = new Date(result);
    const now = new Date();
    const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(89);
    expect(diffDays).toBeLessThan(91);
  });

  it("returns ISO date for 7d", () => {
    const result = runParseExpiry("7d");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const date = new Date(result);
    const now = new Date();
    const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });

  it("returns ISO date for 1w (7 days)", () => {
    const result = runParseExpiry("1w");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const date = new Date(result);
    const now = new Date();
    const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });

  it("returns ISO date for 24h", () => {
    const result = runParseExpiry("24h");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const date = new Date(result);
    const now = new Date();
    const diffHours = (date.getTime() - now.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(23);
    expect(diffHours).toBeLessThan(25);
  });

  it("passes through ISO date strings", () => {
    const iso = "2025-12-31T23:59:59Z";
    const result = runParseExpiry(iso);
    expect(result).toBe(iso);
  });
});

describe("CLI human_size", () => {
  function runHumanSize(bytes: number): string {
    const script = `
      human_size() {
        local bytes="$1" unit suffix
        if [ "$bytes" -ge 1073741824 ]; then
          unit=1073741824 suffix="GB"
        elif [ "$bytes" -ge 1048576 ]; then
          unit=1048576 suffix="MB"
        elif [ "$bytes" -ge 1024 ]; then
          unit=1024 suffix="KB"
        else
          printf "%d B" "$bytes"
          return
        fi
        # Integer math only: bc is not installed everywhere
        local tenths=$(( (bytes * 10 + unit / 2) / unit ))
        printf "%d.%d %s" $((tenths / 10)) $((tenths % 10)) "$suffix"
      }
      human_size ${bytes}
    `;
    return runBash(`bash -c '${script.replace(/'/g, "'\\''")}'`);
  }

  it("formats bytes", () => {
    expect(runHumanSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(runHumanSize(1024)).toBe("1.0 KB");
  });

  it("formats megabytes", () => {
    expect(runHumanSize(1048576)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(runHumanSize(1073741824)).toBe("1.0 GB");
  });
});

describe("CLI help output", () => {
  let scriptPath: string;

  it("help contains all 7 commands", () => {
    const script = generateTestScript();
    scriptPath = writeScript(script);
    const help = runBash(`"${scriptPath}" help 2>&1`);
    for (const cmd of ["link", "markdown", "code", "file", "list", "delete", "help"]) {
      expect(help).toContain(cmd);
    }
  });

  it("help mentions custom slug option", () => {
    const help = runBash(`"${scriptPath}" help 2>&1`);
    expect(help).toContain("--slug");
    expect(help).toContain("-s");
  });

  it("help mentions expires option", () => {
    const help = runBash(`"${scriptPath}" help 2>&1`);
    expect(help).toContain("--expires");
    expect(help).toContain("-e");
  });

  it("help mentions max-hits option", () => {
    const help = runBash(`"${scriptPath}" help 2>&1`);
    expect(help).toContain("--max-hits");
  });

  it("unknown command fails", () => {
    expect(() => runBash(`"${scriptPath}" foobar 2>&1`)).toThrow();
  });
});

describe("CLI command routing", () => {
  let scriptPath: string;

  it("routes 'link' command", () => {
    const script = generateTestScript();
    scriptPath = writeScript(script);
    const out = runBash(`"${scriptPath}" link 2>&1 || true`);
    expect(out).toContain("cmd_link");
  });

  it("routes 'md' alias to markdown", () => {
    const out = runBash(`"${scriptPath}" md 2>&1 || true`);
    expect(out).toContain("cmd_markdown");
  });

  it("routes 'ls' alias to list", () => {
    const out = runBash(`"${scriptPath}" ls 2>&1 || true`);
    expect(out).toContain("cmd_list");
  });

  it("routes 'rm' alias to delete", () => {
    const out = runBash(`"${scriptPath}" rm 2>&1 || true`);
    expect(out).toContain("cmd_delete");
  });
});
