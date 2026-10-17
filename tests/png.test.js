import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, setPngDpi } from '../web/admin/png.js';

// 1×1 transparent PNG, enough to exercise the chunk insertion.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=',
  'base64'
);

test('setPngDpi inserts a valid pHYs chunk immediately after IHDR', () => {
  const output = Buffer.from(setPngDpi(TINY_PNG, 300));

  assert.equal(output.length, TINY_PNG.length + 21);
  assert.equal(output.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(output.readUInt32BE(33), 9);
  assert.equal(output.subarray(37, 41).toString('ascii'), 'pHYs');
  assert.equal(output.readUInt32BE(41), 11811);
  assert.equal(output.readUInt32BE(45), 11811);
  assert.equal(output[49], 1);
  assert.equal(output.readUInt32BE(50), crc32(output.subarray(37, 50)));
  assert.deepEqual(output.subarray(54), TINY_PNG.subarray(33));
});

test('setPngDpi rejects bytes that are not PNG', () => {
  assert.throws(() => setPngDpi(new Uint8Array([1, 2, 3])), /Not a PNG/);
  assert.throws(() => setPngDpi(new TextEncoder().encode('not a png')), /Not a PNG/);
});

test('crc32 returns the standard PNG check value for IEND', () => {
  // IEND chunk data is empty; CRC is over the four type bytes.
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082);
});
