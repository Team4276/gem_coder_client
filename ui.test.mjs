import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const page = await readFile(new URL('./index.html', import.meta.url), 'utf8');

for (const mobile of [false, true]) {
  test(`chat navigation preserves the sidebar on ${mobile ? 'mobile by dismissing the drawer' : 'desktop'}`, () => {
    let closed = 0;
    let focused = false;
    const context = vm.createContext({
      activeId: 'old', mobileLayout: { matches: mobile },
      renderHistory() {}, renderChat() {},
      conversationEl: { scrollTo() {} },
      promptEl: { focus() { focused = true; } },
      closeSidebar() { closed += 1; }
    });
    vm.runInContext(page.slice(page.indexOf('      function newChat()'), page.indexOf('      function deleteChat(')), context);
    context.newChat();
    assert.equal(context.activeId, null);
    assert.equal(focused, true);
    assert.equal(closed, mobile ? 1 : 0);
    context.openChat('saved');
    assert.equal(context.activeId, 'saved');
    assert.equal(closed, mobile ? 2 : 0);
  });
}
