/**
 * CSV Export Utilities with Formula Injection Protection & UTF-8 BOM Support
 * 
 * Protects against CSV injection attacks where malicious formulas (=, +, -, @, |, %, \r, \t)
 * are executed by spreadsheet applications.
 * 
 * Adds UTF-8 BOM (Byte Order Mark) to ensure proper rendering of Amharic and other Unicode characters.
 */

/**
 * Escape a single CSV cell value to prevent formula injection.
 * If a value starts with =, +, -, @, |, %, \r, or \t, prefix with a single quote.
 */
function sanitizeCSVCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Formula injection prefixes
  if (/^[=+\-@|%\r\t]/.test(str)) {
    return `'${str.replace(/"/g, '""')}`;
  }
  // Standard CSV escaping for quotes and commas
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert a 2D array of data into a CSV string with UTF-8 BOM.
 * @param headers Array of column header strings
 * @param rows Array of row arrays
 * @returns CSV string with UTF-8 BOM prepended
 */
export function generateCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const sanitizedHeaders = headers.map(sanitizeCSVCell);
  const sanitizedRows = rows.map(row => row.map(sanitizeCSVCell));
  
  const csvLines = [
    sanitizedHeaders.join(','),
    ...sanitizedRows.map(row => row.join(','))
  ];
  
  // UTF-8 BOM ensures Excel/LibreOffice correctly interprets Amharic characters
  const BOM = '\uFEFF';
  return BOM + csvLines.join('\r\n');
}

/**
 * Trigger a CSV file download in the browser.
 * @param filename Name of the file (without path)
 * @param csvContent CSV string (should include BOM if Unicode)
 */
export function downloadCSV(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
