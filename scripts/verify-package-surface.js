const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Exercise the artifact consumers install, not just the repository checkout.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ontario-package-'));
async function verify() {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--json', '--pack-destination', temp], {encoding: 'utf8'});
    const packed = JSON.parse(output)[0];
    const files = new Set(packed.files.map(file => file.path));
    for (const required of ['api/lakes.js', 'lib/core.js', 'lib/catalog.js', 'lib/remote.js',
      'public/index.html', 'public/remote-trout-lake-finder/index.html', 'data/trout-index.json']) {
      assert.ok(files.has(required), `Package is missing production file: ${required}`);
    }
    execFileSync('tar', ['-xzf', path.join(temp, packed.filename), '-C', temp]);
    const handler = require(path.join(temp, 'package/api/lakes.js'));
    const index = require(path.join(temp, 'package/data/trout-index.json'));
    // Remote modes use the packaged index and must never require a live source.
    globalThis.fetch = async () => { throw new Error('Unexpected network request in packaged remote modes'); };
    for (const mode of ['remote', 'remote-map']) {
      let status = 200;
      let body;
      const response = {setHeader() {}, status(value) {status = value; return this;}, json(value) {body = value; return this;}};
      await handler({method: 'GET', query: {mode, species: 'Brook Trout', remote: 'easy', limit: '6', bbox: '-96,41,-74,57'}}, response);
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.coverageComplete, true);
      if (mode === 'remote') {
        assert.equal(body.lakes.length, 6);
        assert.deepEqual(body.indexSummary, index.summary);
        assert.ok(body.lakes.every(lake => Number.isFinite(lake.troutFit) && lake.targetEvidence.length > 0));
      } else {
        assert.ok(body.markers.length > 3000, 'Packaged map must retain full indexed coverage');
      }
    }
    console.log('PASS: packed Ontario package includes and executes its API, libraries, index and frontend surfaces.');
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
verify().catch(error => {console.error(error); process.exitCode = 1;});
