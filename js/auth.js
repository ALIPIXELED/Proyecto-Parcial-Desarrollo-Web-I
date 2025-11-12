import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAggSy9FTC9EJ1X2TRBBMtBjIsbnRM7rHQ',
  authDomain: 'equipo-deportivo.firebaseapp.com',
  projectId: 'equipo-deportivo',
  storageBucket: 'equipo-deportivo.firebasestorage.app',
  messagingSenderId: '174209800918',
  appId: '1:174209800918:web:26b4397b069a45014f4777',
  measurementId: 'G-CEP7G3QQ81',
};

const DEFAULT_ACCOUNTS = [
  { email: 'admin@barca.com', password: 'AdminFCB123', role: 'admin' },
  { email: 'empleado@barca.com', password: 'EmpleadoFCB123', role: 'empleado' },
];

let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error('Error inicializando Firebase:', error);
}

const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const secondaryApp = app ? initializeApp(firebaseConfig, 'SecondaryApp') : null;
const secondaryAuth = secondaryApp ? getAuth(secondaryApp) : null;

const actionsCatalog = [
  {
    id: 'reports',
    title: 'Reportes estratégicos',
    description: 'Visualiza métricas clave del club, finanzas, fichajes y desempeño deportivo.',
    roles: ['admin', 'empleado'],
  },
  {
    id: 'content',
    title: 'Gestión de contenidos',
    description: 'Actualiza noticias, calendarios y módulos visuales del sitio.',
    roles: ['admin', 'empleado'],
  },
  {
    id: 'requests',
    title: 'Revisión de solicitudes',
    description: 'Da seguimiento a solicitudes internas y mensajes del área de contacto.',
    roles: ['admin', 'empleado'],
  },
  {
    id: 'adminTools',
    title: 'Control interno',
    description: 'Herramientas reservadas al Administrador general.',
    roles: ['admin'],
  },
];

const roleLabels = {
  admin: 'Administrador general',
  empleado: 'Empleado',
};

document.addEventListener('DOMContentLoaded', () => {
  const loginModal = document.getElementById('login-modal');
  const panelModal = document.getElementById('panel-modal');
  const footerTrigger = document.getElementById('footer-login-trigger');
  const loginCloseBtn = document.getElementById('login-close-btn');
  const panelCloseBtn = document.getElementById('panel-close-btn');

  if (!loginModal || !panelModal || !footerTrigger || !auth || !db) {
    console.warn('El módulo de autenticación no está disponible en esta página.');
    return;
  }

  seedDefaultAccounts();

  const loginForm = document.getElementById('login-form');
  const loginErrorEl = document.getElementById('login-error');
  const authStatus = document.getElementById('auth-status');
  const logoutBtn = document.getElementById('logout-btn');
  const userEmailDisplay = document.getElementById('user-email-display');
  const userRoleEl = document.getElementById('user-role');
  const actionsListEl = document.getElementById('actions-list');
  const modals = document.querySelectorAll('.modal-overlay');

  let currentUser = null;

  footerTrigger.addEventListener('click', () => {
    if (currentUser) {
      openPanelModal();
    } else {
      openLoginModal();
    }
  });

  loginCloseBtn?.addEventListener('click', () => closeModal(loginModal));
  panelCloseBtn?.addEventListener('click', () => closeModal(panelModal));
  modals.forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeModal(loginModal);
      closeModal(panelModal);
    }
  });

  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    clearLoginFeedback();

    const email = loginForm.email.value.trim().toLowerCase();
    const password = loginForm.password.value.trim();

    if (!email || !password) {
      setLoginError('Completa correo y contraseña.');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setAuthStatus('Sesión iniciada correctamente.', 'info');
      loginForm.reset();
    } catch (error) {
      handleAuthError(error, setLoginError);
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    try {
      await signOut(auth);
      setAuthStatus('Sesión cerrada.', 'info');
      closeModal(panelModal);
    } catch (error) {
      handleAuthError(error, message => setAuthStatus(message, 'error'));
    }
  });

  onAuthStateChanged(auth, async user => {
    if (!user) {
      currentUser = null;
      userEmailDisplay.textContent = '';
      userRoleEl.textContent = '';
      actionsListEl.innerHTML = '';
      closeModal(panelModal);
      return;
    }

    try {
      const role = await ensureUserDocument(user);
      currentUser = { uid: user.uid, email: user.email ?? '', role };
      userEmailDisplay.textContent = currentUser.email;
      userRoleEl.textContent = roleLabels[role] || role;
      renderActions(actionsListEl, role);
      closeModal(loginModal);
      openPanelModal();
      setAuthStatus('', 'info');
    } catch (error) {
      console.error('Error obteniendo rol del usuario:', error);
      setAuthStatus('No se pudo obtener tu rol. Intenta nuevamente.', 'error');
    }
  });

  function openLoginModal() {
    closeModal(panelModal);
    openModal(loginModal);
  }

  function openPanelModal() {
    if (!currentUser) {
      openLoginModal();
      return;
    }
    openModal(panelModal);
  }

  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    if ([...modals].every(item => item.classList.contains('hidden'))) {
      document.body.classList.remove('modal-open');
    }
    if (modal === loginModal) {
      loginForm?.reset();
      clearLoginFeedback();
    }
  }

  function clearLoginFeedback() {
    if (loginErrorEl) loginErrorEl.textContent = '';
    setAuthStatus('', 'info');
  }

  function setLoginError(message) {
    if (loginErrorEl) loginErrorEl.textContent = message;
    setAuthStatus('', 'info');
  }

  function setAuthStatus(message, status = 'info') {
    if (!authStatus) return;
    authStatus.textContent = message;
    authStatus.dataset.status = status;
  }
});

async function ensureUserDocument(user) {
  if (!user) return 'empleado';
  const db = getFirestore();
  const userDocRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userDocRef);
  if (snapshot.exists()) {
    return snapshot.data().role || 'empleado';
  }

  await setDoc(userDocRef, {
    email: user.email || 'sin-correo',
    role: 'empleado',
    createdAt: serverTimestamp(),
  });
  return 'empleado';
}

async function seedDefaultAccounts() {
  if (!secondaryAuth || !db) return;

  for (const account of DEFAULT_ACCOUNTS) {
    try {
      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        account.email,
        account.password,
      );
      await persistRole(credential.user.uid, account);
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        try {
          const existing = await signInWithEmailAndPassword(
            secondaryAuth,
            account.email,
            account.password,
          );
          if (existing?.user?.uid) {
            await persistRole(existing.user.uid, account);
          }
        } catch (innerError) {
          console.warn('No se pudo verificar la cuenta', account.email, innerError);
        }
      } else {
        console.error('Error creando cuenta demo', account.email, error);
      }
    } finally {
      try {
        await signOut(secondaryAuth);
      } catch (logoutError) {
        if (logoutError.code !== 'auth/no-current-user') {
          console.warn('Logout secundario falló', logoutError);
        }
      }
    }
  }
}

async function persistRole(uid, account) {
  await setDoc(
    doc(getFirestore(), 'users', uid),
    {
      email: account.email,
      role: account.role,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function renderActions(container, role) {
  if (!container) return;
  container.innerHTML = '';
  actionsCatalog.forEach(action => {
    const allowed = action.roles.includes(role);
    const card = document.createElement('article');
    card.className = allowed ? 'accion-card' : 'accion-card disabled';
    const title = document.createElement('h4');
    title.textContent = action.title;
    const desc = document.createElement('p');
    desc.textContent = action.description;
    card.appendChild(title);
    card.appendChild(desc);
    if (!allowed) {
      const warning = document.createElement('span');
      warning.className = 'pill pill-admin';
      warning.textContent = 'Solo Administrador general';
      card.appendChild(warning);
    }
    container.appendChild(card);
  });
}

function handleAuthError(error, callback) {
  const message = translateAuthError(error);
  callback(message);
}

function translateAuthError(error) {
  const code = error?.code || 'desconocido';
  const messages = {
    'auth/invalid-email': 'El correo no es válido.',
    'auth/email-already-in-use': 'Ese correo ya está registrado.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/operation-not-allowed': 'Operación no permitida. Revisa la consola de Firebase.',
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    'secondary-auth-not-ready': 'No se pudo preparar la autenticación secundaria. Refresca la página.',
  };
  return messages[code] || 'Ocurrió un error con la autenticación.';
}
