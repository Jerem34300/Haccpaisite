/**
 * app-signup.js — Logique d'inscription HACC.PRO
 * 4 étapes : Compte → Établissement → Plan → Confirmation
 */

const _SU = SUPABASE_URL;
const _SK = SUPABASE_ANON_KEY;

let _step = 1;
const _data = {
  email:'', password:'', firstName:'', lastName:'',
  company:'', type:'restaurant', sites:1, plan:'multi',
  couleur:'#5C1E5A'
};

// Résultat de la vérification Supabase Auth (obtenu à l'étape 1)
let _supaAuth = null;
let _supaAuthEmail = '';

// ── Init ──────────────────────────────────────────────────────
(function init(){
  const urlPlan = new URLSearchParams(location.search).get('plan');
  if(urlPlan && ['solo','multi','enterprise'].includes(urlPlan)){
    _data.plan = urlPlan;
    document.querySelectorAll('.plan-card').forEach(c=>c.classList.remove('selected'));
    const card = document.getElementById('plan-'+urlPlan);
    if(card) card.classList.add('selected');
  }
})();

// ── Stepper navigation ────────────────────────────────────────
function goStep(to){
  if(to > _step && !validateStep(_step)) return;
  _showStep(to);
}

function _showStep(n){
  document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));
  const target = document.getElementById('step-'+(n==='success'?'success':n));
  if(target) target.classList.add('active');
  _step = n;
  _updateStepper();
  if(n===3) _preselectPlan();
  if(n===4) _fillRecap();
  window.scrollTo(0,0);
}

function _updateStepper(){
  for(let i=1;i<=4;i++){
    const dot = document.getElementById('dot-'+i);
    if(!dot) continue;
    dot.className = 'step-dot';
    if(i < _step) dot.classList.add('done');
    else if(i === _step) dot.classList.add('active');
    const line = document.getElementById('line-'+i);
    if(line){ line.className='step-line'; if(i<_step) line.classList.add('done'); }
  }
}

// ── Vérification email + transition étape 1→2 (async) ────────
async function checkEmailAndGoStep2(){
  if(!validateStep(1)) return;

  const btn   = document.getElementById('btn-step1');
  const label = document.getElementById('btn-step1-label');
  const spin  = document.getElementById('btn-step1-spin');
  if(btn) btn.disabled = true;
  if(label) label.style.display = 'none';
  if(spin) spin.style.display = 'block';
  hideErr(1);

  // Déjà vérifié pour cet email : ne pas rappeler Supabase
  if(_supaAuth && _supaAuthEmail === _data.email){
    _showStep(2);
    if(btn){ btn.disabled = false; }
    if(label) label.style.display = 'inline';
    if(spin) spin.style.display = 'none';
    return;
  }

  try {
    const r = await fetch(`${_SU}/auth/v1/signup`, {
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':_SK},
      body:JSON.stringify({ email:_data.email, password:_data.password })
    });
    const auth = await r.json();

    const rawMsg = (auth.error?.message || auth.msg || auth.message || '').toLowerCase();
    const isDup = rawMsg.includes('already') || rawMsg.includes('exists')
      || auth.error_code === 'user_already_exists' || auth.code === 422
      || (auth.user && Array.isArray(auth.user.identities) && auth.user.identities.length === 0)
      || (Array.isArray(auth.identities) && auth.identities.length === 0 && !auth.access_token && (auth.id || auth.user?.id));

    if(isDup){
      const el = document.getElementById('err-1');
      if(el){
        el.innerHTML = '⚠️ Cet email est déjà utilisé. <a href="login.html" style="color:var(--plum);font-weight:900;text-decoration:underline">Se connecter →</a>';
        el.style.display = 'block';
      }
      return;
    }

    if(auth.error && auth.code !== 200){
      showErr(1, auth.error?.message || auth.msg || auth.message || 'Erreur. Réessayez.');
      return;
    }

    const token  = auth.access_token;
    const userId = auth.user?.id || auth.id;
    _supaAuth = token ? { token, userId, pending:false } : { pending:true };
    _supaAuthEmail = _data.email;

    _showStep(2);

  } catch(e){
    showErr(1, 'Impossible de vérifier l\'email. Vérifiez votre connexion.');
  } finally {
    if(btn) btn.disabled = false;
    if(label) label.style.display = 'inline';
    if(spin) spin.style.display = 'none';
  }
}

// ── Validation ────────────────────────────────────────────────
function validateStep(n){
  hideErr(n);
  if(n===1){
    const firstName = (document.getElementById('su-prenom')?.value || '').trim();
    const lastName  = (document.getElementById('su-nom')?.value || '').trim();
    const email = document.getElementById('su-email').value.trim();
    const pass  = document.getElementById('su-pass').value;
    const pass2 = document.getElementById('su-pass2').value;
    if(!firstName) return showErr(1,'Veuillez saisir votre prénom');
    if(!lastName)  return showErr(1,'Veuillez saisir votre nom');
    if(!email || !email.includes('@') || !email.includes('.'))
      return showErr(1,'Adresse email invalide');
    if(pass.length < 8)
      return showErr(1,'Le mot de passe doit contenir au moins 8 caractères');
    if(pass !== pass2)
      return showErr(1,'Les mots de passe ne correspondent pas');
    _data.firstName = firstName;
    _data.lastName  = lastName;
    _data.email    = email;
    _data.password = pass;
    return true;
  }
  if(n===2){
    const company = document.getElementById('su-company').value.trim();
    if(!company) return showErr(2,'Veuillez renseigner le nom de votre établissement');
    _data.company = company;
    _data.type    = document.getElementById('su-type').value;
    _data.sites   = parseInt(document.getElementById('su-sites').value) || 1;
    return true;
  }
  if(n===3){
    if(!_data.plan) return showErr(3,'Veuillez choisir un plan pour continuer');
    if(!['solo','multi','enterprise'].includes(_data.plan)) return showErr(3,'Veuillez choisir un plan pour continuer');
    return true;
  }
  return true;
}

// ── Couleur ───────────────────────────────────────────────────
function selectColor(hex){
  _data.couleur = hex;
  document.querySelectorAll('.color-swatch-su').forEach(function(s){
    s.classList.toggle('active', s.dataset.color === hex);
  });
}

// ── Plan selection ────────────────────────────────────────────
function _preselectPlan(){
  const s = _data.sites || 1;
  const plan = s === 1 ? 'solo' : s > 3 ? 'enterprise' : 'multi';
  selectPlan(plan);
}

function selectPlan(plan){
  if(!['solo','multi','enterprise'].includes(plan)) return;
  _data.plan = plan;
  document.querySelectorAll('.plan-card').forEach(c=>c.classList.remove('selected'));
  const card = document.getElementById('plan-'+plan);
  if(card) card.classList.add('selected');
  hideErr(3);
}

// ── Recap ─────────────────────────────────────────────────────
function _fillRecap(){
  const fullName = (_data.firstName + ' ' + _data.lastName).trim();
  _set('recap-name', fullName || '—');
  _set('recap-email', _data.email || '—');
  _set('recap-company', _data.company || '—');
  const typeLabels = {
    restaurant:'Restaurant commercial', collectivite:'Restauration collective',
    traiteur:'Traiteur / Événementiel', boulangerie:'Boulangerie / Pâtisserie',
    hotellerie:'Hôtellerie / Restauration', autre:'Autre établissement'
  };
  _set('recap-type', typeLabels[_data.type] || _data.type);
  const planLabels = { solo:'Solo — 29€/mois · 1 cuisine', multi:'Multi — 49€/mois · jusqu\'à 3 cuisines', enterprise:'Entreprise — Sur devis' };
  _set('recap-plan', planLabels[_data.plan] || _data.plan);
}

// ── Signup (étape 4) ──────────────────────────────────────────
async function doSignup(){
  const btn   = document.getElementById('btn-signup');
  const label = document.getElementById('btn-signup-label');
  const spin  = document.getElementById('btn-signup-spin');
  btn.disabled = true;
  label.style.display = 'none';
  spin.style.display = 'block';
  hideErr(4);

  try {
    let token  = _supaAuth?.token  || null;
    let userId = _supaAuth?.userId || null;
    const isPending = _supaAuth?.pending || false;

    // Fallback si _supaAuth n'est pas défini (cas exceptionnel)
    if(!_supaAuth){
      const r1 = await fetch(`${_SU}/auth/v1/signup`, {
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':_SK},
        body:JSON.stringify({ email:_data.email, password:_data.password })
      });
      const auth = await r1.json();
      const rawMsg = (auth.error?.message || auth.msg || auth.message || '').toLowerCase();
      const isDup = rawMsg.includes('already') || rawMsg.includes('exists')
        || auth.error_code === 'user_already_exists' || auth.code === 422
        || (auth.user && Array.isArray(auth.user.identities) && auth.user.identities.length === 0)
        || (Array.isArray(auth.identities) && auth.identities.length === 0 && !auth.access_token && (auth.id || auth.user?.id));
      if(isDup){
        const el = document.getElementById('err-4');
        if(el){
          el.innerHTML = '⚠️ Cet email est déjà associé à un compte. <a href="login.html" style="color:var(--plum);font-weight:900;text-decoration:underline">Se connecter →</a>';
          el.style.display = 'block';
        }
        btn.disabled = false; label.style.display = 'inline'; spin.style.display = 'none';
        return;
      }
      if(auth.error) throw new Error(auth.error?.message || auth.msg || auth.message || 'Erreur lors de l\'inscription');
      token  = auth.access_token;
      userId = auth.user?.id || auth.id;
      if(!token){ _showSuccessEmailConfirm(); return; }
    }

    // Confirmation email requise
    if(isPending){
      _showSuccessEmailConfirm();
      return;
    }

    if(!token) throw new Error('Aucun token reçu. Réessayez.');

    const fullName = (_data.firstName + ' ' + _data.lastName).trim() || _data.company;

    // 2. Créer tenant + profil + abonnement via proxy Netlify (service_role)
    // Le JWT user seul ne peut pas insérer dans tenants (RLS) — le proxy contourne ça
    let tenantId = null;
    try {
      const r2 = await fetch('/.netlify/functions/signup-setup', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ userJwt:token, company:_data.company, type:_data.type, plan:_data.plan })
      });
      if(r2.ok){ const d = await r2.json(); tenantId = d.tenantId || null; }
    } catch(e){ console.error('signup-setup proxy:', e); }

    // Fallback local (proxy indisponible en dev)
    if(!tenantId){
      try {
        const r2 = await fetch(`${_SU}/rest/v1/tenants`, {
          method:'POST',
          headers:{'Content-Type':'application/json','apikey':_SK,'Authorization':`Bearer ${token}`,'Prefer':'return=representation'},
          body:JSON.stringify({ name:_data.company, type:_data.type })
        });
        if(r2.ok){ const t = await r2.json(); tenantId = Array.isArray(t) ? t[0]?.id : t?.id; }
      } catch(e){}
    }
    localStorage.setItem('haccpro_session', JSON.stringify({
      token, userId, role:'directeur',
      tenantId, fullName, plan:_data.plan
    }));
    localStorage.setItem('haccpro_signup_data', JSON.stringify({
      company:_data.company, type:_data.type, sites:_data.sites, plan:_data.plan,
      firstName:_data.firstName, lastName:_data.lastName, couleur:_data.couleur
    }));

    // 6. Email de bienvenue (non bloquant)
    fetch('/.netlify/functions/send-email', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ type:'welcome', to:_data.email, company:_data.company, plan:_data.plan, fullName })
    }).catch(()=>{});

    _showSuccessRedirect();

  } catch(e){
    showErr(4, e.message || 'Erreur lors de l\'inscription. Réessayez.');
    btn.disabled = false;
    label.style.display = 'inline';
    spin.style.display = 'none';
  }
}

function _showSuccessEmailConfirm(){
  const fullName = (_data.firstName + ' ' + _data.lastName).trim() || _data.company;
  try {
    localStorage.setItem('haccpro_pending_signup', JSON.stringify({
      company:_data.company, type:_data.type, sites:_data.sites, plan:_data.plan,
      firstName:_data.firstName, lastName:_data.lastName,
      couleur:_data.couleur, fullName
    }));
  } catch(e){ console.error('pending signup save:', e); }
  _showStep('success');
  _set('success-msg','Un email de confirmation vous a été envoyé à <strong>'+_data.email+'</strong>. Cliquez sur le lien pour activer votre compte.');
  const ec = document.getElementById('success-email-confirm');
  if(ec) ec.style.display = 'block';
}

function _showSuccessRedirect(){
  _showStep('success');
  _set('success-msg','Votre essai gratuit de 14 jours est activé. Vous allez être redirigé vers la configuration de votre HACCP…');
  const rd = document.getElementById('success-redirect');
  if(rd) rd.style.display = 'block';
  setTimeout(()=>{ window.location.href = 'onboarding.html'; }, 2000);
}

async function resendConfirmEmail(){
  const btn   = document.getElementById('btn-resend');
  const label = document.getElementById('btn-resend-label');
  const spin  = document.getElementById('btn-resend-spin');
  const errEl = document.getElementById('resend-err');
  btn.disabled = true;
  label.style.display = 'none';
  spin.style.display = 'block';
  errEl.style.display = 'none';
  try {
    const r = await fetch(`${_SU}/auth/v1/resend`, {
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':_SK},
      body:JSON.stringify({ type:'signup', email:_data.email })
    });
    const res = await r.json();
    if(res.error) throw new Error(res.error.message || res.error_description || 'Erreur lors du renvoi');
    label.textContent = 'Email renvoyé ✓';
    label.style.display = 'inline';
    spin.style.display = 'none';
    setTimeout(()=>{ btn.disabled = false; label.textContent = 'Renvoyer l\'email de confirmation'; }, 30000);
  } catch(e){
    console.error('resendConfirmEmail:', e);
    errEl.textContent = e.message || 'Erreur lors du renvoi. Réessayez.';
    errEl.style.display = 'block';
    btn.disabled = false;
    label.style.display = 'inline';
    spin.style.display = 'none';
  }
}

// ── Helpers ───────────────────────────────────────────────────
function showErr(step, msg){
  const el = document.getElementById('err-'+step);
  if(!el) return false;
  el.textContent = msg;
  el.style.display = 'block';
  return false;
}
function hideErr(step){
  const el = document.getElementById('err-'+step);
  if(el) el.style.display = 'none';
}
function _set(id, html){
  const el = document.getElementById(id);
  if(el) el.innerHTML = html;
}
function togglePwd(inputId, svgId){
  const inp = document.getElementById(inputId);
  const svg = document.getElementById(svgId);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  svg.innerHTML = show
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
}
