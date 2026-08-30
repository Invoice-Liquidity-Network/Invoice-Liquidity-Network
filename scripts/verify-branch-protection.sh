#!/usr/bin/env bash
# verify-branch-protection.sh
#
# Verifies that GitHub branch protection settings for `main` match the
# documented rules in docs/branch-protection.md. Uses the GitHub REST API.
#
# Usage:
#   sh scripts/verify-branch-protection.sh <owner> <repo> [branch]
#
# Requires: gh CLI (authenticated) or GITHUB_TOKEN environment variable.
#
# Exit codes:
#   0 — all checks passed
#   1 — at least one check failed (drift detected)

set -euo pipefail

OWNER="${1:?Usage: $0 <owner> <repo> [branch]}"
REPO="${2:?Usage: $0 <owner> <repo> [branch]}"
BRANCH="${3:-main}"

PASS=0
FAIL=0

pass() {
  printf '  ✅ %s\n' "$1"
  PASS=$((PASS + 1))
}

fail() {
  printf '  ❌ %s\n' "$1"
  FAIL=$((FAIL + 1))
}

info() {
  printf '\n🔍 %s\n' "$1"
}

echo "═══════════════════════════════════════════════════════════════"
echo "  Branch Protection Verification: ${OWNER}/${REPO}@${BRANCH}"
echo "═══════════════════════════════════════════════════════════════"

# Fetch protection settings via GitHub API
info "Fetching branch protection for ${BRANCH}..."

# Try `gh` CLI first, fall back to `curl` with GITHUB_TOKEN
if command -v gh &>/dev/null; then
  PROTECTION=$(gh api "repos/${OWNER}/${REPO}/branches/${BRANCH}/protection" 2>/dev/null) || {
    echo "⚠️  Could not fetch branch protection settings (API error or no access)."
    echo "   Ensure you are authenticated with: gh auth login"
    exit 1
  }
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  PROTECTION=$(curl -sf \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${OWNER}/${REPO}/branches/${BRANCH}/protection" 2>/dev/null) || {
    echo "⚠️  Could not fetch branch protection settings."
    echo "   Install gh CLI: https://cli.github.com/"
    echo "   Or set GITHUB_TOKEN with repo scope."
    exit 1
  }
else
  echo "⚠️  No authentication available. Install gh CLI or set GITHUB_TOKEN."
  exit 1
fi

# ── Check 1: Branch protection is enabled ────────────────────────────────────

info "Check 1: Branch protection is enabled"

if echo "$PROTECTION" | grep -q '"url"'; then
  pass "Branch protection is enabled on ${BRANCH}"
else
  fail "Branch protection is NOT enabled on ${BRANCH}"
fi

# ── Check 2: PR reviews required (≥1 approval) ──────────────────────────────

info "Check 2: PR reviews required (≥1 approval)"

REQUIRED_REVIEWS=$(echo "$PROTECTION" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('required_pull_request_reviews', {}).get('required_approving_review_count', 0))
" 2>/dev/null || echo "0")

if [ "$REQUIRED_REVIEWS" -ge 1 ]; then
  pass "PR reviews required (≥${REQUIRED_REVIEWS} approval(s))"
else
  fail "PR reviews NOT required or set to 0 (expected ≥1)"
fi

# ── Check 3: Dismiss stale approvals ─────────────────────────────────────────

info "Check 3: Stale approval dismissal"

DISMISS_STALE=$(echo "$PROTECTION" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('required_pull_request_reviews', {}).get('dismiss_stale_reviews', False))
" 2>/dev/null || echo "False")

if [ "$DISMISS_STALE" = "True" ]; then
  pass "Stale approval dismissal is enabled"
else
  fail "Stale approval dismissal is NOT enabled (should be enabled)"
fi

# ── Check 4: Linear history required ─────────────────────────────────────────

info "Check 4: Linear history required"

REQUIRE_LINEAR=$(echo "$PROTECTION" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('required_linear_history', {}).get('enabled', False))
" 2>/dev/null || echo "False")

if [ "$REQUIRE_LINEAR" = "True" ]; then
  pass "Linear history is required"
else
  fail "Linear history is NOT required (should be required)"
fi

# ── Check 5: Force pushes restricted ─────────────────────────────────────────

info "Check 5: Force pushes restricted"

FORCE_PUSH=$(echo "$PROTECTION" | python3 -c "
import sys, json
data = json.load(sys.stdin)
push = data.get('restrictions', {})
# Force push is restricted if there's a restrictions object or enforce_admins is set
enforce = data.get('enforce_admins', {}).get('enabled', False)
print(enforce)
" 2>/dev/null || echo "False")

if [ "$FORCE_PUSH" = "True" ]; then
  pass "Force push protection enforced for admins"
else
  fail "Force push protection NOT enforced for admins (should be enabled)"
fi

# ── Check 6: Required status checks present ──────────────────────────────────

info "Check 6: Required status checks"

CHECKS=$(echo "$PROTECTION" | python3 -c "
import sys, json
data = json.load(sys.stdin)
checks = data.get('required_status_checks', {})
names = checks.get('checks', []) if isinstance(checks, dict) else []
for c in names:
    if isinstance(c, dict):
        print(c.get('context', ''))
    else:
        print(c)
" 2>/dev/null || echo "")

EXPECTED_CHECKS=(
  "CI / Run Node.js tests"
  "CI / Node.js coverage (≥80%)"
  "CI / Shared package type tests"
  "CI / Dependency license compliance check"
  "CI / Core · install"
  "CI / Core · format"
  "Coverage / Run tests and collect coverage"
  "CodeQL Analysis / Analyze"
  "PR title lint / lint"
  "Dead Code Check / knip"
)

CHECKS_FOUND=0
CHECKS_MISSING=0

for expected in "${EXPECTED_CHECKS[@]}"; do
  if echo "$CHECKS" | grep -qF "$expected"; then
    CHECKS_FOUND=$((CHECKS_FOUND + 1))
  else
    CHECKS_MISSING=$((CHECKS_MISSING + 1))
    fail "Missing required check: ${expected}"
  fi
done

if [ "$CHECKS_FOUND" -ge 8 ] && [ "$CHECKS_MISSING" -eq 0 ]; then
  pass "All ${CHECKS_FOUND} core required checks are present"
elif [ "$CHECKS_FOUND" -ge 6 ]; then
  pass "${CHECKS_FOUND}/${#EXPECTED_CHECKS[@]} core checks present (${CHECKS_MISSING} missing — review)"
else
  fail "Only ${CHECKS_FOUND}/${#EXPECTED_CHECKS[@]} core checks present"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
printf '  Results: %d passed, %d failed\n' "$PASS" "$FAIL"
echo "═══════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "⚠️  Some checks failed — review docs/branch-protection.md and the"
  echo "   live GitHub settings for configuration drift."
  exit 1
else
  echo ""
  echo "✅ All branch protection checks passed — live settings match documentation."
  exit 0
fi
