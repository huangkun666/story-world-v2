// Only the envelope may vary; JSON facts and validation remain unchanged.
export function parseModelJson(raw) {
 if(typeof raw!=='string')throw new TypeError('模型响应必须是完整文本');
 const text=raw.trim(),fence=/^\`\`\`(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n\`\`\`$/i.exec(text);
 return JSON.parse(fence?fence[1]:text);
}
