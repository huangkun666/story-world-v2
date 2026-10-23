// Host-only bridge: standard ST exposes the inventory but not its active global selection.
// Keep the book reader free of DOM; only selected native indices become source names.
export function withHostGlobalWorldInfo(ctx, root) {
    if (!ctx || typeof ctx.loadWorldInfo !== 'function' || typeof ctx.getWorldInfoNames !== 'function'
        || typeof ctx.getGlobalWorldInfoNames === 'function'
        || (ctx.chatWorldInfo && 'globalSelection' in ctx.chatWorldInfo)
        || (ctx.extensionSettings?.world_info && 'globalSelect' in ctx.extensionSettings.world_info)) return ctx;
    return { ...ctx, getGlobalWorldInfoNames() {
        const control = root?.querySelector?.('select#world_info');
        if (!control || !control.selectedOptions) throw new Error('global selection unavailable');
        const selected = Array.from(control.selectedOptions);
        if (!selected.length) return [];
        const inventory = ctx.getWorldInfoNames();
        if (!Array.isArray(inventory)) throw new Error('global selection names unavailable');
        return selected.map(option => {
            const raw = String(option.value), index = Number(raw);
            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(index) || typeof inventory[index] !== 'string' || !inventory[index].trim()) throw new Error('global selection index unavailable');
            return inventory[index];
        });
    } };
}
