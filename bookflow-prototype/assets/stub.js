/**
 * BookFlow 原型 stub.js
 *
 * 给所有「看起来能点但还没接逻辑」的死按钮 / 死链接统一兜个 toast，
 * 避免点了完全没反应。已经有真 handler 的元素请打 data-bound（手动 / 在脚本里 setAttribute）。
 *
 * 范围：
 *   - <a href="#"> 或 <a href="javascript:void(0)">
 *   - <button>，但不含 type="submit" 且不含 data-bound 的
 *   - 排除：disabled / aria-disabled="true" / 真链接（href 非 # 且非 javascript:）
 */
(function () {
    function showToast(text, opts) {
        opts = opts || {};
        const old = document.querySelector('[data-toast="stub"]');
        if (old) old.remove();
        const el = document.createElement('div');
        el.setAttribute('data-toast', 'stub');
        el.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-lg bg-gray-900/95 text-white text-sm px-4 py-2 shadow-lg flex items-center gap-2';
        el.innerHTML = '<span>' + text + '</span><span class="text-gray-400 text-xs">原型占位</span>';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), opts.duration || 1800);
    }
    window.__bookflowToast = showToast;

    function labelOf(el) {
        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt.length > 18 ? txt.slice(0, 18) + '…' : txt;
        const aria = el.getAttribute('aria-label') || el.getAttribute('title');
        if (aria) return aria;
        return '操作';
    }

    function isDisabled(el) {
        return el.hasAttribute('disabled')
            || el.getAttribute('aria-disabled') === 'true'
            || el.classList.contains('cursor-not-allowed');
    }

    function shouldStub(target) {
        // 已绑定就跳过
        if (target.closest('[data-bound]')) return null;

        const a = target.closest('a');
        if (a) {
            const href = a.getAttribute('href') || '';
            if (href === '#' || href.toLowerCase().startsWith('javascript:')) return a;
            return null;
        }
        const btn = target.closest('button');
        if (btn) {
            if (isDisabled(btn)) return null;
            if (btn.getAttribute('type') === 'submit') return null;
            return btn;
        }
        return null;
    }

    document.addEventListener('click', function (e) {
        const el = shouldStub(e.target);
        if (!el) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        showToast('「' + labelOf(el) + '」' + (el.dataset.stubMsg || '尚未接入'));
    }, true);

    // 已经有真 handler 的元素 → 打 data-bound 让 stub 跳过
    // 在三页里通用扫描，不存在的 selector 会被忽略
    const BOUND_SELECTORS = [
        // seed-scorecard.html
        '#open-ai-drawer', '#cta-submit', '#drawer-close-btn', '#drawer-close-overlay', '.ai-tab',
        // dashboard.html
        '[data-pipeline-stage]',
    ];
    document.addEventListener('DOMContentLoaded', function () {
        BOUND_SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => el.setAttribute('data-bound', ''));
        });
    });
})();
