/**
 * 文件操作通用工具
 */

/** 根据文件扩展名获取 MIME 类型 */
export function getMimeType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
    const mimeTypes: Record<string, string> = {
        // 文本文件
        txt: 'text/plain',
        md: 'text/markdown',
        json: 'application/json',
        yaml: 'text/yaml',
        yml: 'text/yaml',
        js: 'application/javascript',
        ts: 'application/typescript',
        css: 'text/css',
        html: 'text/html',
        // 图片文件
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        // 其他常见文件
        pdf: 'application/pdf',
        zip: 'application/zip',
        rar: 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',
    };
    return mimeTypes[extension] || 'application/octet-stream';
}
