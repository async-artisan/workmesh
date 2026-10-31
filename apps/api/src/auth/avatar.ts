export function isValidAvatar(mimeType: string, data: Buffer) {
  if (mimeType === 'image/png')
    return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return data.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  return (
    mimeType === 'image/webp' &&
    data.subarray(0, 4).toString() === 'RIFF' &&
    data.subarray(8, 12).toString() === 'WEBP'
  );
}
