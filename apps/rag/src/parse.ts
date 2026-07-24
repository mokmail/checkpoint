import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export interface ParsedFile {
  text: string;
  title: string;
}

export async function parseFile(filename: string, data: Buffer): Promise<ParsedFile> {
  const lower = filename.toLowerCase();
  const title = filename.replace(/\.[^.]+$/, '');

  if (lower.endsWith('.pdf')) {
    const res = await pdfParse(data);
    return { text: res.text, title };
  }
  if (lower.endsWith('.docx')) {
    const res = await mammoth.extractRawText({ buffer: data });
    return { text: res.value, title };
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { text: data.toString('utf-8'), title };
  }
  if (lower.endsWith('.json')) {
    try {
      const obj = JSON.parse(data.toString('utf-8'));
      return { text: JSON.stringify(obj, null, 2), title };
    } catch {
      return { text: data.toString('utf-8'), title };
    }
  }
  // default: treat as text
  return { text: data.toString('utf-8'), title };
}

export function chunkText(text: string, size = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return chunks;
}