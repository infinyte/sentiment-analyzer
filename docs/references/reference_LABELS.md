# GitHub Issue Labels Configuration

This file documents the recommended GitHub issue labels for the Sentiment Analyzer project.

## How to Add Labels

1. Go to your GitHub repository
2. Click **Settings** → **Labels**
3. Click **New label**
4. Add name, description, and color
5. Click **Create label**

---

## Label Categories

### 🔴 Priority Labels (Red)

| Label | Color | Description | Usage |
|-------|-------|-------------|-------|
| `priority-critical` | `#d73a49` | Breaking bugs, security issues | Needs immediate attention |
| `priority-high` | `#f24141` | Major feature, important bug | Fix in next release |
| `priority-medium` | `#ff7043` | Regular task, minor bug | Fix in current sprint |
| `priority-low` | `#ffa500` | Nice-to-have, polish | Backlog item |

### 🟢 Type Labels (Green)

| Label | Color | Description | Usage |
|-------|-------|-------------|-------|
| `type-bug` | `#d4edda` | Something is broken | Bug report |
| `type-feature` | `#c3e6cb` | New functionality | Feature request |
| `type-enhancement` | `#a8dba8` | Improvement to existing feature | Enhancement request |
| `type-documentation` | `#90ee90` | Documentation or guides | Docs update needed |
| `type-refactor` | `#98d98e` | Code cleanup, restructuring | Internal improvement |
| `type-test` | `#7dd37d` | Testing and test coverage | Testing task |

### 🔵 Status Labels (Blue)

| Label | Color | Description | Usage |
|-------|-------|-------------|-------|
| `status-open` | `#0366d6` | New issue, not yet reviewed | Newly created |
| `status-in-progress` | `#0052cc` | Someone is working on it | Being developed |
| `status-in-review` | `#0040c0` | Pull request review stage | Code review in progress |
| `status-blocked` | `#0033a0` | Can't proceed due to dependency | Waiting on something |
| `status-ready` | `#004ba0` | Ready to be worked on | Available for contributor |

### 🟡 Component Labels (Yellow)

| Label | Color | Description | Usage |
|-------|-------|-------------|-------|
| `component-frontend` | `#fff3cd` | React dashboard | Frontend-related |
| `component-backend` | `#ffeaa7` | Express API | Backend-related |
| `component-database` | `#ffd93d` | Data storage | Database-related |
| `component-deployment` | `#ffcb69` | Azure, CI/CD | Deployment-related |
| `component-api` | `#ffb946` | External API integration | API integration |
| `component-docs` | `#ff9500` | Documentation | Documentation |

### 🟣 Difficulty Labels (Purple)

| Label | Color | Description | Usage |
|-------|-------|-------------|-------|
| `difficulty-beginner` | `#d4a5ff` | Good for first-time contributors | Good first issue |
| `difficulty-intermediate` | `#b884ff` | Some experience needed | Intermediate task |
| `difficulty-advanced` | `#9d6aff` | Requires expertise | Advanced task |

### ⚫ Other Labels (Gray)

| Label | Color | Description | Usage |
|-------|-------|-------------|-------|
| `good-first-issue` | `#7057ff` | Ideal for new contributors | New contributor task |
| `help-wanted` | `#128a7d` | Explicitly looking for help | Seeking contributions |
| `question` | `#d876e3` | User question/clarification | Q&A |
| `duplicate` | `#cccccc` | Duplicate of another issue | Close as duplicate |
| `wontfix` | `#e4e669` | Won't be fixed | Close with reason |
| `needs-triage` | `#999999` | Needs categorization | Pending review |
| `security` | `#ff0000` | Security vulnerability | Security issue |

---

## Label Combination Guide

### For a Bug Report
- `type-bug` + `priority-*` + `component-*` + `status-open`
- Example: `type-bug`, `priority-high`, `component-frontend`, `status-open`

### For a Feature Request
- `type-feature` + `priority-*` + `component-*` + `difficulty-*` + `status-open`
- Example: `type-feature`, `priority-medium`, `component-backend`, `difficulty-intermediate`

### For First-Time Contributor
- `good-first-issue` + `difficulty-beginner` + `component-*` + `status-ready`
- Example: `good-first-issue`, `difficulty-beginner`, `component-frontend`, `status-ready`

### For Pull Request
- `type-*` + `status-in-review` + `component-*`
- Example: `type-feature`, `status-in-review`, `component-backend`

### For Blocked Issue
- Original labels + `status-blocked`
- Use comments to explain what's blocking progress

---

## Label Management Best Practices

### When Creating an Issue
1. Choose **one** type label
2. Assign a **priority** label
3. Add applicable **component** label
4. Add **difficulty** if it's for contributors
5. Don't assign status yet (maintainers will do this)

### When Reviewing Issues
1. Add `needs-triage` if new
2. Assign appropriate `priority`
3. Assign appropriate `component`
4. Mark as `good-first-issue` if suitable
5. Change `status-open` → `status-ready` when actionable

### When Working on an Issue
1. Add `status-in-progress` when starting
2. Link to PR if you create one
3. Comment with progress updates
4. Remove `status-in-progress` when done

### When Closing an Issue
- If fixed: Remove status labels
- If duplicate: Add `duplicate` label
- If won't fix: Add `wontfix` label
- Comment with reason

---

## GitHub Label JSON Configuration

Use this JSON to programmatically create labels:

```json
{
  "labels": [
    {
      "name": "priority-critical",
      "color": "d73a49",
      "description": "Critical priority - requires immediate attention"
    },
    {
      "name": "priority-high",
      "color": "f24141",
      "description": "High priority - should be fixed in next release"
    },
    {
      "name": "priority-medium",
      "color": "ff7043",
      "description": "Medium priority - regular task"
    },
    {
      "name": "priority-low",
      "color": "ffa500",
      "description": "Low priority - nice to have"
    },
    {
      "name": "type-bug",
      "color": "d4edda",
      "description": "Something isn't working"
    },
    {
      "name": "type-feature",
      "color": "c3e6cb",
      "description": "New feature or functionality"
    },
    {
      "name": "type-enhancement",
      "color": "a8dba8",
      "description": "Improvement to existing feature"
    },
    {
      "name": "type-documentation",
      "color": "90ee90",
      "description": "Documentation or guides"
    },
    {
      "name": "type-refactor",
      "color": "98d98e",
      "description": "Code cleanup or restructuring"
    },
    {
      "name": "type-test",
      "color": "7dd37d",
      "description": "Testing and test coverage"
    },
    {
      "name": "status-open",
      "color": "0366d6",
      "description": "New issue, not yet reviewed"
    },
    {
      "name": "status-in-progress",
      "color": "0052cc",
      "description": "Someone is working on it"
    },
    {
      "name": "status-in-review",
      "color": "0040c0",
      "description": "Pull request in code review"
    },
    {
      "name": "status-blocked",
      "color": "0033a0",
      "description": "Blocked by another issue or dependency"
    },
    {
      "name": "status-ready",
      "color": "004ba0",
      "description": "Ready to be worked on by contributors"
    },
    {
      "name": "component-frontend",
      "color": "fff3cd",
      "description": "React dashboard and UI"
    },
    {
      "name": "component-backend",
      "color": "ffeaa7",
      "description": "Express API and server"
    },
    {
      "name": "component-database",
      "color": "ffd93d",
      "description": "Data storage and queries"
    },
    {
      "name": "component-deployment",
      "color": "ffcb69",
      "description": "Azure, CI/CD, and DevOps"
    },
    {
      "name": "component-api",
      "color": "ffb946",
      "description": "External API integration"
    },
    {
      "name": "component-docs",
      "color": "ff9500",
      "description": "Documentation"
    },
    {
      "name": "difficulty-beginner",
      "color": "d4a5ff",
      "description": "Good for first-time contributors"
    },
    {
      "name": "difficulty-intermediate",
      "color": "b884ff",
      "description": "Some experience needed"
    },
    {
      "name": "difficulty-advanced",
      "color": "9d6aff",
      "description": "Requires expertise"
    },
    {
      "name": "good-first-issue",
      "color": "7057ff",
      "description": "Ideal for new contributors"
    },
    {
      "name": "help-wanted",
      "color": "128a7d",
      "description": "Explicitly looking for help"
    },
    {
      "name": "question",
      "color": "d876e3",
      "description": "User question or clarification needed"
    },
    {
      "name": "duplicate",
      "color": "cccccc",
      "description": "Duplicate of another issue"
    },
    {
      "name": "wontfix",
      "color": "e4e669",
      "description": "Will not be fixed"
    },
    {
      "name": "needs-triage",
      "color": "999999",
      "description": "Needs to be reviewed and categorized"
    },
    {
      "name": "security",
      "color": "ff0000",
      "description": "Security vulnerability"
    }
  ]
}
```

---

## Automation Scripts

### Using GitHub CLI

```bash
# Create labels from JSON
gh api repos/owner/repo/labels --input labels.json

# Add label to issue
gh issue edit 123 --add-label "priority-high"

# Remove label from issue
gh issue edit 123 --remove-label "priority-low"
```

### Using Python Script

```python
import requests
import json

# GitHub token with repo permissions
TOKEN = "your_github_token"
OWNER = "yourusername"
REPO = "sentiment-analyzer"

with open('labels.json', 'r') as f:
    labels = json.load(f)['labels']

for label in labels:
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/labels"
    headers = {
        "Authorization": f"token {TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    response = requests.post(url, json=label, headers=headers)
    print(f"Created: {label['name']} ({response.status_code})")
```

---

## Maintenance Schedule

- **Weekly:** Review `needs-triage` labels
- **Bi-weekly:** Update `status-*` labels
- **Monthly:** Review and archive old issues
- **Quarterly:** Evaluate label effectiveness
- **Yearly:** Reorganize label system if needed

---

## Tips for Contributors

**When opening an issue, don't assign labels yourself** - maintainers will do this. Just describe the problem clearly!

**When working on an issue:**
1. Comment that you're starting
2. Maintainers will add `status-in-progress`
3. Share progress updates
4. Create a PR when ready

**If you're unsure about a label:**
- Ask in issue comments
- Check similar closed issues
- Read this guide again

---

## Questions?

If you have suggestions for new labels or changes to the system, open a GitHub issue!
