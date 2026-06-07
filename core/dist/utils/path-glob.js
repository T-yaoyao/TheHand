/**
 * 轻量 glob（仅 `*` 与 `**`），路径统一为正斜杠；用于 project.json 中的模式。
 */
export function matchPathGlob(filePath, pattern) {
    const f = filePath.replace(/\\/g, '/');
    const g = pattern.replace(/\\/g, '/');
    const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const reSrc = g
        .split('**')
        .map(seg => seg.split('*').map(escapeRe).join('[^/]*'))
        .join('.*');
    return new RegExp(`^${reSrc}$`, 'i').test(f);
}
//# sourceMappingURL=path-glob.js.map