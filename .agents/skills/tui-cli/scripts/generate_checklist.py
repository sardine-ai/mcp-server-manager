#!/usr/bin/env python3
"""
TUI + CLI Parity Checklist Generator
Automatically detects modified files and generates parity checklist
"""

import subprocess
import os
import sys
from pathlib import Path
from typing import List, Set, Dict

def run_git(cmd: str) -> str:
    """Run git command and return output"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, cwd=os.getcwd()
        )
        return result.stdout.strip()
    except Exception as e:
        print(f"Error running git command: {e}", file=sys.stderr)
        return ""

def get_current_branch() -> str:
    """Get current git branch"""
    return run_git("git rev-parse --abbrev-ref HEAD")

def get_modified_files() -> Set[str]:
    """Get all modified files (staged + unstaged)"""
    current_branch = get_current_branch()

    # If on feature branch, get diff with main (most important)
    if current_branch != "main" and current_branch != "HEAD":
        main_diff = set(run_git(f"git diff --name-only main..HEAD").split("\n"))
        result = main_diff - {""}
        # Also add any staged/unstaged changes
        if not result:  # If no diff with main, check local changes
            staged = set(run_git("git diff --cached --name-only").split("\n"))
            unstaged = set(run_git("git diff --name-only").split("\n"))
            result = (staged | unstaged) - {""}
        return result

    # On main, just show staged + unstaged
    staged = set(run_git("git diff --cached --name-only").split("\n"))
    unstaged = set(run_git("git diff --name-only").split("\n"))
    return (staged | unstaged) - {""}

def extract_feature_from_path(filepath: str) -> str:
    """Extract feature name from file path"""
    parts = filepath.split("/")

    if len(parts) < 2:
        return "unknown"

    if "cli/commands" in filepath:
        # src/cli/commands/server.cmd.ts -> server
        return parts[-1].split(".")[0].replace(".cmd", "")
    elif "tui/screens" in filepath:
        # src/tui/screens/servers.screen.ts -> servers
        return parts[-1].split(".")[0].replace(".screen", "")
    elif "services" in filepath:
        # src/services/index.ts -> services-index (skip, it's a re-export)
        if parts[-1] == "index.ts":
            return "services-index"
        # src/services/config.service.ts -> config
        return parts[-1].split(".")[0].replace(".service", "")
    elif "tui/index" in filepath:
        return "tui-main"
    elif "tests" in filepath:
        # tests/parity.test.ts -> parity
        return parts[-1].split(".")[0].replace(".test", "")
    elif "shared/features.ts" in filepath:
        return "feature-registry"

    return "unknown"

def categorize_file(filepath: str) -> str:
    """Categorize file type"""
    if "cli/commands" in filepath:
        return "CLI"
    elif "tui/screens" in filepath or "tui/index" in filepath:
        return "TUI"
    elif "services" in filepath:
        return "Logic"
    elif "shared/features.ts" in filepath:
        return "Registry"
    elif "tests" in filepath:
        return "Tests"
    return "Other"

def generate_checklist(modified_files: List[str]) -> str:
    """Generate checklist based on modified files"""
    if not modified_files:
        return "## Status\n\n✅ No changes detected - nothing needs to be done\n"

    # Filter out non-feature files
    source_files = []
    other_files = []

    for filepath in modified_files:
        if any(
            pattern in filepath
            for pattern in [
                "src/cli/commands/",
                "src/tui/screens/",
                "src/tui/index.ts",
                "src/services/",
                "src/shared/features.ts",
                "tests/",
            ]
        ):
            source_files.append(filepath)
        else:
            other_files.append(filepath)

    # Group files by feature (excluding re-export index files)
    features: Dict[str, List[tuple]] = {}

    for filepath in source_files:
        feature = extract_feature_from_path(filepath)

        # Skip index re-export files
        if feature in ["services-index", "index"]:
            continue

        category = categorize_file(filepath)

        if feature not in features:
            features[feature] = []
        features[feature].append((category, filepath))

    # Build output
    output = "## Status\n\n"
    output += f"🔍 Detected {len(source_files)} source file(s) across {len(features)} feature(s)\n"
    if other_files:
        output += f"📦 Also modified: {', '.join([f'`{f}`' for f in sorted(other_files)])} (config/deps)\n\n"
    else:
        output += "\n"

    output += "### Modified Files by Feature\n\n"

    for feature in sorted(features.keys()):
        files = features[feature]
        output += f"**{feature.upper()}**\n"
        for category, filepath in files:
            output += f"  - [{category}] `{filepath}`\n"
        output += "\n"

    # Generate checklists for each feature
    output += "---\n\n"
    output += "## Parity Checklists\n\n"

    for feature in sorted(features.keys()):
        files = features[feature]
        has_cli = any(cat == "CLI" for cat, _ in files)
        has_tui = any(cat == "TUI" for cat, _ in files)
        has_logic = any(cat == "Logic" for cat, _ in files)
        has_registry = any(cat == "Registry" for cat, _ in files)
        has_tests = any(cat == "Tests" for cat, _ in files)

        output += f"### Feature: `{feature}`\n\n"

        if has_logic:
            output += "#### 1. Shared Logic Module\n\n"
            output += "- [ ] Business logic is in `src/services/` or `src/shared/`\n"
            output += "- [ ] Function is exported and can be used by CLI and TUI\n"
            output += "- [ ] I/O is kept separate from core logic\n\n"

        if has_cli or has_logic:
            output += "#### 2. CLI Implementation\n\n"
            output += "- [ ] Command exists in `src/cli/commands/`\n"
            output += "- [ ] Supports `--json` flag if applicable\n"
            output += "- [ ] Supports `-y`/`--force` flag if applicable\n"
            output += "- [ ] Help text is documented\n\n"

        if has_tui or has_logic:
            output += "#### 3. TUI Implementation\n\n"
            output += "- [ ] Screen/handler exists in `src/tui/`\n"
            output += "- [ ] Keyboard shortcuts documented in main TUI\n"
            output += "- [ ] State management is consistent with CLI\n"
            output += "- [ ] Raw mode toggle handled properly\n\n"

        if has_registry:
            output += "#### 4. Feature Registry\n\n"
            output += "- [ ] Feature added/updated in `src/shared/features.ts`\n"
            output += "- [ ] `id`, `name`, `category` are defined\n"
            output += "- [ ] `cliCommands` and `tuiImplementation` are listed\n\n"

        if has_tests or (has_cli and has_tui):
            output += "#### 5. Testing & Parity\n\n"
            output += "- [ ] Run `npm test` to verify CLI/TUI parity\n"
            output += "- [ ] Feature appears in both CLI and TUI implementations\n"
            output += "- [ ] Behavior is consistent across interfaces\n\n"

        output += "---\n\n"

    return output

def main():
    """Main entry point"""
    current_branch = get_current_branch()

    # Check if we're on main
    if current_branch == "main" or current_branch == "HEAD":
        # On main, show diff only
        modified_files = list(get_modified_files())
        output = generate_checklist(modified_files)
    else:
        # On feature branch, show diff with main
        modified_files = list(get_modified_files())
        output = f"## Branch\n\n🌿 Current branch: `{current_branch}`\n\n"
        output += generate_checklist(modified_files)

    print(output)

if __name__ == "__main__":
    main()
