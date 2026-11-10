// ─────────────────────────────────────────────────────────────────
// AUTH — pantalla de inicio de sesión · FRAME Studio Manager
// ─────────────────────────────────────────────────────────────────

// ── Mensajes de error en español ────────────────────────────────
const AUTH_ERRORS = {
  'auth/user-not-found':         'No existe una cuenta con ese email.',
  'auth/wrong-password':         'Contraseña incorrecta.',
  'auth/invalid-credential':     'Email o contraseña incorrectos.',
  'auth/invalid-email':          'El email no tiene un formato válido.',
  'auth/email-already-in-use':   'Ya existe una cuenta con ese email.',
  'auth/weak-password':          'La contraseña debe tener al menos 6 caracteres.',
  'auth/too-many-requests':      'Demasiados intentos. Esperá unos minutos.',
  'auth/network-request-failed': 'Sin conexión. Verificá tu internet.',
  'auth/popup-closed-by-user':   'Ventana cerrada antes de completar.',
};

// ── Estado de acceso no disponible ───────────────────────────────
const AuthSetupGuide = () => (
  <div
    className="p-3 rounded-lg text-[12px] flex items-center gap-2"
    style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn-soft-2)', color: 'var(--warn)' }}
  >
    <Icon name="alert" size={14} className="flex-shrink-0" />
    <span className="font-medium">El acceso no está disponible en este momento.</span>
  </div>
);

// ── Login screen ─────────────────────────────────────────────────
const LoginScreen = () => {
  const [mode, setMode]           = useState('login'); // 'login' | 'register'
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [name, setName]           = useState('');
  const [role, setRole]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [showSetup, setShowSetup] = useState(false);

  const getError  = (code) => AUTH_ERRORS[code] ?? `Error inesperado (${code})`;
  const resetForm = () => { setError(''); setShowSetup(false); };
  const switchMode = (m) => { setMode(m); resetForm(); };

  // ── Login ──
  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    resetForm();
    try {
      await firebase.auth().signInWithEmailAndPassword(email.trim(), password);
      // onAuthStateChanged en App maneja el resto
    } catch (err) {
      if (err.code === 'auth/operation-not-allowed') setShowSetup(true);
      else setError(getError(err.code));
    } finally {
      setLoading(false);
    }
  };

  // ── Registro ──
  const handleRegister = async () => {
    if (!email.trim() || !password || !name.trim()) return;
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    resetForm();
    try {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email.trim(), password);
      await cred.user.updateProfile({ displayName: name.trim() });

      const col = window.db.collection('frame_users');

      const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
      const colors   = typeof TEAM_COLORS !== 'undefined'
        ? TEAM_COLORS
        : ['var(--resource-green)','var(--resource-coral)','var(--resource-blue)','var(--resource-violet)','var(--warn)','var(--resource-pink)','var(--resource-teal)'];

      const newProfile = {
        id:           cred.user.uid,
        name:         name.trim(),
        role:         role.trim() || 'Colaborador',
        initials,
        color:        colors[Math.floor(Math.random() * colors.length)],
        email:        email.trim().toLowerCase(),
        phone:        '—',
        skills:       [],
        bio:          '',
        availability: 'available',
        joinedAt:     localISO(new Date()),
        // Siempre 'pending'. Las reglas de Firestore rechazan cualquier otro
        // valor en el alta — si no, bastaría con registrarse mandando
        // status:'active' para saltarse la aprobación por completo.
        // El primer admin de un estudio nuevo se activa a mano desde la
        // consola de Firebase (ver SETUP.md).
        status:       'pending',
      };

      // El documento se identifica con el uid, así que crear el propio perfil
      // es todo lo que hace falta.
      //
      // Antes había dos consultas más que hoy las reglas rechazan, y por eso
      // el registro se cortaba a la mitad: la cuenta quedaba creada en
      // Authentication pero el perfil en Firestore no llegaba a escribirse.
      //   · col.get() sobre toda la colección, para saber si era el primer
      //     usuario. Ya no hace falta: el alta siempre es 'pending'.
      //   · col.where('email', ...) para vincular un perfil previo. Era de
      //     cuando los documentos no se identificaban por uid.
      // Las dos son consultas de lista, y Firestore las evalúa contra la
      // regla entera: como sólo se permite leer el perfil propio, rechaza la
      // consulta completa en vez de filtrar.
      await col.doc(cred.user.uid).set(newProfile);

      // El aviso al equipo tampoco se puede hacer desde acá: exigía recorrer
      // todos los usuarios para escribirles en su bandeja. El admin ve las
      // solicitudes pendientes en su pantalla de aprobación.

    } catch (err) {
      if (err.code === 'auth/operation-not-allowed') setShowSetup(true);
      else setError(getError(err.code));
    } finally {
      setLoading(false);
    }
  };

  const submit     = mode === 'login' ? handleLogin : handleRegister;
  const canSubmit  = email.trim() && password &&
    (mode === 'login' || (name.trim() && confirm));

  return (
    <div
      className="frame-auth-stage h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)', position: 'relative', zIndex: 1 }}
    >
      <div className="w-full max-w-[380px] px-5">

        {/* Logo + título */}
        <div className="text-center mb-8 anim-fade-in">
          <FrameLogo height={44} className="frame-auth-logo mx-auto block" />
          <div className="text-[11px] text-[var(--text-muted)] mt-3">
            Studio manager
          </div>
        </div>

        {/* Card */}
        <div
          className="surf-panel overflow-hidden anim-scale-in"
        >
          {/* Tabs modo */}
          <div className="flex p-1 gap-0.5" style={{ background: 'var(--surface-2)' }}>
            {[
              { id: 'login',    label: 'Ingresar'      },
              { id: 'register', label: 'Crear cuenta'  },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => switchMode(t.id)}
                className={`flex-1 py-1.5 rounded-md text-[13px] font-medium transition ${
                  mode === t.id
                    ? 'bg-[var(--surface)] text-white'
                    : 'text-[var(--text-dim)] hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-2.5">
            {/* Campos extra para registro */}
            {mode === 'register' && (
              <>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nombre completo *"
                  className="field w-full px-3 py-2.5 text-[13px]"
                />
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Rol (ej: Editor, Fotógrafo…)"
                  className="field w-full px-3 py-2.5 text-[13px]"
                />
              </>
            )}

            <input
              autoFocus={mode === 'login'}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="field w-full px-3 py-2.5 text-[13px]"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && mode === 'login') submit(); }}
              placeholder="Contraseña"
              className="field w-full px-3 py-2.5 text-[13px]"
            />

            {mode === 'register' && (
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="Confirmar contraseña *"
                className="field w-full px-3 py-2.5 text-[13px]"
              />
            )}

            {/* Error inline */}
            {error && (
              <div
                className="px-3 py-2.5 rounded-lg text-[12px] flex items-start gap-2"
                style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
              >
                <Icon name="alert" size={13} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {/* Guía de setup */}
            {showSetup && <AuthSetupGuide />}

            {/* Botón principal */}
            <button
              onClick={submit}
              disabled={loading || !canSubmit}
              className="w-full py-2.5 rounded-lg text-[13px] font-bold disabled:opacity-40 transition hover:brightness-110 flex items-center justify-center gap-2 mt-1"
              style={{ background: 'var(--accent)', color: 'var(--accent-on)' }}
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-current opacity-60 animate-spin" style={{ borderRightColor: 'transparent' }}></div>
                  Un momento…
                </>
              ) : mode === 'login' ? (
                <>Ingresar al estudio <Icon name="arrowUpRight" size={14} /></>
              ) : (
                'Crear cuenta'
              )}
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-[var(--text-muted)] mt-5">
          LOOPA · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
};

Object.assign(window, { LoginScreen });
