import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Readable } from 'node:stream';
import { fromBufferPromise, type ZipFile } from 'yauzl';
import { CI_RESULT_REPORT_MAX_BYTES } from '@workmesh/shared';

export const ACTIONS_REPORT_FILENAME = 'workmesh-ci-results.json';
export const ACTIONS_ARCHIVE_MAX_BYTES = 16 * 1024 * 1024;
export const ACTIONS_ARCHIVE_MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
export const ACTIONS_ARCHIVE_MAX_ENTRIES = 32;

/** Fixed reason codes avoid leaking archive names, signed URLs or provider response bodies. */
export class ActionsArchiveError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export type ActionsArchiveReport = {
  bytes: Buffer;
  archiveSha256: string;
  reportSha256: string;
};

/** Read a single exact report in memory. Never extract paths or execute downloaded content. */
export async function readActionsReportArchive(
  archive: Uint8Array,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ActionsArchiveReport> {
  if (!archive.byteLength || archive.byteLength > ACTIONS_ARCHIVE_MAX_BYTES)
    throw new ActionsArchiveError('ARCHIVE_SIZE_LIMIT');
  let zip: ZipFile | undefined;
  let stream: Readable | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (error: Error) => void = () => undefined;
  let wasCancelled = false;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const cancel = (reason: string) => {
    wasCancelled = true;
    const error = new ActionsArchiveError(reason);
    stream?.destroy(error);
    zip?.close();
    rejectCancelled(error);
  };
  const abort = () => cancel('ARCHIVE_ABORTED');
  const work = async () => {
    if (options.signal?.aborted || wasCancelled) throw new ActionsArchiveError('ARCHIVE_ABORTED');
    zip = await fromBufferPromise(Buffer.from(archive), {
      lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true,
    });
    if (options.signal?.aborted || wasCancelled) {
      zip.close();
      throw new ActionsArchiveError('ARCHIVE_ABORTED');
    }
    if (zip.entryCount > ACTIONS_ARCHIVE_MAX_ENTRIES) throw new ActionsArchiveError('ARCHIVE_ENTRY_LIMIT');
    // One report file avoids ambiguous duplicates, nested bundles and executable companions.
    if (zip.entryCount !== 1) throw new ActionsArchiveError('ARCHIVE_REPORT_NOT_UNIQUE');
    let report: Buffer | null = null;
    let entries = 0;
    let expanded = 0;
    for await (const entry of zip.eachEntry()) {
      entries++;
      if (entries > ACTIONS_ARCHIVE_MAX_ENTRIES) throw new ActionsArchiveError('ARCHIVE_ENTRY_LIMIT');
      if (entry.fileName !== ACTIONS_REPORT_FILENAME ||
        !entry.fileNameRaw.equals(Buffer.from(ACTIONS_REPORT_FILENAME)))
        throw new ActionsArchiveError('ARCHIVE_PATH_NOT_ALLOWED');
      const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
      if ((unixType !== 0 && unixType !== 0x8000) || (entry.externalFileAttributes & 0x10) !== 0)
        throw new ActionsArchiveError('ARCHIVE_SPECIAL_FILE');
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod))
        throw new ActionsArchiveError('ARCHIVE_ENCODING_UNSUPPORTED');
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
        !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0 ||
        entry.uncompressedSize > CI_RESULT_REPORT_MAX_BYTES)
        throw new ActionsArchiveError('ARCHIVE_REPORT_SIZE_LIMIT');
      expanded += entry.uncompressedSize;
      if (expanded > ACTIONS_ARCHIVE_MAX_EXPANDED_BYTES)
        throw new ActionsArchiveError('ARCHIVE_EXPANDED_SIZE_LIMIT');
      const local = await zip.readLocalFileHeaderPromise(entry);
      if (!local.fileName.equals(entry.fileNameRaw) ||
        local.compressionMethod !== entry.compressionMethod ||
        local.generalPurposeBitFlag !== entry.generalPurposeBitFlag)
        throw new ActionsArchiveError('ARCHIVE_HEADER_MISMATCH');
      stream = await zip.openReadStreamPromise(entry);
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += bytes.byteLength;
        if (size > CI_RESULT_REPORT_MAX_BYTES || size > entry.uncompressedSize)
          throw new ActionsArchiveError('ARCHIVE_REPORT_SIZE_LIMIT');
        chunks.push(bytes);
      }
      stream = undefined;
      report = Buffer.concat(chunks, size);
      if (size !== entry.uncompressedSize || crc32(report) !== entry.crc32)
        throw new ActionsArchiveError('ARCHIVE_CHECKSUM_MISMATCH');
    }
    if (entries !== 1 || !report) throw new ActionsArchiveError('ARCHIVE_REPORT_NOT_UNIQUE');
    return {
      bytes: report,
      archiveSha256: createHash('sha256').update(archive).digest('hex'),
      reportSha256: createHash('sha256').update(report).digest('hex'),
    };
  };
  try {
    const timeoutMs = Math.min(10_000, Math.max(1, options.timeoutMs ?? 5_000));
    timer = setTimeout(() => cancel('ARCHIVE_TIMEOUT'), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    return await Promise.race([work(), cancelled]);
  } catch (error) {
    if (error instanceof ActionsArchiveError) throw error;
    throw new ActionsArchiveError('ARCHIVE_INVALID');
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    stream?.destroy();
    zip?.close();
  }
}
