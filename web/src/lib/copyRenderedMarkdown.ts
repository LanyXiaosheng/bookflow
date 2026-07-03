export function renderedMarkdownToPlainText(markdown: string): string {
  const normalized = markdown
    .replace(/\r\n/g, '\n')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return normalized
}
