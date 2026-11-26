/** One wording for every Word Vault count: the panel, the preview and the commit receipt agree. */
export function wordCountLabel(count: number): string {
  return `${count} ${count === 1 ? "word" : "words"}`;
}

export interface WordVaultEntry {
  moduleKey: string;
  module: string;
  question: number;
  word: string;
  thai: string;
  definition: string;
  example: string;
}
