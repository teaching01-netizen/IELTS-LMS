import type { ReactNode } from "react";
import type { WordVaultEntry } from "@shared/sat/wordVault";

export function SatWordVaultPaper({
  entries,
  examTitle,
  footer,
}: {
  entries: readonly WordVaultEntry[];
  examTitle: string;
  footer: ReactNode;
}) {
  const groups = new Map<string, WordVaultEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.moduleKey);
    if (group) group.push(entry);
    else groups.set(entry.moduleKey, [entry]);
  }

  return [...groups].map(([moduleKey, words]) => (
    <table key={moduleKey} className="sat-paper-table sat-paper-word-vault" data-word-vault-module={moduleKey}>
      <colgroup><col style={{ width: "27%" }} /><col style={{ width: "24%" }} /><col /></colgroup>
      <thead>
        <tr aria-label="Word Vault heading">
          <td colSpan={3}>
            <div className="sat-paper-runhead">
              <div className="sat-paper-runhead-title"><strong>{examTitle}</strong></div>
              <div className="sat-paper-runhead-context">
                <p>Reading &amp; Writing · {words[0]?.module}</p>
              </div>
            </div>
            <h2>The Word Vault</h2>
          </td>
        </tr>
        <tr>
          <th scope="col">Vocabulary</th>
          <th scope="col">Thai meaning</th>
          <th scope="col">English definition and example</th>
        </tr>
      </thead>
      <tbody>
        {words.map((entry, index) => (
          <tr key={index}>
            <th scope="row">
              <strong>{entry.word}</strong>
              <span>From Question {String(entry.question).padStart(2, "0")}</span>
            </th>
            <td lang="th">{entry.thai}</td>
            <td>
              <p>{entry.definition}</p>
              <p className="sat-word-vault-example"><strong>Example</strong> {entry.example}</p>
            </td>
          </tr>
        ))}
      </tbody>
      {footer}
    </table>
  ));
}
