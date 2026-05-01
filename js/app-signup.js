/**
 * app-signup.js — Logique d'inscription HACC.PRO
 * 4 étapes : Compte → Établissement → Plan → Confirmation
 */

const _SU = SUPABASE_URL;
const _SK = SUPABASE_ANON_KEY;

let _step = 1;
const _data = { email:'', password:'', company:'', type:'restaurant', sites:1, plan:'multi' };

// ── Init ──────────────────────────────────────────────────────
(function init(){
  // Pre-select plan from URL param (?plan=starter|pro|enterprise)
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

// ── Validation ────────────────────────────────────────────────
function validateStep(n){
  hideErr(n);
  if(n===1){
    const email = document.getElementById('su-email').value.trim();
    const pass  = document.getElementById('su-pass').value;
    const pass2 = document.getElementById('su-pass2').value;
    if(!email || !email.includes('@') || !email.includes('.'))
      return showErr(1,'Adresse email invalide');
    if(pass.length < 8)
      return showErr(1,'Le mot de passe doit contenir au moins 8 caractères');
    if(pass !== pass2)
      return showErr(1,'Les mots de passe ne correspondent pas');
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

// ── Plan selection ────────────────────────────────────────────
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

// ── Signup ────────────────────────────────────────────────────
async function doSignup(){
  const btn   = document.getElementById('btn-signup');
  const label = document.getElementById('btn-signup-label');
  const spin  = document.getElementById('btn-signup-spin');
  btn.disabled = true;
  label.style.display = 'none';
  spin.style.display = 'block';
  hideErr(4);

  try {
    // 1. Créer utilisateur Supabase Auth
    const r1 = await fetch(`${_SU}/auth/v1/signup`, {
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':_SK},
      body:JSON.stringify({ email:_data.email, password:_data.password })
    });
    const auth = await r1.json();

    if(auth.error || auth.code === 400){
      const msg = auth.error?.message || auth.msg || auth.message || 'Erreur lors de l\'inscription';
      throw new Error(msg);
    }

    const token  = auth.access_token;
    const userId = auth.user?.id || auth.id;

    // Email confirmation required (no token returned)
    if(!token){
      _showSuccessEmailConfirm();
      return;
    }

    // 2. Créer le tenant
    let tenantId = null;
    try {
      const r2 = await fetch(`${_SU}/rest/v1/tenants`, {
        method:'POST',
        headers:{
          'Content-Type':'application/json','apikey':_SK,
          'Authorization':`Bearer ${token}`,
          'Prefer':'return=representation'
        },
        body:JSON.stringify({ name:_data.company, type:_data.type })
      });
      if(r2.ok){
        const tenants = await r2.json();
        tenantId = Array.isArray(tenants) ? tenants[0]?.id : tenants?.id;
      }
    } catch(e){ /* tenant creation may be handled by DB trigger */ }

    // 3. Créer/mettre à jour le profil
    if(tenantId){
      await fetch(`${_SU}/rest/v1/profiles`, {
        method:'POST',
        headers:{
          'Content-Type':'application/json','apikey':_SK,
          'Authorization':`Bearer ${token}`,
          'Prefer':'return=minimal,resolution=merge-duplicates'
        },
        body:JSON.stringify({
          id:userId, tenant_id:tenantId,
          role:'directeur', full_name:_data.company
        })
      }).catch(()=>{});

      // 4. Créer l'abonnement (essai)
      const planPrices = { solo:29, multi:49, enterprise:0 };
      const trialEnd = new Date(Date.now() + 14*24*60*60*1000).toISOString();
      await fetch(`${_SU}/rest/v1/subscriptions`, {
        method:'POST',
        headers:{
          'Content-Type':'application/json','apikey':_SK,
          'Authorization':`Bearer ${token}`,
          'Prefer':'return=minimal'
        },
        body:JSON.stringify({
          tenant_id:tenantId, plan:_data.plan,
          price_per_month:planPrices[_data.plan] ?? 49,
          status:'trial', trial_ends_at:trialEnd
        })
      }).catch(()=>{});
    }

    // 5. Sauvegarder la session et rediriger
    localStorage.setItem('haccpro_session', JSON.stringify({
      token, userId, role:'directeur',
      tenantId, fullName:_data.company
    }));
    localStorage.setItem('haccpro_signup_data', JSON.stringify({
      company:_data.company, type:_data.type,
      sites:_data.sites, plan:_data.plan
    }));

    // 6. Email de bienvenue via Resend (non bloquant)
    fetch('/.netlify/functions/send-email', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ type:'welcome', to:_data.email, company:_data.company, plan:_data.plan })
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
  _showStep('success');
  _set('success-msg','Un email de confirmation vous a été envoyé à <strong>'+_data.email+'</strong>. Cliquez sur le lien pour activer votre compte, puis connectez-vous pour configurer votre HACCP.');
}

function _showSuccessRedirect(){
  _showStep('success');
  _set('success-msg','Votre essai gratuit de 14 jours est activé. Vous allez être redirigé vers la configuration de votre HACCP…');
  setTimeout(()=>{ window.location.href = 'onboarding.html'; }, 2000);
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
