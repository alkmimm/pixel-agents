/**
 * pixel-agents-secure (local): transcripts are read in capped chunks, and a
 * chunk can end in the middle of a multi-byte UTF-8 character (any accented
 * letter is two bytes). Decoding that chunk on its own turns the split
 * character into U+FFFD, and the rest of it, read next time, into another.
 *
 * Returns how many leading bytes of `buf` hold only whole characters: the
 * buffer's length, minus a trailing sequence that is incomplete. Bytes that
 * are not valid UTF-8 are never held back (they would never complete), so
 * this only ever withholds the last 1 to 3 bytes.
 */
export function completeUtf8Length(buf: Uint8Array): number {
  let i = buf.length - 1;
  let continuation = 0;
  // Walk back over continuation bytes (10xxxxxx) to the sequence's lead byte.
  while (i >= 0 && continuation < 3 && (buf[i] & 0xc0) === 0x80) {
    i--;
    continuation++;
  }
  if (i < 0) return buf.length;
  const lead = buf[i];
  const needed =
    (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1;
  // Only an incomplete multi-byte sequence is held back; ASCII, an invalid lead
  // byte, or a complete sequence leaves the whole buffer readable.
  return needed > 1 && continuation + 1 < needed ? i : buf.length;
}
