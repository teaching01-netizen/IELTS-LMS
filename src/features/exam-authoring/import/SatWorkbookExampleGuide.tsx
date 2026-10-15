import type { SatWorkbookExample } from "./satWorkbookExamples";

export function SatWorkbookExampleGuide({ example }: { example: SatWorkbookExample }) {
  return (
    <div className="mt-4 rounded-xl border border-au-separator bg-au-surface p-3">
      <h3 className="text-sm font-semibold text-slate-900">Excel values → editor fields</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">Example only. Enter values in the same row of Questions for your own question.</p>
      <dl className="mt-3 space-y-3">
        {example.cells.slice(0, 3).map((cell) => <Cell key={cell.column} cell={cell} />)}
      </dl>
      <details className="mt-3 border-t border-au-separator pt-2">
        <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold text-au-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent">Answer columns and grading values</summary>
        <dl className="mt-2 space-y-3">{example.cells.slice(3).map((cell) => <Cell key={cell.column} cell={cell} />)}</dl>
      </details>
      {example.asset ? (
        <div className="mt-3 border-t border-au-separator pt-3 text-xs leading-5 text-slate-700">
          <p className="font-semibold">Assets sheet · same row</p>
          <p>A · Asset Key: <code>{example.asset.key}</code></p>
          <p>B · Alt Text: {example.asset.alt}</p>
          <p>C · Caption: optional; leave blank here.</p>
          <p>D · Image: insert the actual PNG, JPEG, GIF, or WebP graph image in this column. A filename or URL does not embed it.</p>
          <p className="mt-1">Use one image per row. The token in Stimulus must match the Asset Key exactly.</p>
        </div>
      ) : null}
      <p className="mt-3 border-t border-au-separator pt-3 text-xs leading-5 text-slate-600">Rationale → Explanation (staff only). Domain, Skill, Difficulty, and Tags → Classification. Module chooses the destination module; Order sets the question number. See Guide for required classification values.</p>
      <p className="mt-2 text-xs leading-5 text-slate-600">For an unused field, leave the Excel cell empty. Do not type “None” or “N/A”: that text would be imported.</p>
    </div>
  );
}

function Cell({ cell }: { cell: SatWorkbookExample["cells"][number] }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-800">{cell.column} <span className="font-normal text-slate-500">→ {cell.editor}</span></dt>
      <dd className="mt-1 whitespace-pre-wrap break-words rounded-md bg-au-fill px-2 py-1.5 font-mono text-xs leading-5 text-slate-700">{cell.value || <span className="font-sans italic text-slate-500">Leave blank</span>}</dd>
    </div>
  );
}
