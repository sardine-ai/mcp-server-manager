---
name: release-mcpsm
description: Create a new release of mcp-server-manager with GitHub release (CI handles version bump and npm publish)
disable-model-invocation: true
argument-hint: [major|minor|patch]
user-invocable: true
---

# Release mcp-server-manager

Create a new release following semantic versioning. This workflow will:

1. Verify repository state (on main, clean working directory)
2. Calculate the new version
3. Generate release notes from merged PRs
4. Create GitHub release (which triggers CI to bump package.json and publish to npm)

**Important**: The CI workflow (`.github/workflows/publish.yml`) automatically handles:

- Updating `package.json` version
- Committing the version bump to main
- Publishing to npm

You only need to create the GitHub release — everything else is automated.

## Prerequisites Check

Before starting, verify:

```bash
# Must be on main branch
git branch --show-current  # Should output: main

# Working directory must be clean
git status --porcelain  # Should be empty

# Pull latest changes
git pull origin main
```

If not on main or working directory is dirty, STOP and report the issue.

## Version Bump Type

The release type is specified via `$ARGUMENTS`:

- `major`: Breaking changes (1.0.0 -> 2.0.0)
- `minor`: New features (1.0.0 -> 1.1.0)
- `patch`: Bug fixes (1.0.0 -> 1.0.1)

If `$ARGUMENTS` is empty, ask the user which type of release to create.

## Release Process

### Step 1: Get Current Version

Read `package.json` to get the current version:

```bash
node -p "require('./package.json').version"
```

### Step 2: Calculate New Version

Based on current version and bump type (`$ARGUMENTS`), calculate the new version:

- For `major`: Increment first number, reset others to 0
- For `minor`: Increment second number, reset patch to 0
- For `patch`: Increment third number

Example: Current is `2.2.11`

- `major` -> `3.0.0`
- `minor` -> `2.3.0`
- `patch` -> `2.2.12`

### Step 3: Get Latest Tag and PRs

```bash
# Get latest tag
git describe --tags --abbrev=0

# Get merged PRs since last tag (replace <last-tag> with actual tag)
git log <last-tag>..HEAD --merges --oneline
```

Parse the merge commits to extract PR numbers and titles:

- Format: `Merge pull request #<number> from <branch>`
- Extract the PR number and title

### Step 4: Generate Release Notes

Create release notes in this format:

```markdown
## What's Changed

- <PR title> by @sardine-ai in https://github.com/sardine-ai/mcp-server-manager/pull/<number>
- <PR title> by @sardine-ai in https://github.com/sardine-ai/mcp-server-manager/pull/<number>

**Full Changelog**: https://github.com/sardine-ai/mcp-server-manager/compare/<old-tag>...v<new-version>
```

If no PRs merged since last tag:

```markdown
## What's Changed

- Minor improvements and bug fixes

**Full Changelog**: https://github.com/sardine-ai/mcp-server-manager/compare/<old-tag>...v<new-version>
```

### Step 5: Show Preview and Confirm

Display to user:

```
Current version: <current>
New version: <new>

Release notes:
<generated notes>

Create this release? (y/n)
```

Wait for user confirmation before proceeding.

### Step 6: Create GitHub Release

Save release notes to temporary file and create release:

```bash
# Create temp file with release notes
cat > .release-notes.tmp << 'EOF'
<generated release notes>
EOF

# Create GitHub release (this triggers CI to bump version and publish to npm)
gh release create v<new-version> --title "v<new-version>" --notes-file .release-notes.tmp

# Clean up temp file
rm .release-notes.tmp
```

### Step 7: Success Message

Display:

```
Release v<new-version> created successfully!

CI will now automatically:
  1. Bump package.json to <new-version>
  2. Commit the version bump to main
  3. Publish to npm

View release: https://github.com/sardine-ai/mcp-server-manager/releases/tag/v<new-version>
View CI: https://github.com/sardine-ai/mcp-server-manager/actions
```

## Error Handling

If any step fails:

1. Report the error clearly
2. Explain what went wrong
3. Provide recovery steps if applicable
4. DO NOT continue with subsequent steps

Common errors:

- **Not on main branch**: Checkout main first
- **Dirty working directory**: Commit or stash changes
- **gh command not found**: Install GitHub CLI
- **gh auth required**: Run `gh auth login`

## Notes

- This skill uses `disable-model-invocation: true` to prevent accidental releases
- Only run this when ready to publish a new version
- The GitHub release creation triggers CI — do NOT manually bump package.json or push tags
- Release notes are generated from PR titles — ensure PR titles are descriptive
