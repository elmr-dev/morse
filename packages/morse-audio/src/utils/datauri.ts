/**
 * Data URI utility - converts byte arrays to base64 data URIs
 *
 * Based on public domain code.
 */

/**
 * Convert a byte array to a base64 data URI
 *
 * @param data - Array of bytes (0-255)
 * @param mimeType - MIME type for the data URI
 * @returns Base64 encoded data URI string
 */
export function getDataURI(data: number[], mimeType: string): string {
  // Convert byte array to binary string
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }

  // Use btoa to encode as base64
  const base64 = btoa(binary);

  return `data:${mimeType};base64,${base64}`;
}
