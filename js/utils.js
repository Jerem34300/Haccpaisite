/**
   * utils.js — Utilitaires partagés entre toutes les pages HACC.PRO
   *
   * Contient : formatage de dates, escape HTML, génération d'UUID,
   * helpers localStorage, et fonctions de bas niveau réutilisables.
   */

  // ── Escape HTML (protection XSS) ──
  var escH = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ── Génération UUID (stable, déduplication sync) ──
  function newUUID() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
  }

  // ── Date / heure ──
  var today  = () => new Date().toISOString().slice(0, 10);
  var nowT   = () => new Date().toTimeString().slice(0, 5);
  var nowDT  = () => new Date().toISOString().slice(0, 16);

  /**
   * Formate une date ISO en date française.
   * @param {string} iso - Date au format ISO (YYYY-MM-DD ou complet)
   * @returns {string}
   */
  function fmtDateFr(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR');
    } catch(e) { return iso; }
  }

  // ── Tampon UUID + date de création sur une entrée ──
  function stampEntry(obj) {
    if (!obj._uuid)    obj._uuid    = newUUID();
    if (!obj._created) obj._created = new Date().toISOString();
    return obj;
  }
  