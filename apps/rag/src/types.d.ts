declare module 'pdf-parse' {
  const pdfParse: (data: Buffer | string) => Promise<{
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
  export default pdfParse;
}