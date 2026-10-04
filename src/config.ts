import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 配置读取约定（GitHub 友好形式）：
 * - env.conf.example：随仓库提交的模板，只含占位值，可放心 push
 * - env.conf：本地真实配置，含 API_KEY，已被 .gitignore 忽略
 *
 * 按项目根目录定位配置文件，避免从其它 cwd 启动时读不到。
 */
const ROOT_DIR = path.resolve(import.meta.dir, '..');
const LOCAL_CONFIG = path.join(ROOT_DIR, 'env.conf');
const EXAMPLE_CONFIG = path.join(ROOT_DIR, 'env.conf.example');

function loadConfigFile(): 'local' | 'example' | 'none' {
    if (fs.existsSync(LOCAL_CONFIG)) {
        dotenv.config({ path: LOCAL_CONFIG });
        return 'local';
    }
    if (fs.existsSync(EXAMPLE_CONFIG)) {
        dotenv.config({ path: EXAMPLE_CONFIG });
        console.warn(
            [
                '[config] 未找到本地配置 env.conf，已临时使用 env.conf.example 中的占位值。',
                '[config] 首次运行请先复制模板并填写真实值：',
                '[config]     cp env.conf.example env.conf',
                '[config] env.conf 已在 .gitignore 中，不会被 push 到仓库。',
            ].join('\n')
        );
        return 'example';
    }
    console.warn('[config] 既没有 env.conf 也没有 env.conf.example，将只使用进程环境变量。');
    return 'none';
}

const source = loadConfigFile();

const USAGE = (process.env.USAGE ?? '').trim().toUpperCase();
const isRemote = USAGE === 'REMOTE';

const baseURL = isRemote ? process.env.BASE_REMOTE_URL : process.env.BASE_LOCAL_URL;
const model = (isRemote ? process.env.REMOTE_MODEL : process.env.LOCAL_MODEL) ?? 'llama3.2';
const apiKey = process.env.API_KEY;

if (USAGE && USAGE !== 'REMOTE' && USAGE !== 'LOCAL') {
    console.warn(`[config] USAGE=${USAGE} 无法识别，只支持 REMOTE 或 LOCAL，当前按 LOCAL 处理。`);
}
if (!baseURL) {
    console.warn(
        `[config] 未配置 ${isRemote ? 'BASE_REMOTE_URL' : 'BASE_LOCAL_URL'}，请求时会失败。`
    );
}
if (isRemote && source !== 'local' && !apiKey) {
    console.warn('[config] 远程模式缺少 API_KEY，请在 env.conf 中填写。');
}

export const config = {
    /** 实际读取到的配置来源：local=env.conf，example=模板占位值，none=仅进程环境变量 */
    source,
    usage: (USAGE || 'LOCAL') as 'REMOTE' | 'LOCAL',
    baseURL,
    model,
    apiKey,
};

export default config;
