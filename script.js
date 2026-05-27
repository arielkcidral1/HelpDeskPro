'use strict';

const HELP_DESK_SUPABASE = window.HELPDESK_SUPABASE || {};
const SUPABASE_URL = HELP_DESK_SUPABASE.url || '';
const SUPABASE_ANON_KEY = HELP_DESK_SUPABASE.anonKey || '';
let dbErrorReason = '';

function validateSupabaseConfig() {
  if (!SUPABASE_URL || SUPABASE_URL.includes('SEU_PROJETO')) {
    return 'URL do Supabase nao configurada';
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) {
    return 'URL do Supabase invalida';
  }
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('COLE_AQUI')) {
    return 'Anon key do Supabase nao configurada';
  }
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(SUPABASE_ANON_KEY)) {
    return 'Anon key do Supabase invalida';
  }
  return '';
}

// Supabase Database Layer
let dbReady = false;
let dbMode = 'supabase';
let supabase = null;

async function initDB() {
  const ok = await initSupabaseDB();
  if (!ok) clearMemoryData();
  return ok;
}

async function initSupabaseDB() {
  dbErrorReason = validateSupabaseConfig();
  if (dbErrorReason) {
    console.error(`${dbErrorReason}. Configure window.HELPDESK_SUPABASE com url e anonKey reais.`);
    return false;
  }

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { error } = await supabase.from('support_staff').select('id').limit(1);
    if (error) throw error;

    dbReady = true;
    dbMode = 'supabase';
    await reloadAllData();
    console.log('Supabase database ready');
    return true;
  } catch (err) {
    dbErrorReason = err?.message || 'Falha ao conectar no Supabase';
    console.error('Supabase init failed. O projeto exige o banco Supabase:', err);
    supabase = null;
    dbReady = false;
    dbMode = 'supabase-unavailable';
    return false;
  }
}

function clearMemoryData() {
  chamados = [];
  notificacoes = [];
  chatsData = {};
  chatInternoMsgs = [];
  directMsgs = {};
  FUNCIONARIOS = [];
}

function isDBReady() {
  if (dbReady && supabase) return true;
  console.error('Banco Supabase indisponivel. Nenhum dado sera salvo fora do banco.');
  return false;
}

async function dbGetConfig(key, fallback = null) {
  if (!isDBReady()) return fallback;
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.error('dbGetConfig error:', error);
    return fallback;
  }
  return data ? data.value : fallback;
}

async function dbSetConfig(key, value) {
  if (!isDBReady()) return;
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) console.error('dbSetConfig error:', error);
}

async function reloadAllData() {
  return reloadAllDataSupabase();
}

async function reloadAllDataSupabase() {
  const [
    ticketRows,
    staffRows,
    notifRows,
    geralRows,
    dmRows,
    chatRows,
    suporteMsgRows
  ] = await Promise.all([
    supabase.from('tickets').select('*').order('created_at', { ascending: true }),
    supabase.from('support_staff').select('*').order('id', { ascending: true }),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('chat_messages').select('*').eq('chat_key', 'GERAL').order('created_at', { ascending: true }),
    supabase.from('chat_messages').select('*').neq('chat_key', 'GERAL').not('chat_key', 'like', 'SUPORTE_%').order('created_at', { ascending: true }),
    supabase.from('chats_suporte').select('*').eq('encerrado', false).order('created_at', { ascending: false }),
    supabase.from('chat_messages').select('*').like('chat_key', 'SUPORTE_%').order('created_at', { ascending: true })
  ]);

  const error = [ticketRows, staffRows, notifRows, geralRows, dmRows, chatRows, suporteMsgRows].find(r => r.error)?.error;
  if (error) throw error;

  chamados = ticketRows.data.map(rowToTicket);
  FUNCIONARIOS = staffRows.data.map(rowToStaff);

  notificacoes = notifRows.data.map(r => ({
    titulo: r.titulo,
    texto: r.texto,
    data: r.created_at,
    destinatario: r.destinatario || '',
    ignorar: r.ignorar || ''
  }));

  chatInternoMsgs = geralRows.data.map(r => ({ autor: r.autor, texto: r.texto, data: r.created_at }));

  directMsgs = {};
  dmRows.data.forEach(r => {
    if (!directMsgs[r.chat_key]) directMsgs[r.chat_key] = [];
    directMsgs[r.chat_key].push({ autor: r.autor, texto: r.texto, data: r.created_at });
  });

  const suporteMsgs = {};
  suporteMsgRows.data.forEach(m => {
    const cpf = m.chat_key.replace('SUPORTE_', '');
    if (!suporteMsgs[cpf]) suporteMsgs[cpf] = [];
    suporteMsgs[cpf].push({
      autor: m.autor,
      texto: m.texto,
      isStaff: m.is_staff,
      data: m.created_at
    });
  });

  chatsData = {};
  chatRows.data.forEach(c => {
    chatsData[c.cpf] = {
      nome: c.nome,
      assunto: c.assunto,
      observacao: c.observacao,
      responsavel: c.responsavel,
      mensagens: suporteMsgs[c.cpf] || []
    };
  });
}

function rowToTicket(r) {
  return {
    id: r.id,
    nome: r.user_name,
    cpf: r.user_cpf || '',
    email: r.user_email || '',
    setor: r.setor,
    tipo: r.tipo,
    prioridade: r.prioridade || 'Não definida',
    descricao: r.descricao,
    status: r.status,
    responsavel: r.responsavel || '',
    observacoes: JSON.parse(r.observacoes || '[]'),
    historico: JSON.parse(r.historico || '[]'),
    data: r.created_at
  };
}

function rowToStaff(r) {
  // Extract username from email (before @)
  const usuario = r.email ? r.email.split('@')[0] : r.name.toLowerCase();
  return {
    usuario,
    senha: r.senha,
    nome: r.name,
    role: r.role,
    foto: r.foto || ''
  };
}

// DB write helpers
async function dbSaveTicket(t) {
  if (!isDBReady()) return;
  try {
    const { error } = await supabase.from('tickets').upsert({
      id: t.id,
      user_name: t.nome,
      user_cpf: t.cpf || '',
      user_email: t.email || '',
      setor: t.setor,
      tipo: t.tipo,
      prioridade: t.prioridade || 'Nao definida',
      descricao: t.descricao,
      status: t.status,
      responsavel: t.responsavel || '',
      observacoes: JSON.stringify(t.observacoes || []),
      historico: JSON.stringify(t.historico || []),
      created_at: t.data || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw error;
  } catch(e) { console.error('dbSaveTicket error:', e); }
}

async function dbDeleteTicket(id) {
  if (!isDBReady()) return;
  try {
    const { error } = await supabase.from('tickets').delete().eq('id', id);
    if (error) throw error;
  } catch(e) { console.error(e); }
}

async function dbSaveStaff(f) {
  if (!isDBReady()) return;
  try {
    const { error } = await supabase.from('support_staff').upsert({
      name: f.nome,
      email: `${f.usuario}@helpdesk.local`,
      role: f.role,
      senha: f.senha,
      foto: f.foto || ''
    }, { onConflict: 'email' });
    if (error) throw error;
  } catch(e) { console.error('dbSaveStaff error:', e); }
}

async function dbDeleteStaff(usuario) {
  if (!isDBReady()) return;
  try {
    const { error } = await supabase.from('support_staff').delete().eq('email', `${usuario}@helpdesk.local`);
    if (error) throw error;
  } catch(e) { console.error(e); }
}

async function dbAddNotif(titulo, texto, options = {}) {
  if (!isDBReady()) return;
  try {
    const { error } = await supabase.from('notifications').insert({
      titulo,
      texto,
      destinatario: options.destinatario || '',
      ignorar: options.ignorar || ''
    });
    if (error) throw error;
  } catch(e) { console.error(e); }
}

async function dbSendChatMsg(chatKey, autor, texto, isStaff = false) {
  if (!isDBReady()) return;
  try {
    const { error } = await supabase.from('chat_messages').insert({
      chat_key: chatKey,
      autor,
      texto,
      is_staff: isStaff
    });
    if (error) throw error;
  } catch(e) { console.error(e); }
}

async function dbSaveSuporteChat(cpf, data) {
  if (!isDBReady()) return;
  try {
    const { error } = await supabase.from('chats_suporte').upsert({
      cpf,
      nome: data.nome,
      assunto: data.assunto || '',
      observacao: data.observacao || '',
      responsavel: data.responsavel || '',
      encerrado: false
    }, { onConflict: 'cpf' });
    if (error) throw error;
  } catch(e) { console.error(e); }
}

async function dbDeleteSuporteChat(cpf) {
  if (!isDBReady()) return;
  try {
    const chatKey = `SUPORTE_${cpf}`;
    const [{ error: chatError }, { error: msgError }] = await Promise.all([
      supabase.from('chats_suporte').update({ encerrado: true }).eq('cpf', cpf),
      supabase.from('chat_messages').delete().eq('chat_key', chatKey)
    ]);
    if (chatError || msgError) throw chatError || msgError;
  } catch(e) { console.error(e); }
}
// App State ────────────────────────────────────────────────────────────────
let chamados = [];
let notificacoes = [];
let chatsData = {};
let chatInternoMsgs = [];
let directMsgs = {};
let logado = false;
let chartInstances = {};
let funcLogado = null;
let painelTab = 'meus';
let chatActiveCpf = null;
let chatMode = null;
let typingBots = new Set();
let chatInternoActive = 'GERAL';
let lastReadTime = {};
let editandoUsuario = null;
let selectedProblem = '';
let FUNCIONARIOS = [];

// ─── Utilities ────────────────────────────────────────────────────────────────
function gerarId() {
  const timePart = Date.now().toString(36).toUpperCase().slice(-6);
  const randomPart = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `#HD-${timePart}-${randomPart}`;
}

function dataFormatada(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toast(tipo, titulo, msg) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  el.className = `toast t-${tipo}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[tipo] || 'ℹ️'}</span>
    <div class="toast-text">
      <strong>${titulo}</strong>
      ${msg ? `<p>${msg}</p>` : ''}
    </div>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, 3800);
}

async function addNotif(titulo, texto, options = {}) {
  notificacoes.unshift({ titulo, texto, data: new Date().toISOString(), ...options });
  if (notificacoes.length > 20) notificacoes.pop();
  await dbAddNotif(titulo, texto, options);
  renderNotifs();
}

function renderNotifs() {
  const badge = document.getElementById('notifBadge');
  const list  = document.getElementById('notifList');

  let myNotifs = notificacoes;
  if (logado && funcLogado) {
    myNotifs = notificacoes.filter(n => {
      if (n.destinatario && n.destinatario !== funcLogado.usuario) return false;
      if (n.ignorar && n.ignorar === funcLogado.usuario) return false;
      return true;
    });
  } else {
    myNotifs = notificacoes.filter(n => !n.destinatario && !n.ignorar);
  }

  const qtd = myNotifs.length;
  badge.textContent = qtd > 9 ? '9+' : qtd;
  badge.style.display = qtd > 0 ? 'flex' : 'none';

  if (qtd === 0) {
    list.innerHTML = '<p class="notif-empty">Nenhuma notificação</p>';
    return;
  }
  list.innerHTML = myNotifs.map(n => `
    <div class="notif-item">
      <strong>${n.titulo}</strong>
      ${n.texto} · <em style="font-size:.7rem">${dataFormatada(n.data)}</em>
    </div>`).join('');
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function irPara(pagina) {
  if ((pagina === 'equipe' || pagina === 'relatorios' || pagina === 'chat') && !logado) {
    toast('error', 'Acesso Restrito', 'Faça login para acessar esta página.');
    irPara('painel');
    return;
  }
  if (pagina === 'equipe' && funcLogado && funcLogado.usuario !== 'admin' && !funcLogado.role.toLowerCase().includes('gerente')) {
    toast('error', 'Sem Permissão', 'Acesso restrito a gestores e administradores.');
    irPara('home');
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));

  const pg = document.getElementById(`page-${pagina}`);
  if (pg) pg.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${pagina}"]`);
  if (navEl) navEl.classList.add('active');

  document.getElementById('navLinks').classList.remove('mobile-open');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (pagina === 'home')       atualizarHome();
  if (pagina === 'meus')       renderMeusChamados();
  if (pagina === 'painel')     renderPainel();
  if (pagina === 'relatorios') renderGraficos();
  if (pagina === 'equipe')     renderEquipe();
  if (pagina === 'suporte')    renderSuportePage();
  if (pagina === 'chat') {
    renderChatInternoList();
    renderChatInterno();
  }
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function atualizarHome() {
  const abertos    = chamados.filter(c => c.status === 'Aberto').length;
  const andamento  = chamados.filter(c => c.status === 'Em andamento' || c.status === 'Em análise').length;
  const concluidos = chamados.filter(c => c.status === 'Resolvido' || c.status === 'Fechado').length;

  document.getElementById('cnt-abertos').textContent    = abertos;
  document.getElementById('cnt-andamento').textContent  = andamento;
  document.getElementById('cnt-concluidos').textContent = concluidos;

  const lista = document.getElementById('homeRecentList');
  const ultimos = [...chamados].reverse().slice(0, 5);

  if (ultimos.length === 0) {
    lista.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Nenhum chamado registrado ainda.</p>
        <button class="btn-primary sm" data-goto="abrir">Abrir primeiro chamado</button>
      </div>`;
    lista.querySelectorAll('[data-goto]').forEach(b =>
      b.addEventListener('click', () => irPara(b.dataset.goto)));
    return;
  }
  lista.innerHTML = ultimos.map(c => ticketRowHTML(c, false)).join('');
  lista.querySelectorAll('.ticket-row').forEach(row =>
    row.addEventListener('click', () => abrirModal(row.dataset.id)));
}

// ─── Ticket helpers ───────────────────────────────────────────────────────────
function statusClass(s) {
  const map = {
    'Aberto': 'status-aberto', 'Em análise': 'status-em-analise',
    'Em andamento': 'status-em-andamento', 'Aguardando resposta': 'status-aguardando',
    'Resolvido': 'status-resolvido', 'Fechado': 'status-fechado',
  };
  return map[s] || 'status-aberto';
}
function prioClass(p) {
  const map = { Baixa: 'prio-baixa', 'Média': 'prio-media', Alta: 'prio-alta', 'Crítica': 'prio-critica', 'Não definida': 'prio-ndef' };
  return map[p] || 'prio-ndef';
}
function prioIcon(p) {
  const map = { Baixa: '↓', 'Média': '→', Alta: '↑', 'Crítica': '⬆', 'Não definida': '?' };
  return map[p] || '';
}
function ticketRowHTML(c, painelMode) {
  return `
    <div class="ticket-row" data-id="${c.id}">
      <div class="tr-num">${c.id}</div>
      <div class="tr-body">
        <div class="tr-title">${c.tipo} — ${c.setor}</div>
        <div class="tr-meta">
          <span class="badge-status ${statusClass(c.status)}">${c.status}</span>
          <span class="badge-prio ${prioClass(c.prioridade)}">${prioIcon(c.prioridade)} ${c.prioridade}</span>
          <span class="tr-date">${dataFormatada(c.data)}</span>
        </div>
      </div>
      <div class="tr-right">
        <span class="badge-status ${statusClass(c.status)}" style="font-size:.7rem">${c.status}</span>
        <span class="tr-resp">${c.nome}</span>
      </div>
    </div>`;
}

// ─── Problem selector ────────────────────────────────────────────────────────
window.selectProblem = function(el, val) {
  document.querySelectorAll('.problem-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedProblem = val;
  document.getElementById('err-problema').textContent = '';
  document.getElementById('outro-desc').style.display = val === 'Outro problema' ? 'block' : 'none';
};

window.resetChamadoForm = function() {
  document.getElementById('formChamado').reset();
  document.getElementById('outro-desc').style.display = 'none';
  document.querySelectorAll('.problem-option').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.field-error').forEach(e => e.textContent = '');
  document.querySelectorAll('.invalid').forEach(e => e.classList.remove('invalid'));
  selectedProblem = '';
};

// ─── Auto-assign ─────────────────────────────────────────────────────────────
function autoAssignTicket(tipo, setorSolicitante) {
  let candidatos = FUNCIONARIOS.filter(f =>
    f.usuario !== 'admin' && f.role !== 'Gerente' && f.role === setorSolicitante
  );
  if (candidatos.length === 0)
    candidatos = FUNCIONARIOS.filter(f => f.usuario !== 'admin' && f.role !== 'Gerente');
  if (candidatos.length === 0) return 'Sistema';

  const chamadosAbertos = c => c.status !== 'Resolvido' && c.status !== 'Fechado';
  const contagem = cand => chamados.filter(c => c.responsavel === cand.nome && chamadosAbertos(c)).length;
  return candidatos.reduce((melhor, atual) => contagem(atual) < contagem(melhor) ? atual : melhor).nome;
}

// ─── Form submit (new ticket) ─────────────────────────────────────────────────
document.getElementById('formChamado').addEventListener('submit', async function(e) {
  e.preventDefault();
  if (!validarForm()) return;

  let descricaoChamado = '';
  if (selectedProblem === 'Outro problema') {
    descricaoChamado = document.getElementById('fc-desc').value.trim();
  } else {
    const selectedDesc = document.querySelector('.problem-option.selected .problem-desc').textContent;
    descricaoChamado = `Reportou: ${selectedProblem} — ${selectedDesc}`;
  }

  const novo = {
    id:          gerarId(),
    nome:        document.getElementById('fc-nome').value.trim(),
    cpf:         document.getElementById('fc-cpf').value.trim(),
    email:       document.getElementById('fc-email').value.trim(),
    setor:       document.getElementById('fc-setor').value,
    tipo:        selectedProblem,
    prioridade:  'Não definida',
    descricao:   descricaoChamado,
    status:      'Aberto',
    responsavel: autoAssignTicket(selectedProblem, document.getElementById('fc-setor').value),
    data:        new Date().toISOString(),
    observacoes: [],
    historico:   [],
  };

  const obsAdicionais = document.getElementById('fc-obs').value.trim();
  if (obsAdicionais) {
    novo.observacoes.push({ autor: novo.nome, data: novo.data, texto: obsAdicionais });
  }

  chamados.push(novo);
  await dbSaveTicket(novo);

  await addNotif(`Chamado ${novo.id} aberto`, `${novo.tipo} · ${novo.setor}`);
  toast('success', 'Chamado aberto!', `ID: ${novo.id} — ${novo.tipo}`);
  resetChamadoForm();
  irPara('meus');
});

function validarForm() {
  let ok = true;
  const campos = [
    { id: 'fc-nome',  msg: 'Informe seu nome.' },
    { id: 'fc-cpf',   msg: 'Informe o CPF.' },
    { id: 'fc-email', msg: 'Informe um e-mail válido.' },
    { id: 'fc-setor', msg: 'Selecione o setor.' },
  ];
  campos.forEach(({ id, msg }) => {
    const el  = document.getElementById(id);
    const err = document.getElementById(`err-${id.split('-')[1]}`);
    if (!el.value.trim()) {
      el.classList.add('invalid');
      if (err) err.textContent = msg;
      ok = false;
    } else {
      el.classList.remove('invalid');
      if (err) err.textContent = '';
    }
  });

  const emailEl  = document.getElementById('fc-email');
  const errEmail = document.getElementById('err-email');
  if (emailEl.value && !/\S+@\S+\.\S+/.test(emailEl.value)) {
    emailEl.classList.add('invalid');
    if (errEmail) errEmail.textContent = 'E-mail inválido.';
    ok = false;
  }

  if (!selectedProblem) {
    document.getElementById('err-problema').textContent = 'Selecione o tipo de problema.';
    ok = false;
  } else {
    document.getElementById('err-problema').textContent = '';
  }

  const descEl  = document.getElementById('fc-desc');
  const errDesc = document.getElementById('err-outro');
  if (selectedProblem === 'Outro problema' && !descEl.value.trim()) {
    descEl.classList.add('invalid');
    if (errDesc) errDesc.textContent = 'Por favor, descreva o problema.';
    ok = false;
  } else if (selectedProblem === 'Outro problema') {
    descEl.classList.remove('invalid');
    if (errDesc) errDesc.textContent = '';
  }
  return ok;
}

['fc-nome','fc-cpf','fc-email','fc-setor','fc-desc'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', function() {
    this.classList.remove('invalid');
    const err = document.getElementById(`err-${id.split('-')[1]}`);
    if (err) err.textContent = '';
  });
});

// ─── Meus Chamados ────────────────────────────────────────────────────────────
function renderMeusChamados() {
  const busca  = document.getElementById('searchMeus').value.toLowerCase();
  const status = document.getElementById('filterStatus').value;
  const setor  = document.getElementById('filterSetor').value;
  const prio   = document.getElementById('filterPrio').value;

  let lista = [...chamados].reverse().filter(c => {
    const texto = `${c.id} ${c.nome} ${c.descricao} ${c.tipo}`.toLowerCase();
    return (!busca  || texto.includes(busca))
        && (!status || c.status === status)
        && (!setor  || c.setor  === setor)
        && (!prio   || c.prioridade === prio);
  });

  const cont = document.getElementById('meusChamadosList');
  if (lista.length === 0) {
    cont.innerHTML = `<div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p>Nenhum chamado encontrado.</p></div>`;
    return;
  }
  cont.innerHTML = lista.map(c => ticketRowHTML(c, false)).join('');
  cont.querySelectorAll('.ticket-row').forEach(row =>
    row.addEventListener('click', () => abrirModal(row.dataset.id)));
}

['searchMeus','filterStatus','filterSetor','filterPrio'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderMeusChamados);
  document.getElementById(id)?.addEventListener('change', renderMeusChamados);
});

// ─── Login ────────────────────────────────────────────────────────────────────
document.getElementById('formLogin').addEventListener('submit', async function(e) {
  e.preventDefault();
  document.getElementById('loginError').textContent = '';

  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;

  const func = FUNCIONARIOS.find(f => f.usuario.toLowerCase() === user.toLowerCase() && f.senha === pass);

  if (!func) {
    document.getElementById('loginError').textContent = 'Usuário ou senha inválidos.';
    return;
  }
  funcLogado = func;
  logado = true;
  await loadLastRead();
  entrarPainel();
});

document.getElementById('passToggle')?.addEventListener('click', function() {
  const inp = document.getElementById('login-pass');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// ─── Painel ───────────────────────────────────────────────────────────────────
function entrarPainel() {
  document.getElementById('painelLogin').style.display     = 'none';
  document.getElementById('painelDashboard').style.display = 'block';

  if (funcLogado.foto) {
    document.getElementById('empAvatar').innerHTML = `<img src="${funcLogado.foto}" alt="${funcLogado.nome}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';this.parentNode.textContent='${funcLogado.nome[0].toUpperCase()}'">`;
  } else {
    document.getElementById('empAvatar').textContent = funcLogado.nome[0].toUpperCase();
  }
  document.getElementById('empName').textContent = funcLogado.nome;
  document.getElementById('empRole').textContent = funcLogado.role;

  document.body.classList.add('is-logged-in');
  if (funcLogado.usuario === 'admin' || funcLogado.role.toLowerCase().includes('gerente')) {
    document.body.classList.add('is-admin');
    document.getElementById('tabTodosAtend').style.display = 'inline-flex';
    painelTab = 'todos';
    document.getElementById('tabTodosAtend').classList.add('active');
    document.getElementById('tabMeusAtend').classList.remove('active');
  } else {
    document.getElementById('tabTodosAtend').style.display = 'none';
    painelTab = 'meus';
    document.getElementById('tabMeusAtend').classList.add('active');
    document.getElementById('tabTodosAtend').classList.remove('active');
  }

  atualizarStatsEmp();
  renderPainelLista();
  renderNotifs();
}

function atualizarStatsEmp() {
  const listaStats = painelTab === 'todos' ? chamados : chamados.filter(c => c.responsavel === funcLogado.nome);
  const total = listaStats.length;
  const conc  = listaStats.filter(c => c.status === 'Resolvido' || c.status === 'Fechado').length;
  const taxa  = total > 0 ? Math.round((conc / total) * 100) : 0;
  document.getElementById('empTotal').textContent      = total;
  document.getElementById('empConcluidos').textContent = conc;
  document.getElementById('empTaxa').textContent       = `${taxa}%`;
}

document.getElementById('btnLogout')?.addEventListener('click', () => {
  logado = false;
  funcLogado = null;
  document.getElementById('painelLogin').style.display     = '';
  document.getElementById('painelDashboard').style.display = 'none';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.body.classList.remove('is-logged-in', 'is-admin');
  renderNotifs();
  const activePage = document.querySelector('.page.active')?.id;
  if (['page-equipe','page-relatorios','page-suporte','page-chat'].includes(activePage)) irPara('home');
});

document.getElementById('tabMeusAtend')?.addEventListener('click', (e) => {
  painelTab = 'meus';
  e.target.classList.add('active');
  document.getElementById('tabTodosAtend').classList.remove('active');
  atualizarStatsEmp(); renderPainelLista();
});
document.getElementById('tabTodosAtend')?.addEventListener('click', (e) => {
  painelTab = 'todos';
  e.target.classList.add('active');
  document.getElementById('tabMeusAtend').classList.remove('active');
  atualizarStatsEmp(); renderPainelLista();
});

function renderPainel() {
  if (!logado) return;
  atualizarStatsEmp();
  renderPainelLista();
}

function renderPainelLista() {
  const busca  = document.getElementById('searchPainel').value.toLowerCase();
  const status = document.getElementById('pFilterStatus').value;
  const setor  = document.getElementById('pFilterSetor').value;

  let lista = [...chamados].reverse().filter(c => {
    const isMine = c.responsavel === funcLogado.nome;
    if (painelTab === 'meus' && !isMine) return false;
    const texto = `${c.id} ${c.nome} ${c.descricao} ${c.tipo}`.toLowerCase();
    return (!busca  || texto.includes(busca))
        && (!status || c.status === status)
        && (!setor  || c.setor  === setor);
  });

  const cont = document.getElementById('painelList');
  if (lista.length === 0) {
    cont.innerHTML = `<div class="empty-state"><p>Nenhum chamado encontrado.</p></div>`;
    return;
  }
  cont.innerHTML = lista.map(c => ticketRowHTML(c, true)).join('');
  cont.querySelectorAll('.ticket-row').forEach(row =>
    row.addEventListener('click', () => abrirModal(row.dataset.id, true)));
}

['searchPainel','pFilterStatus','pFilterSetor'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderPainelLista);
  document.getElementById(id)?.addEventListener('change', renderPainelLista);
});

// ─── Modal ────────────────────────────────────────────────────────────────────
function abrirModal(id, isPainel = false) {
  const c = chamados.find(x => x.id === id);
  if (!c) return;

  const isAdmin = funcLogado && (funcLogado.usuario === 'admin' || funcLogado.role.toLowerCase().includes('gerente'));
  document.getElementById('modalTitle').textContent = `Chamado ${c.id}`;

  document.getElementById('modalBody').innerHTML = `
    <div class="modal-meta-grid">
      <div class="modal-field"><label>Solicitante</label><p>${c.nome}</p></div>
      <div class="modal-field"><label>CPF</label><p>${c.cpf || '—'}</p></div>
      <div class="modal-field"><label>E-mail</label><p>${c.email}</p></div>
      <div class="modal-field"><label>Setor</label><p>${c.setor}</p></div>
      <div class="modal-field"><label>Tipo</label><p>${c.tipo}</p></div>
      <div class="modal-field"><label>Prioridade</label>
        <p><span class="badge-prio ${prioClass(c.prioridade)}">${prioIcon(c.prioridade)} ${c.prioridade}</span></p>
      </div>
      <div class="modal-field"><label>Status</label>
        <p><span class="badge-status ${statusClass(c.status)}">${c.status}</span></p>
      </div>
      <div class="modal-field"><label>Abertura</label><p>${dataFormatada(c.data)}</p></div>
      ${c.responsavel ? `<div class="modal-field"><label>Responsável</label><p>${c.responsavel}</p></div>` : ''}
    </div>
    <div class="modal-section-title">Descrição</div>
    <div class="modal-desc-box">${c.descricao}</div>
    ${(c.observacoes.length > 0 && logado) ? `
      <div class="modal-section-title">Observações</div>
      <div class="obs-list">
        ${c.observacoes.map(o => `
          <div class="obs-item">
            <div class="obs-meta">${o.autor} · ${dataFormatada(o.data)}</div>
            <p>${o.texto}</p>
          </div>`).join('')}
      </div>` : ''}
    ${(c.historico && c.historico.length > 0 && isAdmin) ? `
      <div class="modal-section-title">Histórico de Alterações</div>
      <div class="obs-list">
        ${c.historico.map(h => `
          <div class="obs-item" style="background:transparent;border:1px dashed var(--border);padding:.75rem;">
            <div class="obs-meta">${h.autor} · ${dataFormatada(h.data)}</div>
            <p style="font-size:.85rem;color:var(--text-2);margin-top:.25rem;">${h.mensagem}</p>
          </div>`).join('')}
      </div>` : ''}
    ${isPainel && logado ? `
      <div class="modal-section-title">Ações do Funcionário</div>
      <div class="modal-action-row">
        <select id="modalNovoStatus">
          <option value="">Alterar status…</option>
          <option>Aberto</option><option>Em análise</option><option>Em andamento</option>
          <option>Aguardando resposta</option><option>Resolvido</option><option>Fechado</option>
        </select>
        ${isAdmin ? `
        <select id="modalPrioridade">
          <option value="">Alterar prioridade…</option>
          <option value="Baixa">Baixa</option><option value="Média">Média</option>
          <option value="Alta">Alta</option><option value="Crítica">Crítica</option>
        </select>
        <select id="modalResponsavel">
          <option value="">Atribuir responsável…</option>
          ${FUNCIONARIOS.map(f => `<option value="${f.nome}">${f.nome}</option>`).join('')}
        </select>` : ''}
      </div>
      <div class="modal-action-row">
        <textarea id="modalObs" placeholder="Adicionar observação…"></textarea>
      </div>` : ''}
  `;

  const foot = document.getElementById('modalFoot');
  if (isPainel && logado) {
    foot.innerHTML = `
      ${isAdmin ? `<button class="btn-ghost" id="modalExcluir" style="color:var(--red);border-color:var(--red);">Excluir Chamado</button><div style="flex:1"></div>` : ''}
      <button class="btn-ghost" id="modalCancelar">Fechar</button>
      <button class="btn-primary" id="modalSalvar">Salvar Alterações</button>`;
    document.getElementById('modalSalvar').addEventListener('click', () => salvarModal(c.id));
    document.getElementById('modalCancelar').addEventListener('click', fecharModal);
    if (isAdmin) document.getElementById('modalExcluir').addEventListener('click', () => excluirChamado(c.id));
  } else {
    foot.innerHTML = `<button class="btn-ghost" id="modalFechar">Fechar</button>`;
    document.getElementById('modalFechar').addEventListener('click', fecharModal);
  }
  document.getElementById('modalOverlay').classList.add('open');
}

async function salvarModal(id) {
  const idx = chamados.findIndex(c => c.id === id);
  if (idx === -1) return;

  const novoStatus = document.getElementById('modalNovoStatus')?.value;
  const resp       = document.getElementById('modalResponsavel')?.value;
  const novaPrio   = document.getElementById('modalPrioridade')?.value;
  const obs        = document.getElementById('modalObs')?.value.trim();

  if (novoStatus) chamados[idx].status = novoStatus;
  if (resp)       chamados[idx].responsavel = resp;
  if (novaPrio)   chamados[idx].prioridade = novaPrio;
  if (obs) {
    chamados[idx].observacoes.push({ autor: funcLogado?.nome || 'Sistema', data: new Date().toISOString(), texto: obs });
  }

  await dbSaveTicket(chamados[idx]);

  await addNotif(`Chamado ${id} atualizado`, novoStatus ? `Status: ${novoStatus}` : 'Observação adicionada');
  toast('info', `Chamado ${id} atualizado`, novoStatus ? `Novo status: ${novoStatus}` : '');
  fecharModal();
  renderPainelLista();
  atualizarHome();
}

window.excluirChamado = async function(id) {
  if (!confirm('Tem certeza que deseja excluir permanentemente este chamado?')) return;
  chamados = chamados.filter(c => c.id !== id);
  await dbDeleteTicket(id);
  toast('info', 'Chamado excluído', `O chamado ${id} foi removido do sistema.`);
  fecharModal();
  atualizarStatsEmp();
  renderPainelLista();
  atualizarHome();
};

function fecharModal() { document.getElementById('modalOverlay').classList.remove('open'); }
document.getElementById('modalClose').addEventListener('click', fecharModal);
document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) fecharModal();
});

// ─── Equipe ───────────────────────────────────────────────────────────────────
function renderEquipe() {
  const cont = document.getElementById('equipeList');
  if (!cont) return;
  cont.innerHTML = FUNCIONARIOS.map(f => `
    <div class="equipe-card">
      <div class="eq-av">${f.foto
        ? `<img src="${f.foto}" alt="${f.nome}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';this.parentNode.textContent='${f.nome[0].toUpperCase()}'">`
        : f.nome[0].toUpperCase()}</div>
      <div class="eq-info">
        <div class="eq-name">${f.nome}</div>
        <div class="eq-role">${f.role}</div>
        <div class="eq-user">Login: <code>${f.usuario}</code></div>
      </div>
      <div class="eq-actions">
        <button class="eq-edit" onclick="editarFuncionario('${f.usuario}')" title="Editar Funcionário">
          <i class="ti ti-pencil"></i>
        </button>
        ${f.usuario !== 'admin' ? `
        <button class="eq-del" onclick="removerFuncionario('${f.usuario}')" title="Remover Funcionário">
          <i class="ti ti-trash"></i>
        </button>` : ''}
      </div>
    </div>
  `).join('');
}

window.editarFuncionario = function(usuario) {
  const func = FUNCIONARIOS.find(f => f.usuario === usuario);
  if (!func) return;
  editandoUsuario = usuario;
  document.getElementById('eq-nome').value  = func.nome;
  document.getElementById('eq-cargo').value = func.role;
  document.getElementById('eq-user').value  = func.usuario;
  document.getElementById('eq-pass').value  = func.senha;
  document.getElementById('formEquipeTitle').textContent = 'Editar Funcionário';
  document.getElementById('btnSubmitEquipe').textContent = 'Salvar Alterações';
  document.getElementById('btnCancelEdit').style.display = 'inline-flex';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.cancelarEdicao = function() {
  editandoUsuario = null;
  document.getElementById('formEquipe').reset();
  document.getElementById('formEquipeTitle').textContent = 'Cadastrar Novo Funcionário';
  document.getElementById('btnSubmitEquipe').textContent = 'Adicionar Funcionário';
  document.getElementById('btnCancelEdit').style.display = 'none';
};

window.removerFuncionario = async function(usuario) {
  if (usuario === 'admin') return toast('error', 'Ação negada', 'O administrador principal não pode ser removido.');
  if (!confirm(`Tem certeza que deseja remover o usuário ${usuario}?`)) return;
  if (editandoUsuario === usuario) cancelarEdicao();

  const funcObj = FUNCIONARIOS.find(f => f.usuario === usuario);
  FUNCIONARIOS = FUNCIONARIOS.filter(f => f.usuario !== usuario);
  await dbDeleteStaff(usuario);

  if (funcObj) {
    let reatribuidos = 0;
    for (const c of chamados) {
      if (c.responsavel === funcObj.nome && c.status !== 'Resolvido' && c.status !== 'Fechado') {
        const novoResp = autoAssignTicket(c.tipo, c.setor);
        if (!c.historico) c.historico = [];
        c.historico.push({ autor: 'Sistema', data: new Date().toISOString(), mensagem: `Responsável anterior (${funcObj.nome}) removido. Chamado reatribuído para ${novoResp}.` });
        c.observacoes.push({ autor: 'Sistema', data: new Date().toISOString(), texto: `O responsável anterior (${funcObj.nome}) foi removido. Chamado reatribuído automaticamente para ${novoResp}.` });
        c.responsavel = novoResp;
        await dbSaveTicket(c);
        reatribuidos++;
      }
    }
  }
  renderEquipe();
  toast('info', 'Removido', `O usuário ${usuario} foi excluído.`);
};

document.getElementById('formEquipe')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const nome  = document.getElementById('eq-nome').value.trim();
  const cargo = document.getElementById('eq-cargo').value.trim();
  const user  = document.getElementById('eq-user').value.trim();
  const pass  = document.getElementById('eq-pass').value;

  if (!nome || !cargo || !user || !pass) return toast('error', 'Atenção', 'Preencha todos os campos do formulário.');

  if (editandoUsuario) {
    if (editandoUsuario === 'admin' && user !== 'admin')
      return toast('error', 'Ação negada', 'O login do administrador principal não pode ser alterado.');
    if (user.toLowerCase() !== editandoUsuario.toLowerCase() && FUNCIONARIOS.some(f => f.usuario.toLowerCase() === user.toLowerCase()))
      return toast('error', 'Usuário indisponível', 'Já existe outro funcionário com este login.');

    const idx = FUNCIONARIOS.findIndex(f => f.usuario === editandoUsuario);
    if (idx !== -1) {
      // If username changed, delete old record
      if (user.toLowerCase() !== editandoUsuario.toLowerCase()) {
        await dbDeleteStaff(editandoUsuario);
      }
      FUNCIONARIOS[idx] = { usuario: user, senha: pass, nome, role: cargo, foto: FUNCIONARIOS[idx].foto || '' };
      await dbSaveStaff(FUNCIONARIOS[idx]);
      toast('success', 'Sucesso', 'Funcionário atualizado com sucesso!');
      if (funcLogado && funcLogado.usuario === editandoUsuario) {
        funcLogado = FUNCIONARIOS[idx];
        document.getElementById('empName').textContent = funcLogado.nome;
        document.getElementById('empRole').textContent = funcLogado.role;
        if (funcLogado.usuario === 'admin' || funcLogado.role.toLowerCase().includes('gerente'))
          document.body.classList.add('is-admin');
        else document.body.classList.remove('is-admin');
      }
    }
    cancelarEdicao();
  } else {
    if (FUNCIONARIOS.some(f => f.usuario.toLowerCase() === user.toLowerCase()))
      return toast('error', 'Usuário indisponível', 'Já existe um funcionário com este login.');
    const novoFunc = { usuario: user, senha: pass, nome, role: cargo, foto: '' };
    FUNCIONARIOS.push(novoFunc);
    await dbSaveStaff(novoFunc);
    toast('success', 'Sucesso', 'Funcionário cadastrado com sucesso!');
    this.reset();
  }
  renderEquipe();
});

// ─── Suporte / Chat Clientes ──────────────────────────────────────────────────
function autoAssignChat(assunto) {
  let candidatos = FUNCIONARIOS.filter(f => f.usuario !== 'admin' && f.role !== 'Gerente' && f.role === assunto);
  if (candidatos.length === 0) candidatos = FUNCIONARIOS.filter(f => f.usuario !== 'admin' && f.role !== 'Gerente');
  if (candidatos.length === 0) return null;
  const contagem = cand => Object.values(chatsData).filter(c => c.responsavel === cand.usuario).length;
  return candidatos.reduce((melhor, atual) => contagem(atual) < contagem(melhor) ? atual : melhor);
}

function renderSuportePage() {
  if (logado) {
    chatMode = 'admin';
    document.getElementById('chatClienteLogin').style.display = 'none';
    document.getElementById('chatInterface').style.display = 'flex';
    document.getElementById('chatSidebar').style.display = 'flex';
    document.getElementById('btnSairChat').style.display = 'none';
    renderChatList();
    if (chatActiveCpf) renderChatMsgs(chatActiveCpf);
    else {
      document.getElementById('chatActiveUser').textContent = 'Selecione uma conversa';
      document.getElementById('chatInputArea').style.display = 'none';
      document.getElementById('chatMessages').innerHTML = '<div class="empty-state" style="padding:2rem;opacity:.7;">Selecione uma conversa para responder.</div>';
    }
  } else {
    chatMode = 'client';
    if (chatActiveCpf && chatsData[chatActiveCpf]) {
      document.getElementById('chatClienteLogin').style.display = 'none';
      document.getElementById('chatInterface').style.display = 'flex';
      document.getElementById('chatSidebar').style.display = 'none';
      document.getElementById('btnSairChat').style.display = 'inline-flex';
      renderChatMsgs(chatActiveCpf);
    } else {
      document.getElementById('chatClienteLogin').style.display = 'block';
      document.getElementById('chatInterface').style.display = 'none';
    }
  }
}

window.iniciarChatCliente = async function() {
  const cpf    = document.getElementById('chatCpf').value.trim();
  const nome   = document.getElementById('chatNome').value.trim();
  const duvida = document.getElementById('chatDuvida')?.value;
  const obs    = document.getElementById('chatObs')?.value.trim();

  if (!cpf || !nome || !duvida) return toast('error', 'Atenção', 'Preencha Nome, CPF e selecione o assunto.');
  if (chatsData[cpf] && chatsData[cpf].nome.toLowerCase() !== nome.toLowerCase())
    return toast('error', 'Acesso Negado', 'Este CPF já está associado a outro nome no atendimento.');

  chatActiveCpf = cpf;
  let isNew = false;
  if (!chatsData[cpf]) {
    chatsData[cpf] = { nome, assunto: duvida, observacao: obs, mensagens: [] };
    isNew = true;
    typingBots.add(cpf);
    await dbSaveSuporteChat(cpf, chatsData[cpf]);
  }

  renderSuportePage();

  if (isNew) {
    if (obs) {
      chatsData[cpf].mensagens.push({ autor: nome, texto: obs, isStaff: false, data: new Date().toISOString() });
      await dbSendChatMsg(`SUPORTE_${cpf}`, nome, obs, false);
    }
    setTimeout(async () => {
      typingBots.delete(cpf);
      if (chatsData[cpf]) {
        const resp = autoAssignChat(duvida);
        const botMsg = `Sua dúvida sobre "${duvida}" foi registrada. Aguarde uns instantes, um de nossos atendentes irá lhe ajudar.`;
        chatsData[cpf].mensagens.push({ autor: 'Bot', texto: botMsg, isStaff: true, data: new Date().toISOString() });
        await dbSendChatMsg(`SUPORTE_${cpf}`, 'Bot', botMsg, true);

        if (resp) {
          chatsData[cpf].responsavel = resp.usuario;
          await dbSaveSuporteChat(cpf, chatsData[cpf]);
          await addNotif('Novo Atendimento', `O cliente ${nome} iniciou um chat sobre ${duvida}.`, { destinatario: resp.usuario });
        } else {
          await addNotif('Novo Atendimento', `O cliente ${nome} iniciou um chat sobre ${duvida}.`);
        }
        if (chatActiveCpf === cpf) renderChatMsgs(cpf);
      }
    }, 850);
  }
};

window.sairChatCliente = function() {
  chatActiveCpf = null;
  document.getElementById('chatCpf').value = '';
  document.getElementById('chatNome').value = '';
  if (document.getElementById('chatDuvida')) document.getElementById('chatDuvida').value = '';
  if (document.getElementById('chatObs')) document.getElementById('chatObs').value = '';
  renderSuportePage();
};

function renderChatList() {
  const list = document.getElementById('chatList');
  let cpfs = Object.keys(chatsData).reverse();
  const isAdmin = funcLogado && (funcLogado.usuario === 'admin' || funcLogado.role.toLowerCase().includes('gerente'));
  if (!isAdmin) cpfs = cpfs.filter(c => chatsData[c].responsavel === funcLogado.usuario);

  if (cpfs.length === 0) return list.innerHTML = '<div style="padding:1.5rem;color:var(--text-3);font-size:.85rem;text-align:center;">Nenhum chat ativo.</div>';

  list.innerHTML = cpfs.map(c => {
    let respNome = '';
    if (isAdmin && chatsData[c].responsavel) {
      const f = FUNCIONARIOS.find(x => x.usuario === chatsData[c].responsavel);
      if (f) respNome = ` <span style="font-size:.75rem;opacity:.7">(${f.nome})</span>`;
    }
    return `<div class="chat-list-item ${c === chatActiveCpf ? 'active' : ''}" onclick="selectChatAdmin('${c}')">
      <div class="cli-name">${chatsData[c].nome}${respNome}</div>
      <div class="cli-cpf">${c} ${chatsData[c].assunto ? '· ' + chatsData[c].assunto : ''}</div>
    </div>`;
  }).join('');
}

window.selectChatAdmin = function(cpf) {
  chatActiveCpf = cpf;
  renderChatList();
  renderChatMsgs(cpf);
};

function renderChatMsgs(cpf) {
  document.getElementById('chatActiveUser').textContent = chatMode === 'admin'
    ? `Atendimento: ${chatsData[cpf].nome}` : 'Suporte Direto (Gerência)';
  document.getElementById('chatInputArea').style.display = 'flex';
  const msgs = chatsData[cpf].mensagens;
  const container = document.getElementById('chatMessages');

  const transferArea = document.getElementById('chatTransferArea');
  if (transferArea) {
    if (chatMode === 'admin' && cpf !== 'CHAT_INTERNO') {
      transferArea.style.display = 'flex';
      const sel = document.getElementById('chatTransferUser');
      if (sel && FUNCIONARIOS) {
        sel.innerHTML = '<option value="">Encaminhar para...</option>' +
          FUNCIONARIOS.filter(f => f.usuario !== funcLogado.usuario).map(f => `<option value="${f.usuario}">${f.nome} (${f.role})</option>`).join('');
      }
    } else {
      transferArea.style.display = 'none';
    }
  }

  const btnEncerrar = document.getElementById('btnEncerrarChatAdmin');
  if (btnEncerrar) {
    const isAdmin = funcLogado && (funcLogado.usuario === 'admin' || funcLogado.role.toLowerCase().includes('gerente'));
    btnEncerrar.style.display = (chatMode === 'admin' && isAdmin) ? 'inline-flex' : 'none';
  }

  if (msgs.length === 0 && !typingBots.has(cpf)) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:.85rem;margin-top:2rem;">Envie sua primeira mensagem.</div>';
  } else {
    let html = msgs.map(m => {
      if (m.autor === 'Sistema') {
        return `<div style="text-align:center;margin:1rem 0;font-size:.8rem;color:var(--text-2);display:flex;justify-content:center;"><div style="background:var(--bg-hover);padding:.4rem 1rem;border-radius:12px;border:1px dashed var(--border);">${m.texto} <span style="font-size:.7rem;opacity:.7;margin-left:.5rem;">${dataFormatada(m.data)}</span></div></div>`;
      }
      const isMe = (chatMode === 'admin' && m.isStaff) || (chatMode === 'client' && !m.isStaff);
      return `<div class="chat-msg ${isMe ? 'me' : 'other'}"><div class="chat-bubble">${m.texto.replace(/\n/g,'<br/>')}</div><div class="chat-meta">${m.autor} · ${dataFormatada(m.data)}</div></div>`;
    }).join('');
    if (typingBots.has(cpf)) {
      html += `<div class="chat-msg other typing-indicator"><div class="chat-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><div class="chat-meta">Bot · digitando...</div></div>`;
    }
    container.innerHTML = html;
  }
  container.scrollTop = container.scrollHeight;
}

window.enviarMsgChat = async function() {
  if (!chatActiveCpf) return;
  const inp   = document.getElementById('chatInput');
  const texto = inp.value.trim();
  if (!texto) return;

  const isStaff = chatMode === 'admin';
  const autor   = isStaff ? funcLogado.nome : chatsData[chatActiveCpf].nome;

  chatsData[chatActiveCpf].mensagens.push({ autor, texto, isStaff, data: new Date().toISOString() });
  await dbSendChatMsg(`SUPORTE_${chatActiveCpf}`, autor, texto, isStaff);
  inp.value = '';
  renderChatMsgs(chatActiveCpf);

  if (chatMode === 'client') {
    toast('success', 'Enviado', 'Mensagem enviada à gerência.');
    await addNotif('Nova Mensagem (Suporte)', `De: ${autor}`);
  }
};

window.transferirChatCliente = async function() {
  if (!chatActiveCpf) return;
  const sel          = document.getElementById('chatTransferUser');
  const targetUserId = sel.value;
  if (!targetUserId) return toast('info', 'Atenção', 'Selecione um funcionário para encaminhar o atendimento.');

  const targetUser = FUNCIONARIOS.find(f => f.usuario === targetUserId);
  if (!targetUser) return;

  chatsData[chatActiveCpf].responsavel = targetUser.usuario;
  const sysMsg = `Atendimento encaminhado de ${funcLogado.nome} para ${targetUser.nome}.`;
  chatsData[chatActiveCpf].mensagens.push({ autor: 'Sistema', texto: sysMsg, isStaff: true, data: new Date().toISOString() });

  await dbSaveSuporteChat(chatActiveCpf, chatsData[chatActiveCpf]);
  await dbSendChatMsg(`SUPORTE_${chatActiveCpf}`, 'Sistema', sysMsg, true);
  await addNotif('Atendimento Encaminhado', `O cliente ${chatsData[chatActiveCpf].nome} foi repassado para você.`, { destinatario: targetUser.usuario });

  toast('success', 'Encaminhado', `O cliente foi encaminhado para ${targetUser.nome}.`);
  sel.value = '';

  const isAdmin = funcLogado && (funcLogado.usuario === 'admin' || funcLogado.role.toLowerCase().includes('gerente'));
  if (!isAdmin) {
    chatActiveCpf = null;
    document.getElementById('chatActiveUser').textContent = 'Selecione uma conversa';
    document.getElementById('chatInputArea').style.display = 'none';
    document.getElementById('chatMessages').innerHTML = '<div class="empty-state" style="padding:2rem;opacity:.7;">Selecione uma conversa para responder.</div>';
  }
  renderChatList();
  if (chatActiveCpf) renderChatMsgs(chatActiveCpf);
};

window.encerrarChatAdmin = async function() {
  if (!chatActiveCpf) return;
  if (!confirm('Deseja realmente encerrar este atendimento? A conversa será removida da lista ativa.')) return;

  await dbDeleteSuporteChat(chatActiveCpf);
  delete chatsData[chatActiveCpf];

  toast('success', 'Encerrado', 'O atendimento foi encerrado.');
  chatActiveCpf = null;
  document.getElementById('chatActiveUser').textContent = 'Selecione uma conversa';
  document.getElementById('chatInputArea').style.display = 'none';
  document.getElementById('chatMessages').innerHTML = '<div class="empty-state" style="padding:2rem;opacity:.7;">Selecione uma conversa para responder.</div>';
  if (document.getElementById('chatTransferArea')) document.getElementById('chatTransferArea').style.display = 'none';
  if (document.getElementById('btnEncerrarChatAdmin')) document.getElementById('btnEncerrarChatAdmin').style.display = 'none';
  renderChatList();
};

setTimeout(() => {
  document.getElementById('chatInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.enviarMsgChat(); }
  });
}, 100);

// ─── Chat Interno ─────────────────────────────────────────────────────────────
window.loadLastRead = async function() {
  if (!funcLogado) return;
  const raw = await dbGetConfig(`last_read_${funcLogado.usuario}`, '{}');
  try {
    lastReadTime = JSON.parse(raw || '{}');
  } catch (e) {
    lastReadTime = {};
  }
};
window.saveLastRead = async function() {
  if (funcLogado) await dbSetConfig(`last_read_${funcLogado.usuario}`, JSON.stringify(lastReadTime));
};
window.getUnreadCount = function(chatId, msgs) {
  if (!funcLogado || !msgs || msgs.length === 0) return 0;
  const lrTime = lastReadTime[chatId] ? new Date(lastReadTime[chatId]).getTime() : 0;
  return msgs.filter(m => new Date(m.data).getTime() > lrTime && m.autor !== funcLogado.nome).length;
};
window.updateChatBadge = async function() {
  if (!funcLogado) return;
  await loadLastRead();
  let totalUnread = getUnreadCount('GERAL', chatInternoMsgs);
  if (FUNCIONARIOS) {
    FUNCIONARIOS.forEach(f => {
      if (f.usuario !== funcLogado.usuario) {
        const convKey = [funcLogado.usuario, f.usuario].sort().join('_');
        totalUnread += getUnreadCount(f.usuario, directMsgs[convKey] || []);
      }
    });
  }
  const navItem = document.querySelector('.nav-item[data-page="chat"]');
  if (navItem) {
    let badge = navItem.querySelector('.chat-badge');
    if (totalUnread > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chat-badge';
        badge.style.cssText = 'background:var(--red);color:white;font-size:.65rem;padding:.1rem .4rem;border-radius:10px;margin-left:auto;font-weight:bold;';
        navItem.appendChild(badge);
      }
      badge.textContent = totalUnread > 9 ? '9+' : totalUnread;
    } else if (badge) badge.remove();
  }
};

window.renderChatInternoList = async function() {
  const list = document.getElementById('chatInternoList');
  if (!list) return;

  if (logado) {
    await loadLastRead();
    lastReadTime[chatInternoActive] = new Date().toISOString();
    await saveLastRead();
  }

  let chatItems = [];
  let geralLastTime = chatInternoMsgs.length > 0 ? chatInternoMsgs[chatInternoMsgs.length - 1].data : '';
  chatItems.push({ id: 'GERAL', name: '💬 Chat Geral', role: 'Equipe', lastTime: geralLastTime, unread: getUnreadCount('GERAL', chatInternoMsgs) });

  if (funcLogado && FUNCIONARIOS) {
    FUNCIONARIOS.forEach(f => {
      if (f.usuario !== funcLogado.usuario) {
        const convKey = [funcLogado.usuario, f.usuario].sort().join('_');
        const msgs = directMsgs[convKey] || [];
        const lastTime = msgs.length > 0 ? msgs[msgs.length - 1].data : '';
        chatItems.push({ id: f.usuario, name: `👤 ${f.nome}`, role: f.role, lastTime, unread: getUnreadCount(f.usuario, msgs) });
      }
    });
  }

  chatItems.sort((a, b) => {
    const tA = a.lastTime ? new Date(a.lastTime).getTime() : 0;
    const tB = b.lastTime ? new Date(b.lastTime).getTime() : 0;
    if (tA !== tB) return tB - tA;
    if (a.id === 'GERAL') return -1;
    if (b.id === 'GERAL') return 1;
    return a.name.localeCompare(b.name);
  });

  list.innerHTML = chatItems.map(item => {
    const funcItem = FUNCIONARIOS.find(f => f.usuario === item.id);
    const avatarHtml = funcItem && funcItem.foto
      ? `<img src="${funcItem.foto}" alt="${funcItem.nome}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;margin-right:.6rem;flex-shrink:0;" onerror="this.outerHTML='<div style=\'width:32px;height:32px;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;margin-right:.6rem;flex-shrink:0;\'>${item.name[0].toUpperCase()}</div>'">`
      : `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;margin-right:.6rem;flex-shrink:0;">${item.name[0].toUpperCase()}</div>`;
    return `
    <div class="chat-list-item ${chatInternoActive === item.id ? 'active' : ''}" onclick="selectChatInterno('${item.id}')" style="display:flex;align-items:center;">
      ${item.id !== 'GERAL' ? avatarHtml : '<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-size:1rem;margin-right:.6rem;flex-shrink:0;">💬</div>'}
      <div style="flex:1;min-width:0;">
        <div class="cli-name">${item.name}</div>
        <div class="cli-cpf">${item.role}</div>
      </div>
      ${item.unread > 0 ? `<div style="background:var(--red);color:white;font-size:.75rem;padding:.1rem .4rem;border-radius:10px;font-weight:bold;">${item.unread}</div>` : ''}
    </div>`;
  }).join('');
  updateChatBadge();
};

window.selectChatInterno = function(target) {
  chatInternoActive = target;
  renderChatInternoList();
  renderChatInterno();
};

function renderChatInterno() {
  const container = document.getElementById('chatInternoMessages');
  if (!container) return;

  if (chatInternoActive === 'GERAL') {
    document.getElementById('chatInternoHeader').textContent = '💬 Chat Geral da Empresa';
    if (chatInternoMsgs.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:.85rem;margin-top:2rem;">Envie a primeira mensagem para a equipe.</div>';
    } else {
      container.innerHTML = chatInternoMsgs.map(m => {
        const isMe = funcLogado && m.autor === funcLogado.nome;
        return `<div class="chat-msg ${isMe ? 'me' : 'other'}"><div class="chat-bubble">${m.texto.replace(/\n/g,'<br/>')}</div><div class="chat-meta">${m.autor} · ${dataFormatada(m.data)}</div></div>`;
      }).join('');
    }
  } else {
    const targetUser = FUNCIONARIOS.find(f => f.usuario === chatInternoActive);
    if (!targetUser) { chatInternoActive = 'GERAL'; renderChatInternoList(); renderChatInterno(); return; }
    document.getElementById('chatInternoHeader').textContent = `👤 ${targetUser.nome} (${targetUser.role})`;
    const convKey = [funcLogado.usuario, targetUser.usuario].sort().join('_');
    const msgs = directMsgs[convKey] || [];
    if (msgs.length === 0) {
      container.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:.85rem;margin-top:2rem;">Envie a primeira mensagem para ${targetUser.nome}.</div>`;
    } else {
      container.innerHTML = msgs.map(m => {
        const isMe = funcLogado && m.autor === funcLogado.nome;
        return `<div class="chat-msg ${isMe ? 'me' : 'other'}"><div class="chat-bubble">${m.texto.replace(/\n/g,'<br/>')}</div><div class="chat-meta">${m.autor} · ${dataFormatada(m.data)}</div></div>`;
      }).join('');
    }
  }
  container.scrollTop = container.scrollHeight;
}

window.enviarMsgChatInterno = async function() {
  if (!logado) return;
  const inp   = document.getElementById('chatInternoInput');
  const texto = inp.value.trim();
  if (!texto) return;

  if (chatInternoActive === 'GERAL') {
    const msg = { autor: funcLogado.nome, texto, data: new Date().toISOString() };
    chatInternoMsgs.push(msg);
    await dbSendChatMsg('GERAL', funcLogado.nome, texto, true);
    await addNotif('Chat Geral', `Nova mensagem de ${funcLogado.nome}`, { ignorar: funcLogado.usuario });
  } else {
    const targetUser = FUNCIONARIOS.find(f => f.usuario === chatInternoActive);
    if (!targetUser) return;
    const convKey = [funcLogado.usuario, targetUser.usuario].sort().join('_');
    if (!directMsgs[convKey]) directMsgs[convKey] = [];
    const msg = { autor: funcLogado.nome, texto, data: new Date().toISOString() };
    directMsgs[convKey].push(msg);
    await dbSendChatMsg(convKey, funcLogado.nome, texto, true);
    await addNotif('Mensagem', `Nova mensagem de ${funcLogado.nome}`, { destinatario: targetUser.usuario });
  }
  inp.value = '';
  renderChatInternoList();
  renderChatInterno();
};

setTimeout(() => {
  document.getElementById('chatInternoInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.enviarMsgChatInterno(); }
  });
}, 100);

// ─── Relatórios ───────────────────────────────────────────────────────────────
function renderGraficos() {
  Object.values(chartInstances).forEach(ch => ch.destroy());
  chartInstances = {};

  const isDark     = document.body.classList.contains('dark-mode');
  const textColor  = isDark ? '#8da3bf' : '#475569';
  const gridColor  = isDark ? '#1c2e4a' : '#e2e8f0';
  const accent     = isDark ? '#3d7eff' : '#0056e0';
  const cyan       = '#00b8d9';
  const amber      = '#d97706';
  const green      = '#16a34a';
  const red        = '#dc2626';

  const defaults = {
    plugins: { legend: { labels: { color: textColor, font: { family: "'Plus Jakarta Sans'" } } } },
    scales: {
      x: { ticks: { color: textColor }, grid: { color: gridColor } },
      y: { ticks: { color: textColor }, grid: { color: gridColor } },
    },
  };

  const setores  = ['TI','RH','Financeiro','Administrativo','Comercial','Marketing','Redes','Segurança','Infraestrutura'];
  const porSetor = setores.map(s => chamados.filter(c => c.setor === s).length);
  chartInstances.setor = new Chart(document.getElementById('chartSetor'), {
    type: 'bar',
    data: { labels: setores, datasets: [{ label: 'Chamados', data: porSetor, backgroundColor: accent, borderRadius: 6 }] },
    options: { ...defaults, responsive: true, maintainAspectRatio: false },
  });

  const prioridades = ['Baixa','Média','Alta','Crítica'];
  const porPrio     = prioridades.map(p => chamados.filter(c => c.prioridade === p).length);
  chartInstances.prio = new Chart(document.getElementById('chartPrio'), {
    type: 'doughnut',
    data: { labels: prioridades, datasets: [{ data: porPrio, backgroundColor: [green, cyan, amber, red], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor } } } },
  });

  const meses  = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const porMes = meses.map((_, i) =>
    chamados.filter(c => { const d = new Date(c.data); return d.getMonth() === i && (c.status === 'Resolvido' || c.status === 'Fechado'); }).length
  );
  chartInstances.mes = new Chart(document.getElementById('chartMes'), {
    type: 'line',
    data: { labels: meses, datasets: [{ label: 'Concluídos', data: porMes, borderColor: accent, backgroundColor: isDark ? 'rgba(61,126,255,.15)' : 'rgba(0,86,224,.10)', fill: true, tension: 0.4, pointBackgroundColor: accent }] },
    options: { ...defaults, responsive: true, maintainAspectRatio: false },
  });

  chartInstances.tempo = new Chart(document.getElementById('chartTempo'), {
    type: 'bar',
    data: { labels: prioridades, datasets: [{ label: 'Horas médias', data: [48, 24, 8, 2], backgroundColor: [green, cyan, amber, red], borderRadius: 6 }] },
    options: { ...defaults, responsive: true, maintainAspectRatio: false, indexAxis: 'y' },
  });
}

document.getElementById('btnUpdateReports')?.addEventListener('click', renderGraficos);

// ─── Theme ────────────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('themeToggle');
document.body.className = 'light-mode';

async function loadAppTheme() {
  const savedTheme = await dbGetConfig('theme', 'light-mode');
  document.body.className = savedTheme === 'dark-mode' ? 'dark-mode' : 'light-mode';
}

themeToggle.addEventListener('click', async () => {
  const isDark = document.body.classList.contains('dark-mode');
  document.body.className = isDark ? 'light-mode' : 'dark-mode';
  await dbSetConfig('theme', document.body.className);
  const pg = document.querySelector('.page.active');
  if (pg && pg.id === 'page-relatorios') renderGraficos();
});

// ─── UI Events ────────────────────────────────────────────────────────────────
document.getElementById('notifBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('notifPanel').classList.toggle('open');
});
document.getElementById('clearNotifs').addEventListener('click', async () => {
  notificacoes = [];
  if (isDBReady()) {
    try { await supabase.from('notifications').delete().gte('id', 0); } catch(e) {}
  }
  renderNotifs();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn'))
    document.getElementById('notifPanel').classList.remove('open');
});
document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('navLinks').classList.toggle('mobile-open');
});
const backToTop = document.getElementById('backToTop');
window.addEventListener('scroll', () => backToTop.classList.toggle('visible', window.scrollY > 400));
backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

document.querySelectorAll('.nav-item[data-page]').forEach(link =>
  link.addEventListener('click', (e) => { e.preventDefault(); irPara(link.dataset.page); })
);
document.querySelectorAll('[data-goto]').forEach(btn =>
  btn.addEventListener('click', () => irPara(btn.dataset.goto))
);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-goto]');
  if (el) irPara(el.dataset.goto);
});

// Real-time Polling ────────────────────────────────────────────────────────
let _pollInterval = null;
let _lastTicketCount = 0;
let _lastNotifCount = 0;
let _lastChatMsgCount = 0;
let _lastInternoMsgCount = 0;
let _lastSuporteChatKeys = '';

async function pollUpdates() {
  if (!isDBReady()) return;
  try {
    const before = JSON.stringify({
      chamados: chamados.map(t => [t.id, t.status, t.prioridade, t.responsavel, (t.observacoes || []).length]),
      funcionarios: FUNCIONARIOS,
      notificacoes,
      chats: Object.fromEntries(Object.entries(chatsData).map(([cpf, c]) => [cpf, [c.responsavel, c.mensagens?.length || 0]])),
      chatInterno: chatInternoMsgs.length,
      dms: Object.values(directMsgs).reduce((sum, msgs) => sum + msgs.length, 0)
    });

    await reloadAllData();

    const after = JSON.stringify({
      chamados: chamados.map(t => [t.id, t.status, t.prioridade, t.responsavel, (t.observacoes || []).length]),
      funcionarios: FUNCIONARIOS,
      notificacoes,
      chats: Object.fromEntries(Object.entries(chatsData).map(([cpf, c]) => [cpf, [c.responsavel, c.mensagens?.length || 0]])),
      chatInterno: chatInternoMsgs.length,
      dms: Object.values(directMsgs).reduce((sum, msgs) => sum + msgs.length, 0)
    });

    if (before !== after) {
      atualizarHome();
      renderMeusChamados();
      renderNotifs();
      if (logado) { renderPainelLista(); atualizarStatsEmp(); updateChatBadge(); }
      const pg = document.querySelector('.page.active');
      if (pg && pg.id === 'page-equipe') renderEquipe();
      if (pg && pg.id === 'page-suporte') {
        if (chatMode === 'admin') renderChatList();
        if (chatActiveCpf && chatsData[chatActiveCpf]) renderChatMsgs(chatActiveCpf);
      }
      if (pg && pg.id === 'page-chat') { renderChatInternoList(); renderChatInterno(); }
      if (pg && pg.id === 'page-relatorios') renderGraficos();
    }
  } catch (err) {
    console.warn('Poll error:', err);
  }
}
function startPolling(intervalMs = 3000) {
  if (_pollInterval) clearInterval(_pollInterval);
  _pollInterval = setInterval(pollUpdates, intervalMs);
}

function stopPolling() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}

// ─── DB status indicator ──────────────────────────────────────────────────────
function showDBStatus(ok) {
  const badge = document.createElement('div');
  badge.style.cssText = `
    position: fixed; bottom: 1.5rem; left: 1.5rem; z-index: 9999;
    background: ${ok ? 'var(--green, #16a34a)' : '#d97706'};
    color: white; padding: .4rem .9rem; border-radius: 999px;
    font-size: .75rem; font-weight: 600; display: flex; align-items: center; gap: .4rem;
    box-shadow: 0 2px 8px rgba(0,0,0,.2); transition: opacity .5s;
  `;
  badge.innerHTML = ok
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Banco sincronizado'
    : `Banco indisponivel: ${dbErrorReason || 'verifique a configuracao'}`;
  document.body.appendChild(badge);
  setTimeout(() => { badge.style.opacity = '0'; setTimeout(() => badge.remove(), 500); }, 3000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  // Show loading state
  document.getElementById('cnt-abertos').textContent    = '…';
  document.getElementById('cnt-andamento').textContent  = '…';
  document.getElementById('cnt-concluidos').textContent = '…';

  const ok = await initDB();
  showDBStatus(ok);
  if (ok) await loadAppTheme();

  renderNotifs();
  atualizarHome();
  renderEquipe();

  if (ok) {
    startPolling(3000); // poll every 3 seconds when DB is available
  }
})();
