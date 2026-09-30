// story-world-v2/demo/diag-transport.js
// 传输诊断：配置源（env/酒馆预设）+ 最小调用探测（复用真实 transport，不发密钥、不写配置）。
// 运行：node demo/diag-transport.js
import { resolveWorldTransport } from '../src/st-preset.js';

const resolved = resolveWorldTransport();
if (!resolved) {
    console.log('── 配置源检查 ──');
    console.log('  env（ST_OPENAI_BASE/KEY/WORLD_MODEL 或 OPENAI_*）：未设置');
    console.log('  酒馆预设（default-user/settings.json → llmPresets 活跃预设）：未读到');
    console.log(`
── 排查提示 ──
  · env 只在"设置它的那个终端窗口"里生效；PowerShell 用 $env:NAME="值"（set 是普通变量别名）；
  · 系统设置里改的 env 需新开终端；ST_SETTINGS_PATH 可指向酒馆设置文件的其他位置。
`);
    process.exit(1);
}

console.log('── 配置源 ──');
console.log(`  来源：${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'}`);
console.log(`  base：${resolved.baseUrl}`);
console.log(`  model：${resolved.model}`);
console.log('  密钥：已加载（不显示明文）');

console.log('\n── 最小调用探测（真实 transport） ──');
try {
    const out = await resolved.transport('只回复两个字：正常');
    console.log(`  ✓ 调用成功 · 响应：${out.slice(0, 200)}`);
    console.log('\n── 结论：端点/鉴权/模型/json_object 全通。跑 node demo/live-demo.js');
} catch (err) {
    console.log(`  ✗ HTTP ${err.status ?? '?'}${err.bodySnippet ? ` · ${err.bodySnippet}` : ` · ${err.message}`}`);
    console.log(`
── 按状态码排查 ──
  404 → 地址路径不对（网关习惯 /v1 结尾；检查 base 是否可访问）；
  401/403 → 密钥不对/无权限；
  400 → 模型名不对或 json_object 不受支持（响应体一般会写明；前者改预设模型名，后者我们改请求参数）；
  429 → 限流/额度；
  500+ → 服务端问题或地址不对。
  把上面几行原样发我。`);
}