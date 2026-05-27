
        dms: Object.values(directMsgs).reduce((sum, msgs) => sum + msgs.length, 0)
      ;

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
      return;
    
    // ── Tickets ──────────────────────────────────────────────────────────────
    const ticketRows = await db.query('SELECT * FROM tickets ORDER BY created_at ASC');
    const newTickets = ticketRows.rows.map(rowToTicket);
    if (JSON.stringify(newTickets.map(t => t.id + t.status + t.prioridade + t.responsavel + (t.observacoes||[]).length)) !==
        JSON.stringify(chamados.map(t => t.id + t.status + t.prioridade + t.responsavel + (t.observacoes||[]).length))) {
      chamados = newTickets;
      atualizarHome();
      renderMeusChamados();
      if (logado) { renderPainelLista(); atualizarStatsEmp(); }
      const pg = document.querySelector('.page.active');
      if (pg && pg.id === 'page-relatorios') renderGraficos();
    }

    // ── Staff ─────────────────────────────────────────────────────────────────
    const staffRows = await db.query('SELECT * FROM support_staff ORDER BY id ASC');
    const newStaff = staffRows.rows.map(rowToStaff);
    if (JSON.stringify(newStaff) !== JSON.stringify(FUNCIONARIOS.filter(f => f.usuario !== 'admin'))) {
      FUNCIONARIOS = newStaff;
      if (!FUNCIONARIOS.find(f => f.usuario === 'admin'))
        FUNCIONARIOS.unshift({ usuario: 'admin', senha: 'admin', nome: 'Administrador', role: 'Admin', foto: '' });
      const pg = document.querySelector('.page.active');
      if (pg && pg.id === 'page-equipe') renderEquipe();
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    const notifRows = await db.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20');
    const newNotifs = notifRows.rows.map(r => ({
      titulo: r.titulo, texto: r.texto, data: r.created_at,
      destinatario: r.destinatario || '', ignorar: r.ignorar || ''
    }));
    if (JSON.stringify(newNotifs) !== JSON.stringify(notificacoes)) {
      notificacoes = newNotifs;
      renderNotifs();
    }

    // ── Chat Suporte ──────────────────────────────────────────────────────────
    const chatRows = await db.query('SELECT * FROM chats_suporte WHERE encerrado = false ORDER BY created_at DESC');
    const newChatKeys = chatRows.rows.map(c => c.cpf).sort().join(',');
    let suporteMudou = newChatKeys !== _lastSuporteChatKeys;
    _lastSuporteChatKeys = newChatKeys;

    for (const c of chatRows.rows) {
      const msgs = await db.query(
        `SELECT * FROM chat_messages WHERE chat_key = $1 ORDER BY created_at ASC`,
        [`SUPORTE_${c.cpf}`]
      );
      const newMsgs = msgs.rows.map(m => ({ autor: m.autor, texto: m.texto, isStaff: m.is_staff, data: m.created_at }));
      const oldLen = chatsData[c.cpf]?.mensagens?.length || 0;
      if (newMsgs.length !== oldLen || !chatsData[c.cpf]) {
        suporteMudou = true;
        chatsData[c.cpf] = {
          nome: c.nome, assunto: c.assunto, observacao: c.observacao,
          responsavel: c.responsavel, mensagens: newMsgs
        };
      }
    }
    if (suporteMudou) {
      const pg = document.querySelector('.page.active');
      if (pg && pg.id === 'page-suporte') {
        if (chatMode === 'admin') renderChatList();
        if (chatActiveCpf && chatsData[chatActiveCpf]) renderChatMsgs(chatActiveCpf);
      }
    }

    // ── Chat Interno Geral ────────────────────────────────────────────────────
    const geralRows = await db.query(`SELECT * FROM chat_messages WHERE chat_key = 'GERAL' ORDER BY created_at ASC`);
    const newGeralMsgs = geralRows.rows.map(r => ({ autor: r.autor, texto: r.texto, data: r.created_at }));
    if (newGeralMsgs.length !== chatInternoMsgs.length) {
      chatInternoMsgs = newGeralMsgs;
      const pg = document.querySelector('.page.active');
      if (pg && pg.id === 'page-chat') { renderChatInternoList(); renderChatInterno(); }
      else updateChatBadge();
    }

    // ── DMs ───────────────────────────────────────────────────────────────────
    const dmRows = await db.query(`SELECT * FROM chat_messages WHERE chat_key != 'GERAL' AND chat_key NOT LIKE 'SUPORTE_%' ORDER BY created_at ASC`);
    const newDMs = {};
    dmRows.rows.forEach(r => {
      if (!newDMs[r.chat_key]) newDMs[r.chat_key] = [];
      newDMs[r.chat_key].push({ autor: r.autor, texto: r.texto, data: r.created_at });
    });
    const oldDMLen = Object.values(directMsgs).reduce((s, a) => s + a.length, 0);
    const newDMLen = Object.values(newDMs).reduce((s, a) => s + a.length, 0);
    if (newDMLen !== oldDMLen) {
      directMsgs = newDMs;
      const pg = document.querySelector('.page.active');
      if (pg && pg.id === 'page-chat') { renderChatInternoList(); renderChatInterno(); }
      else updateChatBadge();
    }

   trycatch (err); {
    console.warn('Poll error:', err);
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
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ${dbMode === 'supabase' ? 'Banco sincronizado' : 'Banco local conectado'}`
    : `⚠️ Modo offline (localStorage)`;
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

  renderNotifs();
  atualizarHome();
  renderEquipe();

  if (ok) {
    startPolling(3000); // poll every 3 seconds when DB is available
  }
})();
