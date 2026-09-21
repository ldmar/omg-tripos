/* ============================================================
   ui/map.js · Pins + sheet
   ============================================================ */

export function init() {
  document.querySelectorAll('.pin').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('.pin').forEach(x => x.classList.remove('is-selected'));
      p.classList.add('is-selected');
      const icon = p.textContent.trim();
      document.getElementById('sheetIcon').textContent = icon;
      document.getElementById('sheetTitle').textContent = p.dataset.label;
      document.getElementById('sheetMeta').textContent = 'Seleccionado · cerca de ti';
    });
  });
}

export function render() { /* noop por ahora */ }