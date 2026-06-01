# Screenshot Diff Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw git diff in the "变更预览" tab with a screenshot of the modified frontend page.

**Architecture:** After coding/testing pass in the sandbox, extract routes from the plan, start the dev server in the Docker container, take a Playwright screenshot, base64-encode it, and send it via the diff-ready SSE event. Frontend displays the screenshot instead of the diff text.

**Tech Stack:** Playwright (Python), Docker, TypeScript (orchestrator), React (frontend)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `core/src/types.ts` | Modify | Add `screenshot?: string` to diff-ready event |
| `core/src/git-ops/docker-sandbox.ts` | Modify | Add `takeScreenshot()` method |
| `core/src/orchestrator/orchestrator.ts` | Modify | Add screenshot logic in phaseCoding |
| `frontend/src/App.tsx` | Modify | Update diff tab to show screenshot |
| `frontend/src/App.css` | Modify | Add screenshot image styles |
| `sandbox.Dockerfile` | Modify | Install playwright + chromium |

---

### Task 1: Update Types — Add screenshot to diff-ready event

**Files:**
- Modify: `core/src/types.ts:235`

- [ ] **Step 1: Add screenshot field to diff-ready event type**

```typescript
// In OrchestratorEvent union, update diff-ready:
| { type: 'diff-ready'; requirement: Requirement; diff: string; screenshot?: string; files: { path: string; summary: string }[] }
```

- [ ] **Step 2: Verify type compiles**

Run: `cd core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build core**

Run: `cd core && npm run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add core/src/types.ts core/dist/
git commit -m "feat: add screenshot field to diff-ready event type"
```

---

### Task 2: Update Sandbox Dockerfile — Install Playwright

**Files:**
- Modify: `core/src/git-ops/sandbox.Dockerfile`

- [ ] **Step 1: Read current Dockerfile**

Read `core/src/git-ops/sandbox.Dockerfile` to understand current structure.

- [ ] **Step 2: Add Playwright installation**

Add after the existing `RUN npm install` line:

```dockerfile
# Install Playwright for screenshots
RUN pip install playwright && playwright install chromium
```

- [ ] **Step 3: Rebuild sandbox image**

Run: `cd core && npx tsx -e "import { DockerSandboxManager } from './src/git-ops/docker-sandbox.js'; const m = new DockerSandboxManager('.'); m.ensureImage().then(() => console.log('OK'))"`
Or: `docker build -t thehand-sandbox -f core/src/git-ops/sandbox.Dockerfile core/src/git-ops/`

Expected: Image builds successfully with Playwright installed

- [ ] **Step 4: Commit**

```bash
git add core/src/git-ops/sandbox.Dockerfile
git commit -m "feat: install playwright in sandbox docker image"
```

---

### Task 3: Add takeScreenshot method to DockerSandboxManager

**Files:**
- Modify: `core/src/git-ops/docker-sandbox.ts`

- [ ] **Step 1: Write the takeScreenshot method**

Add after the `getDiff` method:

```typescript
/**
 * 在沙箱容器内对指定页面截图，返回 base64 编码的 PNG
 */
async takeScreenshot(route: string = '/', port: number = 3000): Promise<string | null> {
  const entry = Array.from(this.activeSandboxes.values())[0]
  if (!entry) return null

  const script = `
import sys
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        page.goto('http://localhost:${port}${route}', timeout=15000)
        page.wait_for_load_state('networkidle', timeout=10000)
        page.screenshot(path='/sandbox/.screenshot.png', full_page=True)
        browser.close()
    print('OK')
except Exception as e:
    print(f'FAIL: {e}', file=sys.stderr)
    sys.exit(1)
`

  try {
    await this.dockerExec(entry.containerName, `python3 -c '${script.replace(/'/g, "'\\''")}'`, 30_000)
    const { stdout } = await this.dockerExec(entry.containerName, 'base64 -w0 /sandbox/.screenshot.png')
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * 启动沙箱内的 dev server 并等待就绪
 */
async startDevServer(port: number = 3000, timeoutMs: number = 30_000): Promise<boolean> {
  const entry = Array.from(this.activeSandboxes.values())[0]
  if (!entry) return false

  // 启动 dev server（后台运行）
  await this.dockerExec(entry.containerName, `cd /sandbox && npm run dev &`)

  // 轮询端口就绪
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout } = await this.dockerExec(entry.containerName, `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port} || echo '000'`)
      if (stdout.trim() !== '000') return true
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}
```

- [ ] **Step 2: Verify type compiles**

Run: `cd core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add core/src/git-ops/docker-sandbox.ts core/dist/
git commit -m "feat: add takeScreenshot and startDevServer to DockerSandboxManager"
```

---

### Task 4: Integrate screenshot into orchestrator phaseCoding

**Files:**
- Modify: `core/src/orchestrator/orchestrator.ts` (phaseCoding method, around line 470)

- [ ] **Step 1: Add screenshot logic before yielding diff-ready**

Before the existing `yield { type: 'diff-ready', ... }`, add:

```typescript
    // ── 页面截图 ──
    let screenshot: string | null = null
    if ('startDevServer' in sandboxManager && 'takeScreenshot' in sandboxManager) {
      try {
        yield { type: 'executing', phase: 'starting dev server', progress: 85 }
        const sm = sandboxManager as any
        const serverStarted = await sm.startDevServer(3000, 30_000)
        if (serverStarted) {
          yield { type: 'executing', phase: 'taking screenshot', progress: 87 }
          // 从 plan 中提取第一个路由
          const route = this.extractRouteFromPlan(plan)
          screenshot = await sm.takeScreenshot(route, 3000)
        }
      } catch {
        // 截图失败，fallback 到 diff
      }
    }
```

- [ ] **Step 2: Add extractRouteFromPlan helper method**

Add as a private method on the Orchestrator class:

```typescript
/**
 * 从 FilePlan 中提取涉及的前端路由
 */
private extractRouteFromPlan(plan: FilePlan[]): string {
  for (const file of plan) {
    const path = file.path.toLowerCase()
    // 匹配常见页面文件模式
    if (path.includes('/pages/') || path.includes('/views/') || path.includes('/routes/')) {
      const name = file.path.split('/').pop()?.replace(/\.(tsx?|vue|jsx?)$/, '') ?? ''
      if (name && name !== 'index' && name !== 'App') {
        return `/${name.toLowerCase()}`
      }
    }
  }
  return '/'  // fallback to homepage
}
```

- [ ] **Step 3: Update yield to include screenshot**

```typescript
    yield {
      type: 'diff-ready',
      requirement,
      diff: diffContent,
      screenshot: screenshot ?? undefined,
      files: validOutputs.map(f => ({ path: f.path, summary: f.summary })),
    }
```

- [ ] **Step 4: Verify type compiles**

Run: `cd core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Build core**

Run: `cd core && npm run build`

- [ ] **Step 6: Commit**

```bash
git add core/src/orchestrator/orchestrator.ts core/dist/
git commit -m "feat: take page screenshot in phaseCoding before diff-ready"
```

---

### Task 5: Update frontend to display screenshot

**Files:**
- Modify: `frontend/src/App.tsx` (diff tab)
- Modify: `frontend/src/App.css` (screenshot styles)

- [ ] **Step 1: Update useSSE types**

In `frontend/src/hooks/useSSE.ts`, add `screenshot?: string` to the OrchestratorEvent type.

- [ ] **Step 2: Update diff tab rendering**

Replace the diff content `<pre>` block with:

```tsx
{screenshot ? (
  <div className="screenshot-preview">
    <img src={`data:image/png;base64,${screenshot}`} alt="页面预览" />
  </div>
) : (
  <pre className="diff-content"><code>{latestEvent.diff}</code></pre>
)}
```

Where `screenshot` is extracted from the event:
```typescript
const screenshot = latestEvent?.type === 'diff-ready' ? latestEvent.screenshot : null
```

- [ ] **Step 3: Add CSS for screenshot**

```css
.screenshot-preview {
  margin: 16px 0;
  text-align: center;
}

.screenshot-preview img {
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ frontend/src/App.css
git commit -m "feat: display page screenshot in diff preview tab"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Build all packages**

Run: `cd core && npm run build && cd ../backend && npm run build && cd ../frontend && npm run build`

- [ ] **Step 2: Start backend and frontend**

Backend: `cd backend && node dist/index.js`
Frontend: `cd frontend && npx vite`

- [ ] **Step 3: Create a test requirement**

Submit a simple UI change requirement (e.g., "给文章列表添加分页按钮").

- [ ] **Step 4: Verify the full flow**

1. Clarification → Plan → Approve → Coding → Testing
2. After testing passes, check that:
   - Dev server starts in sandbox
   - Screenshot is taken
   - Diff tab shows the screenshot (not raw diff)
   - Commit/Rollback buttons work

- [ ] **Step 5: Test error fallback**

If screenshot fails, verify the diff tab falls back to showing the raw git diff.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: screenshot diff preview — complete implementation"
```
