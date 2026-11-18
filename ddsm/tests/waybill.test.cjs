const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { window: {} };
const source = fs.readFileSync(path.join(__dirname, '..', 'waybill.js'), 'utf8');
vm.runInNewContext(source, context);
const parse = context.window.DDSM_Waybill.parse;

test('13 digit main label and both 16 digit item barcodes use same master', () => {
  const base = parse('2139602023214');
  const first = parse('2139602023214001');
  const second = parse('2139602023214002');
  assert.equal(base.master, '2139602023214');
  assert.equal(base.suffix, null);
  assert.equal(first.master, base.master);
  assert.equal(second.master, base.master);
  assert.equal(first.suffix, '001');
  assert.equal(second.suffix, '002');
  assert.notEqual(first.scanned, second.scanned);
});

test('hyphens and spaces are discarded for complete digit matching', () => {
  const x = parse('2139 - 602 - 023214 002');
  assert.equal(x.master, '2139602023214');
  assert.equal(x.lookup, '2139602023214');
  assert.equal(x.suffix, '002');
});

test('unrelated IDs are not truncated to 13 characters', () => {
  const x = parse('12345678901234567');
  assert.equal(x.valid, false);
  assert.equal(x.lookup, '12345678901234567');
});
