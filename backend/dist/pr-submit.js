import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
/** 优先使用 .env 中的 GITHUB_TOKEN；否则回退到 gh auth login 的凭据 */
function resolveGitHubToken() {
    const t = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
    return t || undefined;
}
function childEnv() {
    const env = { ...process.env };
    const token = resolveGitHubToken();
    if (token) {
        env.GH_TOKEN = token;
        env.GITHUB_TOKEN = token;
    }
    return env;
}
function git(cwd, args, timeout = 120_000) {
    const token = resolveGitHubToken();
    const gitArgs = token
        ? ['-c', `http.extraHeader=AUTHORIZATION: bearer ${token}`, ...args]
        : args;
    return execFileSync('git', gitArgs, {
        cwd,
        encoding: 'utf-8',
        timeout,
        // credential helper（gh auth git-credential）需要 stdin
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv(),
        maxBuffer: 20 * 1024 * 1024,
    }).trim();
}
function gh(cwd, args, timeout = 180_000) {
    return execFileSync('gh', args, {
        cwd,
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv(),
        maxBuffer: 20 * 1024 * 1024,
    }).trim();
}
const PROTECTED_BRANCHES = new Set(['main', 'master']);
/**
 * 将当前仓库的已提交变更推送到 origin，并对 main 发起 PR。
 * 认证：优先 `GITHUB_TOKEN`（根目录 .env）；否则依赖 `gh auth login` + `gh auth setup-git`。
 */
export function pushBranchAndCreatePrToMain(options) {
    const { cwd, requirementId, pmInput } = options;
    const original = git(cwd, ['branch', '--show-current']);
    if (!original) {
        throw new Error('无法获取当前 git 分支');
    }
    const base = 'main';
    let pushBranch = original;
    let createdLocalBranch = null;
    if (PROTECTED_BRANCHES.has(original.toLowerCase())) {
        const slug = requirementId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'req';
        pushBranch = `thehand/${slug}`;
        git(cwd, ['checkout', '-b', pushBranch]);
        createdLocalBranch = pushBranch;
    }
    try {
        git(cwd, ['push', '-u', 'origin', pushBranch], 180_000);
    }
    catch (e) {
        if (createdLocalBranch) {
            try {
                git(cwd, ['checkout', original]);
                git(cwd, ['branch', '-D', createdLocalBranch]);
            }
            catch {
                // best-effort rollback
            }
        }
        throw e;
    }
    const snippet = pmInput.replace(/\s+/g, ' ').trim();
    const title = `TheHand: ${snippet.slice(0, 72)}${snippet.length > 72 ? '…' : ''}`;
    const body = `TheHand 需求 \`${requirementId}\`\n\n${snippet.slice(0, 8000)}`;
    const bodyFile = join(cwd, '.git', 'THEHAND_PR_BODY_TMP');
    writeFileSync(bodyFile, body, 'utf-8');
    let prUrl;
    try {
        prUrl = gh(cwd, ['pr', 'create', '--base', base, '--head', pushBranch, '--title', title, '--body-file', bodyFile], 180_000);
    }
    finally {
        try {
            unlinkSync(bodyFile);
        }
        catch {
            /* ignore */
        }
    }
    const url = prUrl
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('http')) ?? prUrl.trim();
    if (createdLocalBranch) {
        try {
            git(cwd, ['checkout', original]);
            git(cwd, ['branch', '-d', createdLocalBranch]);
        }
        catch {
            /* 若分支未合并到当前 HEAD 等，保留分支即可 */
        }
    }
    return url;
}
//# sourceMappingURL=pr-submit.js.map