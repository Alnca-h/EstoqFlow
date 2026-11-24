'use strict';

function parseYear(shortYear) {
  const n = Number(shortYear);
  return n <= 68 ? 2000 + n : 1900 + n;
}
function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{2}\/\d{2}\/\d{2}$/.test(value)) {
    throw Error('Informe uma data no formato dd/mm/aa.');
  }
  const [d, m, y] = value.split('/').map(Number);
  const year = parseYear(y);
  const date = new Date(Date.UTC(year, m - 1, d));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw Error('Data inválida.');
  }
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function normalizeMonth(value) {
  if (typeof value !== 'string' || !/^\d{2}\/\d{2}$/.test(value)) {
    throw Error('Informe mês e ano no formato mm/aa.');
  }
  const [month, yearShort] = value.split('/').map(Number);
  if (month < 1 || month > 12) throw Error('Mês inválido.');
  return `${parseYear(yearShort)}-${String(month).padStart(2, '0')}`;
}
function dateDisplay(iso) {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year.slice(-2)}`;
}
function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function currentPeriod() {
  return `${new Date().getMonth() + 1}`.padStart(2, '0') + '/' + `${new Date().getFullYear()}`.slice(-2);
}
module.exports = { normalizeDate, normalizeMonth, dateDisplay, localToday, currentPeriod };
