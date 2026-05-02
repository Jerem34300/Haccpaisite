/* send-email.js — Netlify Function : envoi transactionnel via Resend */
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  var RESEND_API_KEY      = process.env.RESEND_API_KEY;
  var SUPABASE_URL        = process.env.SUPABASE_URL || 'https://lthxpucxjcwzphshdhmp.supabase.co';
  var SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY manquante' }) };
  }

  var payload;
  try { payload = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  var type    = payload.type || 'welcome';
  var to      = payload.to   || '';
  var company = payload.company || '';
  var plan    = payload.plan    || 'solo';

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Adresse email invalide' }) };
  }

  var subject, html, from;
  from = 'HACC.PRO <bonjour@hacc.pro>';

  if (type === 'welcome') {
    subject = '🎉 Votre espace HACC.PRO est prêt — finalisez votre installation';
    html    = _buildWelcomeEmail(to, company, plan);

  } else if (type === 'confirm') {
    var confirmUrl = payload.confirmUrl || 'https://hacc.pro/login.html';
    subject = 'Confirmez votre adresse email HACC.PRO';
    html    = _buildConfirmEmail(to, confirmUrl);

  } else if (type === 'reset') {
    if (!SUPABASE_SERVICE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_SERVICE_KEY manquante' }) };
    }
    // Générer le lien de reset via Supabase Admin API
    var linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify({
        type:    'recovery',
        email:   to,
        options: { redirectTo: 'https://hacc.pro/reset-password.html' }
      })
    });
    var linkData = await linkRes.json();
    if (!linkRes.ok || !linkData.action_link) {
      console.error('[send-email] generate_link error:', linkData);
      return { statusCode: 502, body: JSON.stringify({ error: 'Impossible de générer le lien de réinitialisation' }) };
    }
    subject = 'Réinitialisez votre mot de passe HACC.PRO';
    html    = _buildResetEmail(to, linkData.action_link);

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
      body: JSON.stringify({ from, to: [to], subject, html })
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

/* ─── Styles partagés ─── */
function _wrap(content) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F2F7;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <!-- Header -->
  <div style="background:#0F2240;padding:28px 36px;text-align:center;">
    <div style="font-size:1.9rem;font-weight:900;color:#fff;letter-spacing:-.5px;">HACC<span style="color:#8DC63F;">.PRO</span></div>
    <div style="color:rgba(255,255,255,.55);font-size:.8rem;margin-top:4px;font-weight:600;">Le HACCP intelligent pour les professionnels</div>
  </div>
  <!-- Body -->
  <div style="padding:36px;">
    ${content}
  </div>
  <!-- Footer -->
  <div style="padding:20px 36px 28px;border-top:1px solid #F0EBF0;text-align:center;font-size:.73rem;color:#bbb;line-height:1.7;">
    © 2025 HACC.PRO — <a href="https://hacc.pro/mentions-legales.html" style="color:#bbb;">Mentions légales</a> · <a href="https://hacc.pro/politique-confidentialite.html" style="color:#bbb;">Confidentialité</a><br>
    <a href="https://hacc.pro" style="color:#8DC63F;font-weight:700;">hacc.pro</a>
  </div>
</div>
</body></html>`;
}

/* ─── Welcome email ─── */
function _buildWelcomeEmail(email, company, plan) {
  var planLabels = { solo: 'Plan Solo — 1 cuisine', multi: 'Plan Multi — jusqu\'à 3 cuisines', enterprise: 'Plan Entreprise' };
  var planLabel  = planLabels[plan] || 'Plan Solo — 1 cuisine';

  var content = `
    <div style="font-size:1.35rem;font-weight:900;color:#0F2240;margin-bottom:8px;">Bienvenue${company ? ' chez <strong>' + _escape(company) + '</strong>' : ''} ! 🎉</div>
    <p style="color:#7A6579;line-height:1.75;margin:0 0 24px;">Votre essai gratuit de <strong>14 jours</strong> est activé. Suivez les 3 étapes ci-dessous pour être opérationnel en moins de 30 minutes.</p>

    <!-- Plan badge -->
    <div style="background:#F7F2F7;border-radius:12px;padding:14px 18px;margin-bottom:28px;display:flex;align-items:center;gap:10px;">
      <span style="color:#8DC63F;font-size:1.1rem;">✓</span>
      <div>
        <div style="font-size:.72rem;font-weight:900;color:#7A6579;text-transform:uppercase;letter-spacing:.05em;">Votre plan activé</div>
        <div style="font-weight:900;color:#0F2240;">${_escape(planLabel)} · Essai gratuit 14 jours</div>
      </div>
    </div>

    <!-- 3 étapes -->
    <div style="font-size:.8rem;font-weight:900;color:#7A6579;text-transform:uppercase;letter-spacing:.05em;margin-bottom:14px;">Pour démarrer</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="vertical-align:top;padding:0 0 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="44" style="vertical-align:top;">
                <div style="width:38px;height:38px;background:#0F2240;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;text-align:center;line-height:38px;">🏢</div>
              </td>
              <td style="padding-left:12px;vertical-align:top;">
                <div style="font-weight:900;color:#0F2240;font-size:.9rem;">Ajoutez vos cuisines</div>
                <div style="color:#7A6579;font-size:.82rem;line-height:1.55;margin-top:2px;">Déclarez vos sites, frigos et chambres froides.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="vertical-align:top;padding:0 0 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="44" style="vertical-align:top;">
                <div style="width:38px;height:38px;background:#0F2240;border-radius:10px;font-size:1.2rem;text-align:center;line-height:38px;">⚡</div>
              </td>
              <td style="padding-left:12px;vertical-align:top;">
                <div style="font-weight:900;color:#0F2240;font-size:.9rem;">Configurez votre PMS automatiquement</div>
                <div style="color:#7A6579;font-size:.82rem;line-height:1.55;margin-top:2px;">Répondez au questionnaire HACCP — votre Plan de Maîtrise Sanitaire est généré en 20 min.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="44" style="vertical-align:top;">
                <div style="width:38px;height:38px;background:#8DC63F;border-radius:10px;font-size:1.2rem;text-align:center;line-height:38px;">🌡️</div>
              </td>
              <td style="padding-left:12px;vertical-align:top;">
                <div style="font-weight:900;color:#0F2240;font-size:.9rem;">Faites votre premier relevé de température</div>
                <div style="color:#7A6579;font-size:.82rem;line-height:1.55;margin-top:2px;">Depuis votre smartphone, en quelques secondes. Alertes automatiques incluses.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- CTA -->
    <a href="https://hacc.pro/onboarding.html" style="display:block;background:#8DC63F;color:#fff;text-align:center;padding:16px 24px;border-radius:14px;text-decoration:none;font-weight:900;font-size:1rem;letter-spacing:-.2px;">
      Configurer mon HACCP maintenant →
    </a>
    <p style="text-align:center;font-size:.75rem;color:#bbb;margin-top:12px;">Accès immédiat · Sans carte bancaire · Résiliation en 1 clic</p>

    <div style="border-top:1px solid #F0EBF0;margin-top:24px;padding-top:20px;font-size:.78rem;color:#aaa;">
      Vous recevez cet email car vous venez de créer un compte HACC.PRO avec l'adresse <strong>${_escape(email)}</strong>.
    </div>`;

  return _wrap(content);
}

/* ─── Confirm email ─── */
function _buildConfirmEmail(email, confirmUrl) {
  var content = `
    <div style="font-size:1.3rem;font-weight:900;color:#0F2240;margin-bottom:12px;">Confirmez votre adresse email</div>
    <p style="color:#7A6579;line-height:1.75;margin:0 0 24px;">Cliquez sur le bouton ci-dessous pour valider votre compte HACC.PRO et accéder à votre espace de gestion HACCP.</p>
    <a href="${confirmUrl}" style="display:block;background:#0F2240;color:#fff;text-align:center;padding:16px;border-radius:14px;text-decoration:none;font-weight:900;font-size:1rem;">
      Confirmer mon adresse →
    </a>
    <p style="color:#bbb;font-size:.75rem;margin-top:16px;text-align:center;">Ce lien expire dans 24h. Si vous n'avez pas créé de compte, ignorez cet email.</p>`;
  return _wrap(content);
}

/* ─── Reset password email ─── */
function _buildResetEmail(email, resetUrl) {
  var content = `
    <div style="font-size:1.3rem;font-weight:900;color:#0F2240;margin-bottom:12px;">Réinitialisez votre mot de passe</div>
    <p style="color:#7A6579;line-height:1.75;margin:0 0 24px;">Vous avez demandé la réinitialisation du mot de passe pour votre compte HACC.PRO associé à <strong>${_escape(email)}</strong>.</p>

    <a href="${resetUrl}" style="display:block;background:#8DC63F;color:#fff;text-align:center;padding:16px 24px;border-radius:14px;text-decoration:none;font-weight:900;font-size:1rem;">
      Choisir un nouveau mot de passe →
    </a>
    <p style="text-align:center;font-size:.75rem;color:#bbb;margin-top:10px;">Ce lien est valable <strong>1 heure</strong></p>

    <div style="background:#FFF8F0;border:1px solid #FDE8C8;border-radius:10px;padding:14px 18px;margin-top:24px;">
      <div style="font-size:.82rem;color:#92400e;line-height:1.65;">
        🔒 <strong>Si vous n'êtes pas à l'origine de cette demande</strong>, ignorez cet email. Votre mot de passe reste inchangé. Votre compte est en sécurité.
      </div>
    </div>`;
  return _wrap(content);
}

function _escape(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
