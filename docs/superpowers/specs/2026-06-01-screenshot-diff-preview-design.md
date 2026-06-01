# Design: Diff Preview — Screenshot Replaces Git Diff

> Date: 2026-06-01
> Status: Approved
> Scope: Change the "变更预览" tab from showing raw git diff text to showing a screenshot of the modified frontend page.

## Problem

The current diff preview shows raw `git diff` output, which is:
- Not meaningful for PMs (non-technical users)
- Doesn't show what the change actually looks like
- Requires understanding of code to evaluate

## Solution

After coding and testing pass in the sandbox, take a screenshot of the modified frontend page(s) and display that instead of the raw diff.

## Architecture

```
phaseCoding (after tests pass)
  ├─ Extract routes from FilePlan[]
  ├─ Start dev server in sandbox container
  ├─ Wait for server ready (poll port)
  ├─ Playwright: visit each route, screenshot
  ├─ Read PNG files, base64 encode
  └─ yield { type: 'diff-ready', screenshot, files }
```

## Data Flow

### 1. Route Extraction

From `FilePlan[]`, identify frontend page components:
- Match files like `src/pages/*.tsx`, `src/routes/*.tsx`, `src/views/*.vue`
- Map component names to routes using project's router config
- Fallback: screenshot `/` if no routes found

### 2. Dev Server Startup

In the Docker container:
```bash
cd /sandbox && npm run dev &
# Poll port 3000/5173 until ready (max 30s)
```

### 3. Playwright Screenshot

In the Docker container (Python script):
```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 720})
    page.goto('http://localhost:3000/articles')
    page.wait_for_load_state('networkidle')
    page.screenshot(path='/sandbox/.screenshot.png', full_page=True)
    browser.close()
```

### 4. Transfer

```typescript
const pngBase64 = await executor('base64 -w0 /sandbox/.screenshot.png')
yield { type: 'diff-ready', screenshot: pngBase64, files, requirement }
```

### 5. Frontend Display

```tsx
{screenshot ? (
  <img src={`data:image/png;base64,${screenshot}`} alt="页面预览" />
) : (
  <pre className="diff-content"><code>{diff}</code></pre>  // fallback
)}
```

## Modified Files

| File | Change |
|------|--------|
| `core/src/orchestrator/orchestrator.ts` | Add screenshot logic after tests pass in phaseCoding |
| `core/src/git-ops/docker-sandbox.ts` | Add `screenshot(route: string)` method |
| `core/src/types.ts` | Add `screenshot?: string` to diff-ready event |
| `frontend/src/App.tsx` | Update diff tab to show screenshot |
| `frontend/src/App.css` | Add screenshot display styles |
| `sandbox.Dockerfile` | Install playwright + chromium |

## Sandbox Image Changes

Add to Dockerfile:
```dockerfile
RUN pip install playwright && playwright install chromium
```

## Error Handling

| Scenario | Action |
|----------|--------|
| Screenshot fails | Fallback to git diff display |
| Dev server won't start | Skip screenshot, show files only |
| No routes extracted | Screenshot `/` (homepage) |
| Container timeout | Skip screenshot, proceed with commit |

## Dependencies

- Sandbox Docker image needs: `python3`, `pip`, `playwright`, `chromium`
- Container needs network access to localhost (already has `--network=bridge`)

## Out of Scope

- Multiple page screenshots (only first matching route)
- Mobile viewport screenshots
- Screenshot comparison (before/after)
- Video recording of interactions
