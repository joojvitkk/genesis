// Exporta um array de objetos planos para CSV e dispara o download.

function escapeCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Previne injeção de fórmula em Excel/Sheets
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Escapa aspas duplicando-as
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

export function exportToCSV(data, filename) {
  if (!Array.isArray(data) || data.length === 0) return;

  const keys = Object.keys(data[0]);
  const csv = [
    keys.map(escapeCell).join(','),
    ...data.map(row => keys.map(k => escapeCell(row[k])).join(',')),
  ].join('\r\n');

  // BOM para acentuação correta no Excel
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// compat: mantém o named export antigo
export default exportToCSV;
