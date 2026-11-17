import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
test('client.js bundles xstate and keeps the ModuleLoader contract', async () => {
    const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
    // xstate must be bundled in, not required from the Host module registry
    assert.equal(/require(?:\d*)\(\s*(['"])xstate\1\s*\)/.test(source), false);
    // the generated wrapper must keep serving the plugin through the module loader
    assert.ok(source.includes('window.__ModuleLoader__.load({'));
    assert.ok(source.includes("id: '@local/dsh-usage-limits'"));
    assert.ok(source.includes('factory(require)'));
    // and the usage machine travels inside the bundle
    assert.ok(source.includes('usageBlock'));
});
test('client.js factory returns the plugin descriptor', async () => {
    const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
    const loaded = [];
    const window = { __ModuleLoader__: { load: (spec) => loaded.push(spec) } };
    new Function('window', source)(window);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, '@local/dsh-usage-limits');
    const react = { createElement: () => { throw new Error('rendered too early'); } };
    const descriptor = loaded[0].factory((id) => {
        assert.equal(id, 'react');
        return react;
    });
    assert.deepEqual(descriptor.inject, ['slots', 'locale']);
    assert.equal(typeof descriptor.apply, 'function');
});
