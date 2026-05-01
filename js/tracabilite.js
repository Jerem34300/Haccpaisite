/**
 * tracabilite.js — Moteur de traçabilité HACCP bidirectionnel v1
 *
 * Fonctionnalités :
 *   1. Lifecycle tracking : suit le cycle complet d'un plat
 *      (réception → cuisson → refroidissement → remise T° → service)
 *   2. Auto-liaisons : détecte et propose les liens entre ENR du même plat
 *   3. Variantes : gère mixé/sans sel/HP liés au plat principal
 *   4. IA recettes : via Claude Haiku, identifie ingrédients + profils HACCP
 *
 * Intégration (sans modifier app-cuisine.js) :
 *   - Patche SupaEngine.enqueue pour intercepter les sauvegardes
 *   - Patche fillFormWithPlat pour déclencher les suggestions
 *   - Étend le banner de liaison existant (mn-link-banner-*)
 */

const Tracabilite = (() => {
  const LIFECYCLE_KEY = 'haccp_lifecycle_v1';
  const IA_CACHE_KEY  = 'haccp_recette_ia_v1';
  const IA_ENDPOINT   = '/.netlify/functions/recette-ia';
  const IA_CACHE_TTL  = 30 * 24 * 3600 * 1000; // 30 jours

  // Métadonnées de chaque ENR dans la chaîne HACCP
  const ENR_META = {
    enr08:          { icon: '📦', label: 'Réception / BF Cru',  step: 1, color: '#16a34a' },
    enr23:          { icon: '🔗', label: 'Liaison froide',        step: 2, color: '#0284c7' },
    enr01:          { icon: '❄️', label: 'Refroidissement',       step: 3, color: '#7c3aed' },
    enr07:          { icon: '🥘', label: 'Remise en T°',          step: 4, color: '#dc2626' },
    enr_tc_distrib: { icon: '🌡️', label: 'T° distribution',      step: 5, color: '#d97706' },
    enr33:          { icon: '🧪', label: 'Plat témoin',           step: 6, color: '#5C1E5A' },
    enr34:          { icon: '🏷️', label: 'Étiquette',            step: 7, color: '#c93a78' },
  };

  // Fenêtres temporelles pour l'auto-liaison (en heures)
  const LINK_WINDOWS = {
    enr01_from_enr07:          2,   // Refroidissement dans les 2h après BF cuit
    enr01_from_enr08:          4,   // Refroidissement après réception cru
    enr07_from_enr01:         72,   // Remise T° jusqu'à 72h après refroidissement
    enr07_from_enr23:         48,   // Remise T° jusqu'à 48h après liaison froide
    enr33_from_enr07:          6,   // Plat témoin dans les 6h après remise T°
    enr33_from_enr01:          6,   // Plat témoin dans les 6h après refroidissement
    enr33_from_enr08:          4,   // Plat témoin après sortie cru directe
    enr34_from_enr33:         24,   // Étiquette dans les 24h après plat témoin
    enr_tc_distrib_from_enr07: 4,   // T° distrib après remise T°
    enr_tc_distrib_from_enr08: 4,   // T° distrib après sortie cru
  };

  // ── Stockage lifecycle ─────────────────────────────────────────
  function _getAll() {
    try { return JSON.parse(localStorage.getItem(LIFECYCLE_KEY) || '{}'); } catch { return {}; }
  }
  function _setAll(d) {
    try { localStorage.setItem(LIFECYCLE_KEY, JSON.stringify(d)); } catch(e) {}
  }

  function getLifecycle(platId) {
    return _getAll()[platId] || null;
  }

  function upsertLifecycle(platId, updates) {
    const all = _getAll();
    all[platId] = { ...(all[platId] || { platId, steps: {} }), ...updates, platId };
    _setAll(all);
    return all[platId];
  }

  function addStepToLifecycle(platId, enrType, record) {
    const all = _getAll();
    const lc = all[platId] || { platId, steps: {} };
    lc.steps = lc.steps || {};
    // enr33/enr34 : plusieurs entrées (variantes)
    if (enrType === 'enr33' || enrType === 'enr34') {
      if (!Array.isArray(lc.steps[enrType])) lc.steps[enrType] = [];
      lc.steps[enrType].push({
        _ts:     record._ts,
        date:    record.date || (record._ts || '').slice(0, 10),
        variant: record.variant || record._variant || '',
      });
    } else {
      lc.steps[enrType] = {
        _ts:    record._ts,
        date:   record.date || (record._ts || '').slice(0, 10),
        produit: record.produit || record.libelle || '',
      };
    }
    lc.lastUpdated = new Date().toISOString();
    all[platId] = lc;
    _setAll(all);
    return lc;
  }

  // ── Auto-liaison ───────────────────────────────────────────────
  function _normStr(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, ' ').trim();
  }

  /**
   * Cherche dans S[enrType].lignes les enregistrements du même plat
   * dans la fenêtre de temps définie, et retourne les candidats.
   */
  function findCandidates(targetEnrType, platId, platNom, refTs) {
    const refTime    = refTs ? new Date(refTs).getTime() : Date.now();
    const normTarget = _normStr(platNom);
    const candidates = [];

    const predecessors = Object.keys(LINK_WINDOWS)
      .filter(k => k.startsWith(targetEnrType + '_from_'))
      .map(k => ({
        enrType:  k.replace(targetEnrType + '_from_', ''),
        maxHours: LINK_WINDOWS[k],
      }));

    for (const { enrType, maxHours } of predecessors) {
      const lignes = (typeof S !== 'undefined' && S[enrType]?.lignes) || [];
      const maxMs  = maxHours * 3600 * 1000;

      for (const ligne of lignes) {
        const byId   = platId && ligne._plat_id && ligne._plat_id === platId;
        const byName = normTarget && _normStr(ligne.produit || ligne.libelle || '') === normTarget;
        if (!byId && !byName) continue;

        const lTs = ligne._ts ? new Date(ligne._ts).getTime() : 0;
        const gap  = refTime - lTs;
        // Fenêtre : la source est dans le passé et pas trop ancienne
        if (lTs > 0 && (gap < 0 || gap > maxMs)) continue;

        candidates.push({
          enrType,
          _ts:        ligne._ts,
          date:       ligne.date || (ligne._ts || '').slice(0, 10),
          heure:      ligne.heure || '',
          produit:    ligne.produit || ligne.libelle || platNom || '',
          matchType:  byId ? 'id' : 'nom',
          confidence: byId ? 'haute' : 'moyenne',
          score:      byId ? 100 : 70,
          _plat_id:   ligne._plat_id || platId,
        });
      }
    }
    return candidates.sort((a, b) => b.score - a.score);
  }

  // ── Rendu timeline ─────────────────────────────────────────────
  function renderTimelineHTML(platId, platNom) {
    // Chercher les steps dans le lifecycle local ET dans S[]
    const foundSteps = {};
    const lc = getLifecycle(platId);
    if (lc?.steps) Object.assign(foundSteps, lc.steps);

    if (typeof S !== 'undefined') {
      for (const enrType of Object.keys(ENR_META)) {
        if (foundSteps[enrType]) continue;
        const lignes = S[enrType]?.lignes || [];
        const match  = lignes.find(l =>
          (platId && l._plat_id === platId) ||
          (platNom && _normStr(l.produit || l.libelle || '') === _normStr(platNom))
        );
        if (match) {
          foundSteps[enrType] = {
            _ts:  match._ts,
            date: match.date || (match._ts || '').slice(0, 10),
          };
        }
      }
    }

    const present = Object.keys(ENR_META)
      .filter(et => foundSteps[et])
      .sort((a, b) => ENR_META[a].step - ENR_META[b].step);

    if (!present.length) return '';

    const dots = present.map(et => {
      const meta = ENR_META[et];
      const step = foundSteps[et];
      const dateStr  = Array.isArray(step) ? step[0]?.date : step.date;
      const dateFmt  = dateStr ? dateStr.slice(5).replace('-', '/') : '';
      return `<div class="trc-step">
        <span class="trc-icon">${meta.icon}</span>
        <span class="trc-label">${meta.label}</span>
        ${dateFmt ? `<span class="trc-date">${dateFmt}</span>` : ''}
      </div>`;
    }).join('<span class="trc-arrow">→</span>');

    return `<div class="trc-timeline" id="trc-tl-${platId}">
      <div class="trc-title">📋 Cycle HACCP du plat</div>
      <div class="trc-steps">${dots}</div>
    </div>`;
  }

  // ── Rendu suggestions ──────────────────────────────────────────
  function renderSuggestionsHTML(targetEnrType, platId, platNom) {
    const candidates = findCandidates(targetEnrType, platId, platNom, new Date().toISOString());
    if (!candidates.length) return '';

    const items = candidates.slice(0, 2).map(c => {
      const meta    = ENR_META[c.enrType] || {};
      const dateStr = c.date ? c.date.slice(5).replace('-', '/') : '';
      const hStr    = c.heure ? ` à ${c.heure}` : '';
      const safeTs  = (c._ts || '').replace(/'/g, '');
      return `<div class="trc-suggestion-item">
        ${meta.icon || '🔗'} <strong>${meta.label || c.enrType}</strong> du ${dateStr}${hStr}
        <span class="trc-conf trc-conf-${c.confidence}">${c.confidence}</span>
        <button class="trc-link-btn"
          onclick="Tracabilite.applyAutoLink('${targetEnrType}','${safeTs}','${c.enrType}')">
          ✅ Lier
        </button>
      </div>`;
    }).join('');

    return `<div class="trc-suggestions">
      <div class="trc-sugg-title">💡 Auto-liaisons détectées</div>
      ${items}
    </div>`;
  }

  // ── Appliquer un auto-lien ─────────────────────────────────────
  function applyAutoLink(targetEnrType, sourceTs, sourceEnrType) {
    try {
      const sourceLigne = ((typeof S !== 'undefined' && S[sourceEnrType]?.lignes) || [])
        .find(l => l._ts === sourceTs);
      if (!sourceLigne) return;

      if (typeof S !== 'undefined') {
        S[targetEnrType]       = S[targetEnrType] || {};
        S[targetEnrType].draft = S[targetEnrType].draft || {};
        const draft = S[targetEnrType].draft;

        if (!draft.produit && sourceLigne.produit) draft.produit = sourceLigne.produit;
        draft[`_${sourceEnrType}_ts`] = sourceTs;
        draft._linked_from = sourceEnrType;
        draft._linked_ts   = sourceTs;

        if (sourceLigne._plat_id) {
          draft._plat_id  = sourceLigne._plat_id;
          draft._plat_nom = sourceLigne._plat_nom || sourceLigne.produit || '';
          draft._menu_id  = sourceLigne._menu_id  || '';
        }

        if (typeof save === 'function') save();

        // Mettre à jour le DOM si le champ est visible
        const inp = document.getElementById(`ac-produit-${targetEnrType}`)
          || document.getElementById(`inp-produit-${targetEnrType}`);
        if (inp && !inp.value && draft.produit) {
          inp.value = draft.produit;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      // Rafraîchir la timeline
      const platId = (typeof S !== 'undefined' && S[targetEnrType]?.draft?._plat_id) || '';
      if (platId) {
        setTimeout(() => {
          const el = document.getElementById(`trc-tl-${platId}`);
          if (el) {
            const lc = getLifecycle(platId);
            const html = renderTimelineHTML(platId, lc?.platNom || '');
            if (html) el.outerHTML = html;
          }
        }, 100);
      }

      if (typeof toast === 'function') {
        const m = ENR_META[sourceEnrType] || {};
        toast(`✅ Lié à ${m.icon || ''} ${m.label || sourceEnrType}`, 'success');
      }
    } catch(e) {
      console.warn('[Tracabilite] applyAutoLink:', e);
    }
  }

  // ── IA Recettes ────────────────────────────────────────────────
  async function getRecetteIA(platNom, service) {
    if (!platNom) return null;
    const key = _normStr(platNom);

    try {
      const cache  = JSON.parse(localStorage.getItem(IA_CACHE_KEY) || '{}');
      const cached = cache[key];
      if (cached && (Date.now() - (cached.cached_at || 0)) < IA_CACHE_TTL) return cached;
    } catch(e) {}

    try {
      const r = await fetch(IA_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platNom, service: service || '' }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data?.ingredients) return null;

      data.cached_at   = Date.now();
      data.platNomNorm = key;
      try {
        const cache = JSON.parse(localStorage.getItem(IA_CACHE_KEY) || '{}');
        cache[key]  = data;
        localStorage.setItem(IA_CACHE_KEY, JSON.stringify(cache));
      } catch(e) {}
      return data;
    } catch(e) {
      console.warn('[Tracabilite] getRecetteIA:', e);
      return null;
    }
  }

  // ── Rendu panel recette ────────────────────────────────────────
  async function _renderRecetteAsync(platId, platNom, service, containerEl) {
    if (!containerEl || !platNom) return;
    containerEl.innerHTML = `<div class="trc-recette-loading">⏳ Analyse IA…</div>`;

    const recette = await getRecetteIA(platNom, service);
    if (!recette?.ingredients?.length) { containerEl.innerHTML = ''; return; }

    if (platId) upsertLifecycle(platId, { recette });

    const PROFIL_ICONS = { BF_CUIT: '🥘', BF_CRU: '🥗', SORTIE_DIRECTE: '📦', REMISE_TC: '🔥', PREPARE_MINUTE: '⚡' };
    const chips = recette.ingredients.map((ing, i) => {
      const ico = PROFIL_ICONS[ing.profil_haccp] || '📋';
      return `<span class="trc-ing-chip" data-idx="${i}" title="${ing.profil_haccp || ''}">${ico} ${ing.nom}</span>`;
    }).join('');

    containerEl.innerHTML = `<div class="trc-recette">
      <div class="trc-recette-title">📋 Composition IA · ${recette.profil_plat || ''}</div>
      <div class="trc-recette-chips">${chips}</div>
      <div class="trc-recette-hint">Tap sur un ingrédient → tracer sa réception (ENR08)</div>
    </div>`;

    containerEl.querySelectorAll('.trc-ing-chip').forEach(chip => {
      chip.style.cursor = 'pointer';
      const ing = recette.ingredients[parseInt(chip.dataset.idx)];
      if (!ing) return;
      chip.onclick = () => _proposeReceptionIngredient(ing, platId, platNom);
    });
  }

  function _proposeReceptionIngredient(ing, platId, platNom) {
    if (typeof S !== 'undefined') {
      S.enr08       = S.enr08 || {};
      S.enr08.draft = S.enr08.draft || {};
      S.enr08.draft.produit           = ing.nom;
      S.enr08.draft._linked_to_plat   = platId;
      S.enr08.draft._linked_to_nom    = platNom;
      if (typeof save === 'function') save();
    }
    if (typeof toast === 'function') {
      toast(`💡 "${ing.nom}" pré-rempli dans ENR08 — allez y saisir la réception`, 'info');
    }
    // Naviguer vers ENR08 si la fonction est dispo
    if (typeof goTo === 'function') goTo('enr08');
  }

  // ── Injection dans le banner existant ──────────────────────────
  function _injectLifecycleInBanner(enrId, ref) {
    const banner = document.getElementById('mn-link-banner-' + enrId);
    if (!banner) return;
    if (banner.querySelector('.trc-banner-extra')) return; // déjà injecté

    const timelineHtml    = renderTimelineHTML(ref.plat_id, ref.nom);
    const suggestionsHtml = renderSuggestionsHTML(enrId, ref.plat_id, ref.nom);

    if (!timelineHtml && !suggestionsHtml) {
      // Même sans contenu existant, préparer le container recette
    }

    const extra = document.createElement('div');
    extra.className = 'trc-banner-extra';
    extra.innerHTML = (suggestionsHtml || '') + (timelineHtml || '');
    banner.appendChild(extra);

    // Panel recette asynchrone
    const recetteContainer = document.createElement('div');
    recetteContainer.className = 'trc-recette-container';
    banner.appendChild(recetteContainer);

    const service = (typeof S !== 'undefined' && S.config?.service) || '';
    _renderRecetteAsync(ref.plat_id, ref.nom, service, recetteContainer);
  }

  // ── Hook SupaEngine.enqueue ────────────────────────────────────
  function _hookEnqueue() {
    if (!window.SupaEngine?.enqueue) { setTimeout(_hookEnqueue, 500); return; }
    if (window.__trcEnqueueHooked) return;
    const orig = SupaEngine.enqueue.bind(SupaEngine);
    SupaEngine.enqueue = function(enrType, record) {
      const r = orig(enrType, record);
      try {
        if (ENR_META[enrType] && record._plat_id) {
          addStepToLifecycle(record._plat_id, enrType, record);
          const lc = getLifecycle(record._plat_id);
          if (!lc?.platNom) {
            upsertLifecycle(record._plat_id, {
              platNom: record._plat_nom || record.produit || '',
              menuId:  record._menu_id  || '',
            });
          }
        }
      } catch(e) {}
      return r;
    };
    window.__trcEnqueueHooked = true;
  }

  // ── Hook fillFormWithPlat ──────────────────────────────────────
  function _hookFillForm() {
    if (typeof window.fillFormWithPlat !== 'function') {
      setTimeout(_hookFillForm, 500);
      return;
    }
    if (window.__trcFillFormHooked) return;
    const orig = window.fillFormWithPlat;
    window.fillFormWithPlat = function(enrId, ref) {
      const r = orig.apply(this, arguments);
      try {
        if (ref?.plat_id) {
          if (!getLifecycle(ref.plat_id)) {
            upsertLifecycle(ref.plat_id, {
              platNom: ref.nom,
              menuId:  ref.menu_id  || '',
              profil:  ref.profil_haccp || '',
            });
          }
          setTimeout(() => _injectLifecycleInBanner(enrId, ref), 80);
          // Analyse IA en tâche de fond
          getRecetteIA(ref.nom).then(recette => {
            if (recette) upsertLifecycle(ref.plat_id, { recette });
          });
        }
      } catch(e) {}
      return r;
    };
    window.__trcFillFormHooked = true;
  }

  // ── Nettoyage periodique (lifecycles > 14 jours) ───────────────
  function _prune() {
    try {
      const all    = _getAll();
      const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      let changed  = false;
      for (const [id, lc] of Object.entries(all)) {
        if ((lc.lastUpdated || '') < cutoff) { delete all[id]; changed = true; }
      }
      if (changed) _setAll(all);
    } catch(e) {}
  }

  // ── Init ───────────────────────────────────────────────────────
  function _init() {
    _hookEnqueue();
    _hookFillForm();
    _prune();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    setTimeout(_init, 200);
  }

  return { getLifecycle, addStepToLifecycle, findCandidates, renderTimelineHTML, getRecetteIA, applyAutoLink };
})();
