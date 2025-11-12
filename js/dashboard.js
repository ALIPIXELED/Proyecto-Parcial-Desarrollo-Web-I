import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAggSy9FTC9EJ1X2TRBBMtBjIsbnRM7rHQ',
  authDomain: 'equipo-deportivo.firebaseapp.com',
  projectId: 'equipo-deportivo',
  storageBucket: 'equipo-deportivo.firebasestorage.app',
  messagingSenderId: '174209800918',
  appId: '1:174209800918:web:26b4397b069a45014f4777',
  measurementId: 'G-CEP7G3QQ81',
};

const FALLBACK_ROLES = {
  'admin@barca.com': 'admin',
  'empleado@barca.com': 'empleado',
};

const primaryApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(primaryApp);
const db = getFirestore(primaryApp);

let secondaryApp;
try {
  secondaryApp = getApp('SecondaryApp');
} catch (_error) {
  secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
}
const secondaryAuth = getAuth(secondaryApp);

let currentUser = null;
let currentRole = null;
let editingPlayerId = null;

document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  const userEmailDisplay = document.getElementById('user-email-display');
  const userRoleEl = document.getElementById('user-role');
  const registroEmpleadosSection = document.getElementById('registro-empleados');
  const employeeForm = document.getElementById('employee-form');
  const employeeError = document.getElementById('employee-error');
  const employeeSuccess = document.getElementById('employee-success');
  const employeeList = document.getElementById('employee-list');
  const gestionPlantillaSection = document.getElementById('gestion-plantilla');
  const plantillaForm = document.getElementById('plantilla-form');
  const plantillaError = document.getElementById('plantilla-error');
  const plantillaSuccess = document.getElementById('plantilla-success');
  const plantillaList = document.getElementById('plantilla-list');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');

  if (!auth) {
    console.warn('Dashboard no puede inicializarse: falta Firebase.');
    return;
  }

  onAuthStateChanged(auth, async user => {
    if (!user) {
      window.location.href = '../index.html';
      return;
    }

    const role = await ensureUserDocument(user);
    currentUser = { uid: user.uid, email: user.email ?? '', role };
    currentRole = role;

    userEmailDisplay.textContent = currentUser.email;
    userRoleEl.textContent = roleLabels()[role] || role;
    await configureSections(role, {
      registroEmpleadosSection,
      employeeList,
      employeeForm,
      employeeError,
      employeeSuccess,
      gestionPlantillaSection,
      plantillaList,
    });
  });

  logoutBtn?.addEventListener('click', async () => {
    try {
      await signOut(auth);
    } finally {
      window.location.href = '../index.html';
    }
  });

  employeeForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (currentRole !== 'admin') return;
    clearEmployeeFeedback(employeeError, employeeSuccess);

    const name = event.target['employee-name'].value.trim();
    const email = event.target['employee-email'].value.trim().toLowerCase();
    const password = event.target['employee-password'].value.trim();

    if (!name || !email || !password) {
      setEmployeeError('Completa nombre, correo y contraseña.', employeeError, employeeSuccess);
      return;
    }

    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await persistRole(credential.user.uid, { email, role: 'empleado', nombre: name });
      setEmployeeSuccess('Empleado registrado correctamente.', employeeError, employeeSuccess);
      event.target.reset();
      appendEmployeeToList(employeeList, { nombre: name, email });
    } catch (error) {
      handleAuthError(error, message => setEmployeeError(message, employeeError, employeeSuccess));
    } finally {
      try {
        await signOut(secondaryAuth);
      } catch (logoutError) {
        if (logoutError.code !== 'auth/no-current-user') {
          console.warn('Error cerrando sesión secundaria', logoutError);
        }
      }
    }
  });

  plantillaForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!['admin', 'empleado'].includes(currentRole)) return;
    clearPlantillaFeedback(plantillaError, plantillaSuccess);

    const nombre = event.target['player-name'].value.trim();
    const posicion = event.target['player-position'].value.trim();
    const numero = event.target['player-number'].value.trim();
    const notas = event.target['player-notes'].value.trim();

    if (!nombre || !posicion) {
      setPlantillaError('Nombre y posición son obligatorios.', plantillaError, plantillaSuccess);
      return;
    }

    try {
      if (editingPlayerId) {
        await updateDoc(doc(db, 'plantilla', editingPlayerId), {
          nombre,
          posicion,
          numero: numero || '',
          notas,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.uid || 'sistema',
        });
        setPlantillaSuccess('Integrante actualizado.', plantillaError, plantillaSuccess);
      } else {
        await addDoc(collection(db, 'plantilla'), {
          nombre,
          posicion,
          numero: numero || '',
          notas,
          createdAt: serverTimestamp(),
          createdBy: currentUser?.uid || 'sistema',
        });
        setPlantillaSuccess('Integrante agregado.', plantillaError, plantillaSuccess);
      }
      resetPlantillaForm(plantillaForm, cancelEditBtn, true, plantillaError, plantillaSuccess);
      await loadPlantilla(plantillaList);
    } catch (error) {
      console.error('Error guardando integrante', error);
      setPlantillaError('No se pudo guardar el integrante.', plantillaError, plantillaSuccess);
    }
  });

  cancelEditBtn?.addEventListener('click', () => resetPlantillaForm(plantillaForm, cancelEditBtn, true, plantillaError, plantillaSuccess));

  plantillaList?.addEventListener('click', async event => {
    const actionBtn = event.target.closest('[data-action]');
    if (!actionBtn) return;
    const li = actionBtn.closest('li[data-id]');
    if (!li) return;
    const id = li.dataset.id;

    if (actionBtn.dataset.action === 'edit') {
      enterEditMode(li.dataset, plantillaForm, cancelEditBtn, plantillaSuccess);
    }

    if (actionBtn.dataset.action === 'delete') {
      if (!confirm('¿Eliminar este integrante de la plantilla?')) return;
      try {
        await deleteDoc(doc(db, 'plantilla', id));
        setPlantillaSuccess('Integrante eliminado.', plantillaError, plantillaSuccess);
        if (editingPlayerId === id) {
          resetPlantillaForm(plantillaForm, cancelEditBtn, false, plantillaError, plantillaSuccess);
        }
        await loadPlantilla(plantillaList);
      } catch (error) {
        console.error('Error eliminando integrante', error);
        setPlantillaError('No se pudo eliminar el integrante.', plantillaError, plantillaSuccess);
      }
    }
  });

  async function configureSections(role, refs) {
    if (role === 'admin') {
      refs.registroEmpleadosSection?.classList.remove('hidden');
      await loadEmployees(refs.employeeList);
    } else {
      refs.registroEmpleadosSection?.classList.add('hidden');
      if (refs.employeeList) refs.employeeList.innerHTML = '';
    }

    if (['admin', 'empleado'].includes(role)) {
      refs.gestionPlantillaSection?.classList.remove('hidden');
      await loadPlantilla(refs.plantillaList);
    } else {
      refs.gestionPlantillaSection?.classList.add('hidden');
      if (refs.plantillaList) refs.plantillaList.innerHTML = '';
    }
  }

  async function loadEmployees(listEl) {
    if (!listEl) return;
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const employees = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.role === 'empleado') {
          employees.push({ id: docSnap.id, ...data });
        }
      });
      employees.sort((a, b) => (a.nombre || a.email).localeCompare(b.nombre || b.email));
      if (!employees.length) {
        listEl.innerHTML = '<li>No hay empleados registrados.</li>';
        listEl.dataset.initialized = '';
        return;
      }
      listEl.innerHTML = '';
      listEl.dataset.initialized = 'true';
      employees.forEach(emp => {
        appendEmployeeToList(listEl, emp);
      });
    } catch (error) {
      console.error('Error cargando empleados', error);
      listEl.innerHTML = '<li>Error al cargar empleados.</li>';
    }
  }

  function appendEmployeeToList(listEl, emp) {
    if (!listEl || !emp) return;
    if (!listEl.dataset.initialized) {
      listEl.innerHTML = '';
      listEl.dataset.initialized = 'true';
    }
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'list-info';
    const name = document.createElement('strong');
    name.textContent = emp.nombre || 'Sin nombre';
    const meta = document.createElement('span');
    meta.className = 'plantilla-role';
    meta.textContent = emp.email || '';
    info.appendChild(name);
    info.appendChild(meta);
    li.appendChild(info);
    listEl.prepend(li);
  }

  async function loadPlantilla(listEl) {
    if (!listEl) return;
    try {
      const q = query(collection(db, 'plantilla'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        listEl.innerHTML = '<li>Aún no hay integrantes registrados.</li>';
        return;
      }
      listEl.innerHTML = '';
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const li = document.createElement('li');
        li.dataset.id = docSnap.id;
        li.dataset.nombre = data.nombre || '';
        li.dataset.posicion = data.posicion || '';
        li.dataset.numero = data.numero || '';
        li.dataset.notas = data.notas || '';

        const info = document.createElement('div');
        info.className = 'list-info';
        const title = document.createElement('strong');
        title.textContent = data.nombre || 'Sin nombre';
        const meta = document.createElement('div');
        meta.className = 'plantilla-meta';
        const posSpan = document.createElement('span');
        posSpan.textContent = data.posicion || 'Sin posición';
        meta.appendChild(posSpan);
        if (data.numero) {
          const numSpan = document.createElement('span');
          numSpan.textContent = `#${data.numero}`;
          meta.appendChild(numSpan);
        }
        if (data.notas) {
          const notes = document.createElement('span');
          notes.textContent = data.notas;
          meta.appendChild(notes);
        }
        info.appendChild(title);
        info.appendChild(meta);
        li.appendChild(info);

        if (['admin', 'empleado'].includes(currentRole)) {
          const actions = document.createElement('div');
          actions.className = 'list-actions';
          const editBtn = document.createElement('button');
          editBtn.type = 'button';
          editBtn.className = 'list-btn edit';
          editBtn.dataset.action = 'edit';
          editBtn.textContent = 'Editar';
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'list-btn delete';
          deleteBtn.dataset.action = 'delete';
          deleteBtn.textContent = 'Eliminar';
          actions.appendChild(editBtn);
          actions.appendChild(deleteBtn);
          li.appendChild(actions);
        }
        listEl.appendChild(li);
      });
    } catch (error) {
      console.error('Error cargando plantilla', error);
      listEl.innerHTML = '<li>Error al cargar la plantilla.</li>';
    }
  }

  function enterEditMode(data, form, cancelBtn, successEl) {
    if (!form) return;
    form['player-name'].value = data.nombre || '';
    form['player-position'].value = data.posicion || '';
    form['player-number'].value = data.numero || '';
    form['player-notes'].value = data.notas || '';
    editingPlayerId = data.id;
    cancelBtn?.classList.remove('hidden');
    if (successEl) successEl.textContent = 'Editando integrante. Guarda o cancela los cambios.';
  }

  function resetPlantillaForm(form, cancelBtn, clearMessages, errorEl, successEl) {
    if (!form) return;
    form.reset();
    editingPlayerId = null;
    cancelBtn?.classList.add('hidden');
    if (clearMessages) {
      clearPlantillaFeedback(errorEl, successEl);
    }
  }

  function roleLabels() {
    return {
      admin: 'Administrador general',
      empleado: 'Empleado',
    };
  }

  function clearEmployeeFeedback(errorEl, successEl) {
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = '';
  }

  function setEmployeeError(message, errorEl, successEl) {
    if (errorEl) errorEl.textContent = message;
    if (successEl) successEl.textContent = '';
  }

  function setEmployeeSuccess(message, errorEl, successEl) {
    if (successEl) successEl.textContent = message;
    if (errorEl) errorEl.textContent = '';
  }

  function clearPlantillaFeedback(errorEl, successEl) {
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = '';
  }

  function setPlantillaError(message, errorEl, successEl) {
    if (errorEl) errorEl.textContent = message;
    if (successEl) successEl.textContent = '';
  }

  function setPlantillaSuccess(message, errorEl, successEl) {
    if (successEl) successEl.textContent = message;
    if (errorEl) errorEl.textContent = '';
  }
});

async function ensureUserDocument(user) {
  if (!user) return 'empleado';
  const userDocRef = doc(getFirestore(), 'users', user.uid);
  const fallbackRole = FALLBACK_ROLES[user.email?.toLowerCase() || ''] || 'empleado';
  try {
    const snapshot = await getDoc(userDocRef);
    if (snapshot.exists()) {
      return snapshot.data().role || fallbackRole;
    }
    await setDoc(
      userDocRef,
      {
        email: user.email || 'sin-correo',
        role: fallbackRole,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    return fallbackRole;
  } catch (error) {
    console.warn('No se pudo sincronizar el rol, usando valor por defecto.', error);
    return fallbackRole;
  }
}

async function persistRole(uid, account) {
  try {
    await setDoc(
      doc(getFirestore(), 'users', uid),
      {
        email: account.email,
        role: account.role,
        nombre: account.nombre || '',
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('No se pudo guardar el rol para', account.email, error);
  }
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
