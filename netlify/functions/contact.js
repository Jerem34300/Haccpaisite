/* contact.js — Netlify Function : formulaire de contact via Resend */
exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  var payload;
  try { payload = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const name    = (payload.name    || '').trim().slice(0, 120);
  const email   = (payload.email   || '').trim().slice(0, 200);
  const message = (payload.message || '').trim().slice(0, 3000);
  const type    = (payload.type    || 'autre').slice(0, 50);

  if (!name || !email || !message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nom, email et message requis' }) };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Adresse email invalide' }) };
  }

  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const typeLabels = { restaurant:'Restaurant', collectivite:'Restauration collective', traiteur:'Traiteur', ehpad:'EHPAD / Maison de retraite', autre:'Autre' };
  const typeLabel  = typeLabels[type] || 'Non précisé';
  const now        = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

  /* ── Email de notification interne → contact@hacc.pro ── */
  const notifHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F2F7;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
  <div style="background:#0F2240;padding:22px 28px;display:flex;align-items:center;gap:10px;">
    <div style="font-size:1.3rem;font-weight:900;color:#fff;">HACC<span style="color:#8DC63F;">.PRO</span></div>
    <div style="margin-left:auto;background:rgba(141,198,63,.2);color:#8DC63F;font-size:.75rem;font-weight:800;padding:4px 10px;border-radius:20px;">Nouveau message</div>
  </div>
  <div style="padding:28px;">
    <div style="font-size:1.1rem;font-weight:900;color:#0F2240;margin-bottom:18px;">📩 Message de ${esc(name)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:20px;">
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0ebf0;color:#7A6579;width:120px;font-weight:700;">De</td><td style="padding:8px 0;border-bottom:1px solid #f0ebf0;color:#0F2240;font-weight:800;">${esc(name)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0ebf0;color:#7A6579;font-weight:700;">Email</td><td style="padding:8px 0;border-bottom:1px solid #f0ebf0;"><a href="mailto:${esc(email)}" style="color:#0F2240;font-weight:800;">${esc(email)}</a></td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #f0ebf0;color:#7A6579;font-weight:700;">Type</td><td style="padding:8px 0;border-bottom:1px solid #f0ebf0;color:#0F2240;">${esc(typeLabel)}</td></tr>
      <tr><td style="padding:8px 0;color:#7A6579;font-weight:700;">Reçu le</td><td style="padding:8px 0;color:#0F2240;">${now}</td></tr>
    </table>
    <div style="background:#F7F2F7;border-radius:10px;padding:16px 18px;">
      <div style="font-size:.72rem;font-weight:900;color:#7A6579;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Message</div>
      <div style="font-size:.88rem;color:#3D2A3C;line-height:1.7;white-space:pre-wrap;">${esc(message)}</div>
    </div>
    <div style="margin-top:20px;">
      <a href="mailto:${esc(email)}?subject=Re:%20Votre%20message%20HACC.PRO" style="display:inline-block;background:#0F2240;color:#fff;padding:11px 22px;border-radius:10px;text-decoration:none;font-weight:900;font-size:.88rem;">Répondre à ${esc(name)} →</a>
    </div>
  </div>
</div>
</body></html>`;

  /* ── Auto-reply → expéditeur ── */
  const replyHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F2F7;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <div style="background:#0F2240;padding:28px 36px;text-align:center;">
    <div style="font-size:1.9rem;font-weight:900;color:#fff;">HACC<span style="color:#8DC63F;">.PRO</span></div>
    <div style="color:rgba(255,255,255,.55);font-size:.8rem;margin-top:4px;font-weight:600;">Le HACCP intelligent pour les professionnels</div>
  </div>
  <div style="padding:36px;">
    <div style="font-size:1.25rem;font-weight:900;color:#0F2240;margin-bottom:12px;">Votre message a bien été reçu ✓</div>
    <p style="color:#7A6579;line-height:1.75;margin:0 0 20px;">Bonjour ${esc(name)},</p>
    <p style="color:#7A6579;line-height:1.75;margin:0 0 20px;">Merci pour votre message. Notre équipe vous répondra <strong>dans les 24 heures ouvrées</strong> à l'adresse <strong>${esc(email)}</strong>.</p>
    <div style="background:#F7F2F7;border-radius:10px;padding:14px 18px;margin-bottom:24px;border-left:3px solid #8DC63F;">
      <div style="font-size:.72rem;font-weight:900;color:#7A6579;text-transform:uppercase;margin-bottom:6px;">Votre message</div>
      <div style="font-size:.85rem;color:#3D2A3C;line-height:1.65;white-space:pre-wrap;">${esc(message)}</div>
    </div>
    <p style="color:#7A6579;font-size:.85rem;line-height:1.7;margin:0 0 24px;">En attendant, vous pouvez démarrer votre <strong>essai gratuit de 14 jours</strong> pour découvrir comment HACC.PRO simplifie votre gestion HACCP au quotidien.</p>
    <a href="https://hacc.pro/signup.html" style="display:block;background:#8DC63F;color:#fff;text-align:center;padding:14px 24px;border-radius:14px;text-decoration:none;font-weight:900;font-size:.95rem;">
      Démarrer l'essai gratuit →
    </a>
    <p style="text-align:center;font-size:.73rem;color:#bbb;margin-top:10px;">Sans carte bancaire · Sans engagement</p>
  </div>
  <div style="padding:18px 36px 24px;border-top:1px solid #F0EBF0;text-align:center;font-size:.73rem;color:#bbb;line-height:1.7;">
    © 2025 HACC.PRO — <a href="https://hacc.pro/mentions-legales.html" style="color:#bbb;">Mentions légales</a> · <a href="https://hacc.pro/politique-confidentialite.html" style="color:#bbb;">Confidentialité</a><br>
    <a href="https://hacc.pro" style="color:#8DC63F;font-weight:700;">hacc.pro</a>
  </div>
</div>
</body></html>`;

  /* ── Envoi des deux emails via Resend ── */
  async function sendViaResend(from, to, subject, html) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Erreur Resend');
    return d;
  }

  try {
    await sendViaResend(
      'HACC.PRO <bonjour@hacc.pro>',
      'contact@hacc.pro',
      `[Contact] Message de ${name}`,
      notifHtml
    );
    await sendViaResend(
      'HACC.PRO <bonjour@hacc.pro>',
      email,
      'Votre message à HACC.PRO a bien été reçu',
      replyHtml
    );
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch(err) {
    console.error('[contact] error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur lors de l\'envoi' }) };
  }
};
