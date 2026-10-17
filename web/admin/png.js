// Add a proper pHYs chunk to a browser-generated PNG so print software sees
// 300 DPI instead of the default 96 DPI. Pure and unit-tested.

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32(array, offset, value) {
  array[offset] = (value >>> 24) & 0xff;
  array[offset + 1] = (value >>> 16) & 0xff;
  array[offset + 2] = (value >>> 8) & 0xff;
  array[offset + 3] = value & 0xff;
}

function readUint32(array, offset) {
  return (
    (array[offset] << 24)
    | (array[offset + 1] << 16)
    | (array[offset + 2] << 8)
    | array[offset + 3]
  ) >>> 0;
}

export function setPngDpi(input, dpi = 300) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 33) throw new Error('Not a PNG');
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG');
  }

  const firstLength = readUint32(bytes, 8);
  const firstType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (firstType !== 'IHDR' || firstLength !== 13) throw new Error('Invalid PNG header');
  const insertAt = 8 + 4 + 4 + firstLength + 4;

  const pixelsPerMetre = Math.round(Number(dpi) * 39.37007874015748);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  writeUint32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  writeUint32(chunk, 8, pixelsPerMetre);
  writeUint32(chunk, 12, pixelsPerMetre);
  chunk[16] = 1; // unit: metre
  writeUint32(chunk, 17, crc32(chunk.subarray(4, 17)));

  const output = new Uint8Array(bytes.length + chunk.length);
  output.set(bytes.subarray(0, insertAt), 0);
  output.set(chunk, insertAt);
  output.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return output;
}

export async function pngBlobWithDpi(blob, dpi = 300) {
  const buffer = await blob.arrayBuffer();
  return new Blob([setPngDpi(new Uint8Array(buffer), dpi)], { type: 'image/png' });
}
