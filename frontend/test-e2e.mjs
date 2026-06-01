import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];

  // 捕获控制台错误
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    // === Test 1: 首页加载 ===
    console.log('\n[Test 1] 首页加载...');
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-screenshots/01-homepage.png', fullPage: true });

    const title = await page.title();
    console.log(`  标题: ${title}`);

    // 检查核心元素
    const logo = await page.locator('h1').first().textContent();
    console.log(`  Logo: ${logo}`);

    const emptyGuide = await page.locator('.empty-guide').isVisible().catch(() => false);
    console.log(`  空状态引导: ${emptyGuide ? '可见' : '不可见/不存在'}`);

    // === Test 2: 提交需求 ===
    console.log('\n[Test 2] 提交需求...');
    const textarea = page.locator('.sidebar-compose textarea');
    await textarea.fill('给文章列表添加分页功能');
    await page.screenshot({ path: 'test-screenshots/02-input-filled.png', fullPage: true });

    const submitBtn = page.locator('.sidebar-compose button.btn-primary');
    await submitBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-screenshots/03-after-submit.png', fullPage: true });

    // 检查需求是否出现在列表
    const reqCards = await page.locator('.req-card').count();
    console.log(`  需求数量: ${reqCards}`);

    // 检查 toast
    const toast = await page.locator('.toast').isVisible().catch(() => false);
    console.log(`  Toast 显示: ${toast}`);

    // === Test 3: 查看需求详情 ===
    console.log('\n[Test 3] 查看需求详情...');
    if (reqCards > 0) {
      await page.locator('.req-card').first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'test-screenshots/04-detail-view.png', fullPage: true });

      // 检查 tab 标签
      const tabs = await page.locator('.tab').allTextContents();
      console.log(`  Tabs: ${tabs.join(', ')}`);

      // 检查状态标签
      const badge = await page.locator('.status-badge').first().textContent().catch(() => 'N/A');
      console.log(`  状态: ${badge}`);

      // 检查操作按钮
      const buttons = await page.locator('.detail-actions button').allTextContents();
      console.log(`  按钮: ${buttons.join(', ')}`);
    }

    // === Test 4: 切换 Tab ===
    console.log('\n[Test 4] 切换 Tab...');
    for (const tabName of ['进度', '对话', '方案', '变更预览', '结构化需求']) {
      await page.locator(`.tab:has-text("${tabName}")`).click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: 'test-screenshots/05-tabs-explored.png', fullPage: true });
    console.log('  所有 Tab 切换成功');

    // === Test 5: 对话 Tab ===
    console.log('\n[Test 5] 对话 Tab...');
    await page.locator('.tab:has-text("对话")').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-screenshots/06-chat-tab.png', fullPage: true });

    const chatHint = await page.locator('.chat-hint').textContent().catch(() => 'N/A');
    console.log(`  对话提示: ${chatHint}`);

    // === Test 6: API 端点检查 ===
    console.log('\n[Test 6] API 端点检查...');
    const endpoints = [
      '/api/requirements',
    ];
    for (const ep of endpoints) {
      const resp = await page.evaluate(async (url) => {
        const r = await fetch(url);
        return { status: r.status, ok: r.ok };
      }, ep);
      console.log(`  ${ep}: ${resp.status} ${resp.ok ? 'OK' : 'FAIL'}`);
    }

    // === Test 7: 响应式检查 (mobile) ===
    console.log('\n[Test 7] 移动端视图...');
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-screenshots/07-mobile.png', fullPage: true });

    // 检查汉堡菜单
    const hamburger = await page.locator('.sidebar-toggle').isVisible().catch(() => false);
    console.log(`  汉堡菜单可见: ${hamburger}`);

    // === 结果汇总 ===
    console.log('\n========== 测试结果 ==========');
    console.log(`控制台错误: ${errors.length}`);
    if (errors.length > 0) {
      errors.forEach(e => console.log(`  ❌ ${e}`));
    }
    console.log('截图保存在 test-screenshots/ 目录');
    console.log('================================\n');

  } catch (e) {
    console.error('测试失败:', e.message);
    await page.screenshot({ path: 'test-screenshots/error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

run();
