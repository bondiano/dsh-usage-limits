import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialBlockStatus, nextBlockStatus, usageBlockMachine } from '../lib/usage.machine.js';
test('usage block walks the provider card lifecycle', () => {
    let status = initialBlockStatus();
    assert.equal(status, 'loading');
    // first fetch fails with nothing to show: the error card with retry
    status = nextBlockStatus(status, 'FAIL');
    assert.equal(status, 'error');
    status = nextBlockStatus(status, 'RETRY');
    assert.equal(status, 'loading');
    // first success renders the card
    status = nextBlockStatus(status, 'SUCCESS');
    assert.equal(status, 'ready');
    // a poll answering while the card already shows data keeps it ready
    status = nextBlockStatus(status, 'SUCCESS');
    assert.equal(status, 'ready');
    // a failed refresh keeps the stale section visible with an error
    status = nextBlockStatus(status, 'REFRESH_FAILED');
    assert.equal(status, 'readyError');
    // a second consecutive failure keeps the same error card
    status = nextBlockStatus(status, 'REFRESH_FAILED');
    assert.equal(status, 'readyError');
    // recovery clears the error
    status = nextBlockStatus(status, 'SUCCESS');
    assert.equal(status, 'ready');
});
test('usage block rejects illegal transitions', () => {
    assert.equal(usageBlockMachine.id, 'usageBlock');
    assert.throws(() => nextBlockStatus('loading', 'RETRY'), /illegal usage block transition: loading --RETRY-->/);
    assert.throws(() => nextBlockStatus('error', 'REFRESH_FAILED'), /illegal usage block transition: error --REFRESH_FAILED-->/);
    assert.throws(() => nextBlockStatus('ready', 'RETRY'), /illegal usage block transition: ready --RETRY-->/);
});
