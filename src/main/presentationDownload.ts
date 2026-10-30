import fs from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Limits are enforced before chunks reach disk; existing targets are never removed. */
export async function streamPresentationDownload(source: Readable, target: string, limits = { archive: 2 * 1024 ** 3, json: 32 * 1024 ** 2 }): Promise<void> {
  const file = await fs.open(target, 'wx', 0o600);
  let size = 0, prefix = Buffer.alloc(0), succeeded = false;
  try {
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (prefix.length < 2) prefix = Buffer.concat([prefix, chunk.subarray(0, 2 - prefix.length)]);
      const zip = prefix.length === 2 && prefix[0] === 0x50 && prefix[1] === 0x4b;
      if (size > (zip ? limits.archive : limits.json)) return callback(new Error('Presentation download exceeds size limit'));
      callback(null, chunk);
    } });
    await pipeline(source, limiter, file.createWriteStream({ autoClose: true }));
    succeeded = true;
  } finally {
    await file.close();
    if (!succeeded) await fs.unlink(target).catch(() => {});
  }
}
