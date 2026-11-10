// ─────────────────────────────────────────────────────────────────
// ROUTINE WIDGET — Floating daily checklist with beacon animation
// ─────────────────────────────────────────────────────────────────

const RoutineWidget = ({ workspaceId }) => {
  const { useState, useEffect, useRef, useMemo } = React;

  // ── Panel open/close ──────────────────────────────────────────
  const [open,          setOpen]          = useState(false);
  const [editMode,      setEditMode]      = useState(false);
  const [newText,       setNewText]       = useState('');
  const [editingId,     setEditingId]     = useState(null);
  const [editingTxt,    setEditingTxt]    = useState('');
  const [assignPickerId, setAssignPickerId] = useState(null); // taskId con picker abierto
  const addInputRef = useRef(null);
  const panelRef    = useRef(null);

  // ── Routine data ──────────────────────────────────────────────
  const [tasks,     setTasks]     = useState([]);
  const [checks,    setChecks]    = useState({});
  const [history,   setHistory]   = useState([]);
  const [debt,      setDebt]      = useState({}); // { taskId: diasAcumulados }
  const [carryOver, setCarryOver] = useState(false);
  const [loaded,    setLoaded]    = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Evita que el reset se ejecute dos veces cuando onSnapshot dispara
  // dos veces al iniciar (cache + network) antes de que el write se aplique
  const resetDoneRef = useRef(false);

  const todayISO = localISO(new Date()); // global de views.jsx
  const routineRef = useMemo(() => workspaceId
    ? window.db.collection('frame_workspaces').doc(workspaceId).collection('config').doc('daily_routine')
    : null, [workspaceId]);

  const reportSaveError = (err, action) => {
    console.error(`[FRAME] Routine ${action}:`, err);
    window.frameToast?.(`No se pudo guardar ${action} de la rutina. Recargá para ver el estado real.`);
  };

  // ── Firestore listener ────────────────────────────────────────
  useEffect(() => {
    if (!routineRef) return;
    const ref = routineRef;
    resetDoneRef.current = false;
    setLoaded(false);
    setLoadError(false);
    setTasks([]);
    setChecks({});
    setHistory([]);
    setDebt({});
    setCarryOver(false);

    const unsub = ref.onSnapshot((snap) => {
      if (!snap.exists) {
        ref.set({ tasks: [], today: { date: todayISO, checks: {} }, history: [], config: { carryOver: false } })
          .then(() => setLoaded(true))
          .catch(err => {
            setLoadError(true);
            setLoaded(true);
            reportSaveError(err, 'la configuración inicial');
          });
        return;
      }

      const data          = snap.data();
      const storedTasks   = data.tasks   || [];
      const storedToday   = data.today   || { date: todayISO, checks: {} };
      const storedHistory = data.history || [];
      const storedCarry   = data.config?.carryOver || false;

      setCarryOver(storedCarry);

      // ── Limpiar historial duplicado (bug anterior) ──
      const seen = new Set();
      const cleanHistory = storedHistory.filter(e => {
        if (!e.date || seen.has(e.date)) return false;
        seen.add(e.date);
        return true;
      });
      if (cleanHistory.length !== storedHistory.length) {
        ref.update({ history: cleanHistory }).catch(err => reportSaveError(err, 'el historial'));
      }

      // ── Auto-reset si cambió el día ──
      if (storedToday.date && storedToday.date !== todayISO) {
        // Si el reset ya fue iniciado en esta sesión, ignorar snapshot duplicado
        if (resetDoneRef.current) {
          setTasks(storedTasks);
          setLoaded(true);
          return;
        }
        resetDoneRef.current = true;

        const prevCompleted = storedTasks.filter(t => storedToday.checks?.[t.id]).length;
        const prevTotal     = storedTasks.length;
        const entry         = { date: storedToday.date, completed: prevCompleted, total: prevTotal };
        const updatedHist   = [entry, ...cleanHistory].slice(0, 60);

        // Calcular deuda acumulada si carry-over está activo
        let newDebt = {};
        if (storedCarry) {
          const prevDebt = storedToday.debt || {};
          storedTasks.forEach(t => {
            if (storedToday.checks?.[t.id]) {
              // Completada: limpiar deuda
            } else {
              // No completada: sumar un día
              newDebt[t.id] = (prevDebt[t.id] || 0) + 1;
            }
          });
        }

        ref.update({
          today:   { date: todayISO, checks: {}, debt: newDebt },
          history: updatedHist,
        }).catch(err => {
          setChecks(storedToday.checks || {});
          setDebt(storedToday.debt || {});
          setHistory(cleanHistory);
          reportSaveError(err, 'el reinicio diario');
        });

        setChecks({});
        setDebt(newDebt);
        setHistory(updatedHist);
      } else {
        setChecks(storedToday.checks || {});
        setDebt(storedToday.debt    || {});
        setHistory(cleanHistory);
      }

      setTasks(storedTasks);
      setLoaded(true);
    }, (err) => {
      console.error('[FRAME] Routine error:', err);
      setLoadError(true);
      window.frameToast?.('No se pudo cargar la rutina de este tablero. No se mostrará como vacía para evitar cambios sobre un estado desconocido.');
      setLoaded(true);
    });

    return () => unsub();
  }, [routineRef]);

  // ── Cerrar al click fuera del panel ──────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
        setEditMode(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Toggle check ──────────────────────────────────────────────
  const toggleCheck = (taskId) => {
    const next = { ...checks, [taskId]: !checks[taskId] };
    setChecks(next);
    const updates = { 'today.checks': next };
    // Si se completa una tarea con deuda, limpiar su contador
    if (next[taskId] && debt[taskId]) {
      const nextDebt = { ...debt };
      delete nextDebt[taskId];
      setDebt(nextDebt);
      updates['today.debt'] = nextDebt;
    }
    routineRef.update(updates).catch(err => {
      setChecks(checks);
      setDebt(debt);
      reportSaveError(err, 'el progreso');
    });
  };

  // ── Agregar tarea ─────────────────────────────────────────────
  const addTask = () => {
    const text = newText.trim();
    if (!text) return;
    const id      = 't' + Date.now() + Math.random().toString(36).slice(2, 5);
    const updated = [...tasks, { id, text }];
    setTasks(updated);
    setNewText('');
    routineRef.update({ tasks: updated }).catch(err => {
      setTasks(tasks);
      reportSaveError(err, 'la nueva tarea');
    });
    setTimeout(() => addInputRef.current?.focus(), 40);
  };

  // ── Eliminar tarea ────────────────────────────────────────────
  const deleteTask = (taskId) => {
    const updatedTasks  = tasks.filter(t => t.id !== taskId);
    const updatedChecks = Object.fromEntries(Object.entries(checks).filter(([k]) => k !== taskId));
    setTasks(updatedTasks);
    setChecks(updatedChecks);
    routineRef.update({ tasks: updatedTasks, 'today.checks': updatedChecks }).catch(err => {
      setTasks(tasks);
      setChecks(checks);
      reportSaveError(err, 'la eliminación');
    });
  };

  // ── Asignar tarea a un perfil ────────────────────────────────
  const assignTask = (taskId, userId) => {
    const updated = tasks.map(t => t.id === taskId ? { ...t, assignee: userId || null } : t);
    setTasks(updated);
    setAssignPickerId(null);
    routineRef.update({ tasks: updated }).catch(err => {
      setTasks(tasks);
      reportSaveError(err, 'la asignación');
    });
  };

  // ── Renombrar tarea ───────────────────────────────────────────
  const commitRename = () => {
    if (!editingId) return;
    const text = editingTxt.trim();
    if (!text) { setEditingId(null); return; }
    const updated = tasks.map(t => t.id === editingId ? { ...t, text } : t);
    setTasks(updated);
    setEditingId(null);
    routineRef.update({ tasks: updated }).catch(err => {
      setTasks(tasks);
      reportSaveError(err, 'el nombre');
    });
  };

  // ── Computados ────────────────────────────────────────────────
  const total     = tasks.length;
  const completed = tasks.filter(t => checks[t.id]).length;
  const allDone   = total > 0 && completed === total;
  const pct       = total === 0 ? 0 : Math.round((completed / total) * 100);

  const streak = useMemo(() => {
    const perfect = new Set(
      history.filter(e => e.total > 0 && e.completed === e.total).map(e => e.date)
    );
    if (allDone && total > 0) perfect.add(todayISO);
    let count = 0;
    const now = new Date();
    for (let i = 0; i < 60; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      if (perfect.has(localISO(d))) count++;
      else break;
    }
    return count;
  }, [history, allDone, total, todayISO]);

  const fmtHist = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  };

  const todayLabel = new Date().toLocaleDateString('es', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  // No renderizar hasta que haya datos (evitar flicker)
  if (!loaded || loadError) return null;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div ref={panelRef} style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 200 }}>

      {/* ─── Panel ─── */}
      {open && (
        <div
          className="anim-scale-in"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 12px)',
            right: 0,
            width: 340,
            maxHeight: 560,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 20,
            boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
            transformOrigin: 'bottom right',
          }}
        >
          {/* Header del panel */}
          <div
            className="flex items-start justify-between px-5 pt-4 pb-3"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <div>
              <div className="font-display font-bold text-[17px] select-none" style={{ letterSpacing: '-0.01em' }}>
                Rutina diaria
              </div>
              <div className="text-[11px] mt-0.5 capitalize select-none" style={{ color: 'var(--text-muted)' }}>
                {todayLabel}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              {streak > 0 && (
                <div
                  className="flex items-center gap-1 px-2 py-1 rounded-full select-none"
                  style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn-soft-2)' }}
                >
                  <span style={{ fontSize: 12 }}>🔥</span>
                  <span className="text-[11px] font-bold" style={{ color: 'var(--warn)' }}>
                    {streak}
                  </span>
                </div>
              )}
              <button
                onClick={() => { setOpen(false); setEditMode(false); }}
                className="p-1.5 rounded-lg transition-colors text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-3)]"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="px-5 pt-3.5 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] select-none" style={{ color: 'var(--text-muted)' }}>
                  {allDone ? '¡Todo listo por hoy!' : `${completed} de ${total} completadas`}
                </span>
                <span
                  className="font-display font-black text-[15px] select-none"
                  style={{ letterSpacing: '-0.03em', color: allDone ? 'var(--accent)' : 'var(--text)', lineHeight: 1 }}
                >
                  {completed}
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>/{total}</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                <div
                  style={{
                    height: '100%',
                    width: pct + '%',
                    borderRadius: 999,
                    background: allDone ? 'var(--accent)' : 'var(--resource-green)',
                    transition: 'width 400ms cubic-bezier(.2,.8,.2,1)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Lista de tareas */}
          <div style={{ borderTop: total > 0 ? '1px solid var(--border)' : 'none' }}>

            {/* Estado vacío */}
            {tasks.length === 0 && (
              <div className="px-5 py-8 text-center">
                <div className="text-[13px] font-medium mb-1 select-none" style={{ color: 'var(--text-dim)' }}>
                  Sin tareas todavía
                </div>
                <div className="text-[11px] select-none" style={{ color: 'var(--text-muted)' }}>
                  Tocá "Editar" para armar tu rutina
                </div>
              </div>
            )}

            {tasks.map((task, idx) => {
              const done    = !!checks[task.id];
              const editing = editingId === task.id;
              const isLast  = idx === tasks.length - 1;
              const daysOwed = (!done && carryOver) ? (debt[task.id] || 0) : 0;

              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 px-5 transition-colors"
                  style={{
                    paddingTop: 11, paddingBottom: 11,
                    borderBottom: isLast && !editMode ? 'none' : '1px solid var(--border)',
                    background:  done && !editMode ? 'var(--accent-soft-weak)' : 'transparent',
                    cursor:      editMode ? 'default' : 'pointer',
                  }}
                  onClick={() => !editMode && !editing && toggleCheck(task.id)}
                >
                  {/* Checkbox / handle */}
                  {editMode ? (
                    <Icon name="drag" size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  ) : (
                    <div
                      className="flex-shrink-0"
                      style={{
                        width: 18, height: 18,
                        borderRadius: 5,
                        border:      done ? 'none' : '1.5px solid var(--border-2)',
                        background:  done ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 180ms, border-color 180ms',
                      }}
                    >
                      {done && <Icon name="check" size={10} strokeWidth={3} style={{ color: 'var(--accent-on)' }} />}
                    </div>
                  )}

                  {/* Texto / input editar */}
                  {editing ? (
                    <input
                      autoFocus
                      value={editingTxt}
                      onChange={(e) => setEditingTxt(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')  commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 text-[13px] px-2 py-0.5 rounded"
                      style={{
                        background: 'var(--surface-3)',
                        border:     '1px solid var(--accent)',
                        color:      'var(--text)',
                        outline:    'none',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="flex-1 text-[13px] select-none"
                      style={{
                        color:          done && !editMode ? 'var(--text-muted)' : 'var(--text)',
                        textDecoration: done && !editMode ? 'line-through' : 'none',
                        transition:     'color 180ms',
                      }}
                    >
                      {task.text}
                    </span>
                  )}

                  {/* Botones modo edición */}
                  {editMode && !editing && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">

                      {/* ── Asignar perfil ── */}
                      <div className="relative" data-picker="true">
                        <button
                          onClick={(e) => { e.stopPropagation(); setAssignPickerId(assignPickerId === task.id ? null : task.id); }}
                          className="p-1 rounded transition-colors hover:bg-[var(--surface-3)] flex items-center justify-center"
                          style={{ color: task.assignee ? 'var(--accent)' : 'var(--text-muted)' }}
                          title="Asignar a..."
                        >
                          {task.assignee && getUser(task.assignee)
                            ? <Avatar user={getUser(task.assignee)} size={16} />
                            : <Icon name="users" size={12} />
                          }
                        </button>
                        {assignPickerId === task.id && (
                          <div
                            className="absolute right-0 top-full mt-1 surf-float anim-scale-in overflow-hidden"
                            style={{ background: 'var(--surface-2)', borderColor: 'var(--border-2)', minWidth: 180, maxHeight: 220, overflowY: 'auto', zIndex: 9999, transformOrigin: 'top right' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="px-3 py-2 text-[10px] tracking-[0.16em] uppercase select-none" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                              Asignar tarea
                            </div>
                            <button onClick={() => assignTask(task.id, null)} className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-3)]">
                              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ border: '1.5px dashed var(--border-2)' }}>
                                <Icon name="x" size={9} style={{ color: 'var(--text-muted)' }} />
                              </div>
                              <span className="text-[12px] select-none" style={{ color: 'var(--text-muted)' }}>Sin asignar</span>
                              {!task.assignee && <Icon name="check" size={10} style={{ color: 'var(--accent)', marginLeft: 'auto' }} />}
                            </button>
                            {(window.__liveTeam || []).filter(u => !u.status || u.status === 'active').map(u => (
                              <button key={u.id} onClick={() => assignTask(task.id, u.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-3)]"
                                style={{ background: task.assignee === u.id ? 'var(--surface-3)' : 'transparent' }}
                              >
                                <Avatar user={u} size={20} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12px] font-medium truncate select-none" style={{ color: 'var(--text)' }}>{u.name}</div>
                                  <div className="text-[10px] truncate select-none" style={{ color: 'var(--text-muted)' }}>{u.role}</div>
                                </div>
                                {task.assignee === u.id && <Icon name="check" size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(task.id); setEditingTxt(task.text); }}
                        className="p-1.5 rounded transition-colors text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-3)]"
                        title="Renombrar"
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                        className="p-1.5 rounded transition-colors text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                        title="Eliminar"
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  )}

                  {/* Badge deuda (carry-over) */}
                  {daysOwed > 0 && !editMode && (
                    <span
                      className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md select-none"
                      style={{
                        background: daysOwed >= 3 ? 'var(--danger-soft-2)' : colorAlpha('var(--resource-coral)', 15),
                        color:      daysOwed >= 3 ? 'var(--danger)'                 : 'var(--resource-coral)',
                        border: `1px solid ${daysOwed >= 3 ? 'var(--danger)' : colorAlpha('var(--resource-coral)', 30)}`,
                      }}
                      title={`Sin completar hace ${daysOwed} ${daysOwed === 1 ? 'día' : 'días'}`}
                    >
                      +{daysOwed}d
                    </span>
                  )}

                  {/* Avatar del asignado (modo vista) */}
                  {!editMode && task.assignee && (
                    <div className="flex-shrink-0" title={getUser(task.assignee)?.name}>
                      <Avatar user={getUser(task.assignee)} size={18} />
                    </div>
                  )}

                  {/* Número en modo vista */}
                  {!editMode && (
                    <span className="text-[10px] font-mono flex-shrink-0 select-none" style={{ color: 'var(--text-muted)' }}>
                      {idx + 1}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Fila agregar nueva tarea */}
            {editMode && (
              <div
                className="flex items-center gap-2.5 px-5 py-2.5"
                style={{ borderTop: tasks.length > 0 ? '1px solid var(--border)' : 'none', background: 'var(--surface-2)' }}
              >
                <Icon name="plus" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <input
                  ref={addInputRef}
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
                  placeholder="Nueva tarea…"
                  className="flex-1 text-[13px] py-0.5"
                  style={{ background: 'transparent', color: 'var(--text)' }}
                />
                {newText.trim() && (
                  <button
                    onClick={addTask}
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold flex-shrink-0"
                    style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
                  >
                    Agregar
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Historial compacto (últimos 7 días) */}
          {history.length > 0 && !editMode && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div className="px-5 pt-3 pb-1 flex items-center gap-1.5">
                <Icon name="clock" size={11} style={{ color: 'var(--text-muted)' }} />
                <span className="text-[10px] tracking-[0.18em] uppercase font-semibold select-none" style={{ color: 'var(--text-muted)' }}>
                  Historial reciente
                </span>
              </div>
              <div className="px-5 pb-3 space-y-1">
                {history.slice(0, 7).map((entry) => {
                  const perfect  = entry.total > 0 && entry.completed === entry.total;
                  const entryPct = entry.total > 0 ? Math.round(entry.completed / entry.total * 100) : 0;
                  return (
                    <div key={entry.date} className="flex items-center gap-2.5">
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: perfect ? 'var(--accent-soft)' : 'var(--danger-soft)',
                          border:     `1px solid ${perfect ? 'var(--accent-border)' : 'var(--danger-soft-2)'}`,
                        }}
                      >
                        <span className="select-none" style={{ fontSize: 8, fontWeight: 700, color: perfect ? 'var(--accent)' : 'var(--danger)' }}>
                          {perfect ? '✓' : '✗'}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono capitalize select-none" style={{ color: 'var(--text-muted)', minWidth: 60 }}>
                        {fmtHist(entry.date)}
                      </span>
                      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
                        <div
                          style={{ width: entryPct + '%', height: '100%', borderRadius: 999, background: perfect ? 'var(--accent)' : 'var(--danger)' }}
                        />
                      </div>
                      <span className="text-[11px] font-bold font-mono select-none" style={{ color: perfect ? 'var(--accent)' : 'var(--danger)', minWidth: 28, textAlign: 'right' }}>
                        {entry.completed}/{entry.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer del panel */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: '0 0 20px 20px' }}
          >
            {editMode ? (
              <button
                onClick={() => { setEditMode(false); setNewText(''); setEditingId(null); }}
                className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition"
                style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
              >
                <Icon name="check" size={12} strokeWidth={2.5} />
                Listo
              </button>
            ) : (
              <button
                onClick={() => { setEditMode(true); setTimeout(() => addInputRef.current?.focus(), 80); }}
                className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors text-[var(--text-muted)] hover:text-white hover:bg-[var(--surface-3)]"
              >
                <Icon name="edit" size={12} />
                Editar tareas
              </button>
            )}

            {allDone && streak > 0 && (
              <div className="flex items-center gap-1 select-none">
                <span style={{ fontSize: 13 }}>🔥</span>
                <span className="text-[11px] font-bold" style={{ color: 'var(--warn)' }}>
                  {streak} {streak === 1 ? 'día seguido' : 'días seguidos'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Floating button ─── */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`routine-btn flex items-center gap-2 px-4 rounded-2xl font-semibold transition select-none ${allDone ? 'routine-done' : 'routine-pending'}`}
        style={{
          height: 46,
          fontSize: 13,
          letterSpacing: '-0.01em',
          background:   allDone ? 'var(--accent)'    : 'var(--surface-2)',
          color:        allDone ? 'var(--accent-on)'   : 'var(--text)',
          border:       allDone ? 'none'              : '1px solid var(--border-2)',
          boxShadow:    allDone ? '0 4px 20px var(--accent-soft), 0 2px 8px rgba(0,0,0,0.4)' : '0 4px 20px rgba(0,0,0,0.4)',
        }}
        title="Abrir rutina diaria"
      >
        {allDone ? (
          <>
            <Icon name="check" size={14} strokeWidth={2.5} style={{ color: 'var(--accent-on)' }} />
            <span>{completed}/{total}</span>
            {streak > 0 && <span style={{ fontSize: 13 }}>🔥</span>}
          </>
        ) : (
          <>
            <Icon name="sun" size={14} style={{ color: 'var(--accent)' }} />
            <span>Rutina</span>
            {total > 0 ? (
              <span
                className="font-mono text-[11px] px-1.5 py-0.5 rounded-md"
                style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}
              >
                {completed}/{total}
              </span>
            ) : null}
          </>
        )}
      </button>
    </div>
  );
};
