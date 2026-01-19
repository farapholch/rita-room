# Conventional Commits Guide

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for automatic versioning and changelog generation.

## Commit Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types

- **feat**: A new feature (triggers MINOR version bump)
- **fix**: A bug fix (triggers PATCH version bump)
- **perf**: Performance improvement (triggers PATCH version bump)
- **refactor**: Code change that neither fixes a bug nor adds a feature (triggers PATCH version bump)
- **docs**: Documentation only changes (no version bump)
- **style**: Changes that don't affect code meaning (no version bump)
- **test**: Adding missing tests (no version bump)
- **chore**: Changes to build process or auxiliary tools (no version bump)
- **ci**: Changes to CI configuration files (no version bump)

## Breaking Changes

Add `BREAKING CHANGE:` in the footer or `!` after the type to trigger a MAJOR version bump:

```
feat!: redesign API structure

BREAKING CHANGE: API endpoints have been restructured
```

## Examples

```bash
# Patch release (1.0.0 -> 1.0.1)
git commit -m "fix: resolve health check endpoint error"

# Minor release (1.0.0 -> 1.1.0)
git commit -m "feat: add new metrics endpoint"

# Major release (1.0.0 -> 2.0.0)
git commit -m "feat!: change authentication method

BREAKING CHANGE: OAuth2 is now required for all API calls"
```

## Automatic Releases

When you push to `master`:
1. Semantic-release analyzes commit messages
2. Determines the next version number
3. Updates `package.json` and `CHANGELOG.md`
4. Creates a git tag
5. Publishes a GitHub release

To skip a release, add `[skip ci]` to your commit message.
