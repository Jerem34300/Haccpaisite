/* send-email.js — Netlify Function : envoi transactionnel via Resend */
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  var RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY manquante' }) };
  }

  var payload;
  try { payload = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  var type     = payload.type || 'welcome';
  var to       = payload.to   || '';
  var company  = payload.company || '';
  var plan     = payload.plan    || 'starter';

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Adresse email invalide' }) };
  }

  var subject, html;

  if (type === 'welcome') {
    subject = '🎉 Bienvenue sur HACC.PRO — votre essai est activé !';
    html = _buildWelcomeEmail(to, company, plan);
  } else if (type === 'confirm') {
    var confirmUrl = payload.confirmUrl || 'https://hacc.pro/login.html';
    subject = 'Confirmez votre adresse email HACC.PRO';
    html = _buildConfirmEmail(to, confirmUrl);
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Type inconnu' }) };
  }

  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:    'HACC.PRO <bonjour@hacc.pro>',
        to:      [to],
        subject: subject,
        html:    html
      })
    });

    var data = await res.json();
    if (!res.ok) {
      console.error('[send-email] Resend error:', data);
      return { statusCode: 502, body: JSON.stringify({ error: data.message || 'Erreur Resend' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ id: data.id }) };
  } catch(err) {
    console.error('[send-email] fetch error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur réseau' }) };
  }
};

/* ─── Templates email ─── */

function _buildWelcomeEmail(email, company, plan) {
  var planLabel = plan === 'pro' ? 'Plan Pro' : plan === 'enterprise' ? 'Plan Enterprise' : 'Plan Starter';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F7F2F7;font-family:\'Helvetica Neue\',Arial,sans-serif;">' +
    '<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">' +
    '<div style="background:#0F2240;padding:32px 36px;text-align:center;">' +
    '<div style="font-size:2rem;font-weight:900;color:#fff;">HACC<span style="color:#8DC63F;">.PRO</span></div>' +
    '<div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-top:4px;">Le HACCP intelligent pour les pros</div>' +
    '</div>' +
    '<div style="padding:36px;">' +
    '<div style="font-size:1.4rem;font-weight:900;color:#0F2240;margin-bottom:12px;">Bienvenue ' + (company ? 'chez ' + _escape(company) : '') + ' ! 🎉</div>' +
    '<p style="color:#7A6579;line-height:1.7;margin-bottom:20px;">Votre essai gratuit de 14 jours est activé. Complétez votre configuration en quelques minutes pour commencer à tracer vos températures, plats témoins et bien plus.</p>' +
    '<div style="background:#F7F2F7;border-radius:12px;padding:16px 20px;margin-bottom:24px;">' +
    '<div style="font-size:.75rem;font-weight:900;color:#7A6579;text-transform:uppercase;margin-bottom:8px;">Votre abonnement</div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-weight:800;color:#0F2240;">' +
    '<span style="color:#8DC63F;">✓</span> ' + planLabel + ' — essai 14 jours gratuit' +
    '</div></div>' +
    '<a href="https://hacc.pro/onboarding.html" style="display:block;background:#8DC63F;color:#fff;text-align:center;padding:16px;border-radius:12px;text-decoration:none;font-weight:900;font-size:1rem;">Configurer mon espace →</a>' +
    '</div>' +
    '<div style="padding:20px 36px;border-top:1px solid #F0EBF0;text-align:center;font-size:.75rem;color:#aaa;">' +
    'Vous recevez cet email car vous venez de créer un compte HACC.PRO avec ' + _escape(email) + '.<br>' +
    '<a href="https://hacc.pro" style="color:#8DC63F;">hacc.pro</a>' +
    '</div></div></body></html>';
}

function _buildConfirmEmail(email, confirmUrl) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F7F2F7;font-family:\'Helvetica Neue\',Arial,sans-serif;">' +
    '<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">' +
    '<div style="background:#0F2240;padding:32px 36px;text-align:center;">' +
    '<div style="font-size:2rem;font-weight:900;color:#fff;">HACC<span style="color:#8DC63F;">.PRO</span></div>' +
    '</div>' +
    '<div style="padding:36px;">' +
    '<div style="font-size:1.3rem;font-weight:900;color:#0F2240;margin-bottom:12px;">Confirmez votre adresse email</div>' +
    '<p style="color:#7A6579;line-height:1.7;margin-bottom:24px;">Cliquez sur le bouton ci-dessous pour valider votre compte HACC.PRO et accéder à votre espace de gestion HACCP.</p>' +
    '<a href="' + confirmUrl + '" style="display:block;background:#0F2240;color:#fff;text-align:center;padding:16px;border-radius:12px;text-decoration:none;font-weight:900;font-size:1rem;">Confirmer mon adresse →</a>' +
    '<p style="color:#aaa;font-size:.78rem;margin-top:16px;text-align:center;">Ce lien expire dans 24h. Si vous n\'avez pas créé de compte, ignorez cet email.</p>' +
    '</div></div></body></html>';
}

function _escape(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
