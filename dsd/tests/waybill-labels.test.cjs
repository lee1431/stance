/* node --test dsd/tests/waybill-labels.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const browser = {window:{}};
const source=fs.readFileSync(path.join(__dirname,'../assets/js/waybill.js'),'utf8');
vm.runInNewContext(source,browser);
const parse=browser.window.DSDWaybill.parse;

test('main 13 digits and two 16-digit package barcodes resolve to same master',()=>{
  const master=parse('2139-602-023214');
  const first=parse('2139-602-023214001');
  const second=parse('2139-602-023214002');
  assert.equal(master.lookup,'2139-602-023214');
  assert.equal(first.lookup,master.lookup);
  assert.equal(second.lookup,master.lookup);
  assert.equal(master.master_digits,'2139602023214');
  assert.equal(first.item_suffix,'001');
  assert.equal(second.item_suffix,'002');
  assert.notEqual(first.scanned,second.scanned);
});

test('digits-only 16 character labels use exactly first 13 digits',()=>{
  const item=parse('2139602023214002');
  assert.equal(item.lookup,'2139602023214');
  assert.equal(item.item_suffix,'002');
});

test('other carriers and malformed lengths are preserved, not truncated',()=>{
  for(const value of ['ABC123-45','123456789012','12345678901234567']){
    const parsed=parse(value);
    assert.equal(parsed.lookup,value);
    assert.equal(parsed.kind,'other');
  }
});

test('package index remains three characters including leading zeroes',()=>{
  const item=parse('2139-602-023214-007');
  assert.equal(item.lookup,'2139-602-023214');
  assert.equal(item.item_suffix,'007');
});
