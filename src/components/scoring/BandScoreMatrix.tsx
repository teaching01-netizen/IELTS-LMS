import React, { useMemo } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { createBandScoreRows } from '../../utils/builderEnhancements';
import { DEFAULT_RUBRIC_DEVIATION_THRESHOLD } from '../../constants/examDefaults';

interface BandScoreMatrixProps {
  deviationThreshold?: number;
  moduleLabel: string;
  officialTable: Record<number, number>;
  onChange: (table: Record<number, number>) => void;
  table: Record<number, number>;
}

export function BandScoreMatrix({
  deviationThreshold = DEFAULT_RUBRIC_DEVIATION_THRESHOLD,
  moduleLabel,
  officialTable,
  onChange,
  table,
}: BandScoreMatrixProps) {
  const rows = useMemo(() => createBandScoreRows(table), [table]);
  const changedRows = rows.filter((row) => officialTable[row.raw] !== table[row.raw]).length;
  const hasDeviationWarning = changedRows > rows.length * (deviationThreshold / 100);

  return (
    <div className="rounded-[28px] border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-6 py-5 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-[0.2em]">
            {moduleLabel} Conversion
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Edit raw-to-band mapping. Hover rows for exact lookup.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const pdf = new jsPDF();
              pdf.setFontSize(14);
              pdf.text(`${moduleLabel} band score matrix`, 14, 16);
              rows.slice(0, 30).forEach((row, index) => {
                pdf.text(`Raw ${row.raw}: Band ${row.band}`, 14, 28 + index * 6);
              });
              pdf.save(`${moduleLabel.toLowerCase()}-band-matrix.pdf`);
            }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <Download size={14} /> Export PDF
          </button>
          <button
            onClick={() => onChange({ ...officialTable })}
            className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </div>

      {hasDeviationWarning && (
        <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">
          More than {deviationThreshold}% of rows differ from the official matrix.
        </div>
      )}

      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-xs font-black text-gray-400 uppercase tracking-[0.2em]">
              <th className="px-6 py-3">Raw</th>
              <th className="px-6 py-3">Band</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.raw}
                title={`Raw score ${row.raw} maps to band ${row.band}`}
                className="border-t border-gray-100"
              >
                <td className="px-6 py-3 font-semibold text-gray-800">{row.raw}</td>
                <td className="px-6 py-3">
                  <input
                    type="number"
                    min={0}
                    max={9}
                    step={0.5}
                    value={table[row.raw] ?? row.band}
                    onChange={(event) =>
                      onChange({
                        ...table,
                        [row.raw]: Number(event.target.value),
                      })
                    }
                    className="w-24 rounded-xl border border-gray-200 px-3 py-2 outline-none focus:border-blue-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
