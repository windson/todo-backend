# Kiro pull request reviewer

The `Kiro PR Review` GitHub Actions workflow runs a read-only Kiro CLI agent when a pull request is opened, reopened, marked ready for review, or updated with new commits. A manual dispatch accepts a pull request number so maintainers can review PRs that existed before the workflow was installed.

## Files

- `.github/workflows/kiro-pr-review.yml` resolves the exact PR revision, keeps trusted automation at the workspace root, checks out untrusted PR code under `review-target/`, invokes Kiro headlessly, and posts each validated finding as an inline review comment on the affected file and line.
- `.kiro/agents/pr-reviewer.json` limits the agent to repository reads and requires structured findings with diff-relative locations.
- `.github/scripts/extract-kiro-review.py` extracts Kiro's structured response from `stream-json` output and rejects paths or lines that are not present on the PR diff.

## Required secret

Create a Kiro API key in Kiro account settings, then store it as the repository Actions secret `KIRO_API_KEY`:

```sh
gh secret set KIRO_API_KEY --repo windson/todo-backend
```

Enter the key when prompted. Do not commit the key or pass it as a command-line argument.

Kiro API keys are Kiro account credentials. AWS IAM access keys cannot be used as `KIRO_API_KEY`.

## Manual review

After the workflow exists on the default branch, review an existing PR with:

```sh
gh workflow run "Kiro PR Review" --repo windson/todo-backend -f pr_number=1
```

Each actionable finding is attached to its file and line in the pull request diff. A later run replaces prior Kiro inline comments, and a clean review posts no summary comment.
## Custom GitHub App identity

The workflow creates a short-lived installation token from `KIRO_REVIEWER_CLIENT_ID` and `KIRO_REVIEWER_PRIVATE_KEY`. Inline findings are therefore authored by `kiro-pr-reviewer[bot]` rather than `github-actions[bot]`. The GitHub App must be installed on this repository with read/write access to contents and pull requests.

## Applying findings

Maintainers with `write`, `maintain`, or `admin` permission can request fixes from the PR conversation:

```text
@kiro-pr-reviewer fix all
@kiro-pr-reviewer fix discussion_r4443586283
```

A maintainer can also reply directly to a current Kiro inline finding:

```text
@kiro-pr-reviewer fix this
```

The fixer accepts only same-repository PR branches. Kiro receives read-only tools and returns exact replacements for a trusted script to apply. The script rejects workflow, agent, Git, environment, credential, key, and lockfile edits; limits each run to 20 replacements and 2,000 changed lines; verifies the PR head has not changed; and pushes a normal commit through the GitHub App. The fixer then dispatches a fresh Kiro review so stale findings are replaced or removed.
