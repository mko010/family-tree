const state = {people: [], relationships: [], roots: [], focusId: null, view: null, treeSide: 0};
const $ = selector => document.querySelector(selector);
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const personById = id => state.people.find(person => person.id === Number(id));
const fullName = person => `${person.first_name} ${person.last_name}`.trim();
const years = person => [person.birth_date?.slice(0, 4), person.death_date?.slice(0, 4)].filter(Boolean).join(' – ');

async function api(path, options = {}) {
  const response = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación');
  return data;
}

async function load(resetView = false) {
  const data = await api('/api/tree');
  state.people = data.people;
  state.relationships = data.relationships;
  state.roots = state.people.filter(person => person.is_tree_root);
  if (!state.roots.length && state.people.length) state.roots = [state.people[0]];
  if (!state.roots.some(person => person.id === state.focusId)) {
    state.focusId = state.roots[0]?.id ?? null;
    resetView = true;
  }
  if (resetView) state.view = null;
  render();
}

function render() {
  const empty = !state.roots.length;
  $('#emptyState').hidden = !empty;
  $('#workspace').hidden = empty;
  if (empty) return;
  $('#focusPerson').innerHTML = [...state.roots]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map(person => `<option value="${person.id}" ${person.id === state.focusId ? 'selected' : ''}>${esc(fullName(person))}</option>`)
    .join('');
  $('#focusName').textContent = fullName(personById(state.focusId));
  drawTree();
}

function orderedParents(personId) {
  const rows = state.relationships
    .filter(row => row.person_id === personId && row.relation_type === 'parent')
    .map(row => ({...row, person: personById(row.relative_id)}))
    .filter(row => row.person);
  const assigned = {};
  rows.filter(row => row.parent_role).forEach(row => assigned[row.parent_role] = row.person);
  const remaining = rows.filter(row => !row.parent_role).map(row => row.person);
  return {father: assigned.father || remaining.shift() || null, mother: assigned.mother || remaining.shift() || null};
}

function slotsFor(root) {
  const rootSlot = {path: '', person: root, child: null, role: null, level: 0};
  const slots = [rootSlot], pending = [rootSlot];
  while (pending.length) {
    const current = pending.shift();
    const parents = orderedParents(current.person.id);
    const next = [
      {path: `${current.path}0`, person: parents.father, child: current.person, role: 'father', level: current.level + 1},
      {path: `${current.path}1`, person: parents.mother, child: current.person, role: 'mother', level: current.level + 1},
    ];
    slots.push(...next);
    pending.push(...next.filter(slot => slot.person));
  }
  return slots;
}

function polar(cx, cy, radius, angle) {
  const radians = angle * Math.PI / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

function wedge(cx, cy, inner, outer, start, end) {
  const [x1, y1] = polar(cx, cy, outer, start), [x2, y2] = polar(cx, cy, outer, end);
  const [x3, y3] = polar(cx, cy, inner, end), [x4, y4] = polar(cx, cy, inner, start);
  const large = end - start > 180 ? 1 : 0;
  return `M${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4}Z`;
}

function roleName(role) { return role === 'father' ? 'padre' : 'madre'; }
function abbreviate(text, chars) { return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1)).trimEnd()}…`; }

function labelSvg(x, y, label, subtitle, available, visibleScale, root = false) {
  const availablePixels = available * visibleScale;
  if (!root && availablePixels < 46) return '';
  const allowed = Math.max(root ? 8 : 5, Math.floor(availablePixels / (root ? 8 : 7)));
  const shown = abbreviate(label, allowed);
  const words = shown.split(' ');
  const lines = shown.length > Math.min(18, allowed) && words.length > 1
    ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
    : [shown];
  const longest = Math.max(...lines.map(line => line.length));
  const size = Math.max(5, Math.min(root ? 16 : 15, available / Math.max(1, longest) / .58));
  const start = y - (lines.length === 2 ? size * .58 : size * .18);
  const subtitleY = y + (lines.length === 2 ? size * 1.65 : size * 1.05);
  return `<text x="${x}" y="${start}" class="${root ? 'root-name' : 'sector-name'}" style="font-size:${size}px">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * 1.03 : 0}">${esc(line)}</tspan>`).join('')}</text>${subtitle && availablePixels > 74 ? `<text x="${x}" y="${subtitleY}" class="sector-sub">${esc(subtitle)}</text>` : ''}`;
}

function resetView(side, rootId) {
  state.view = {x: 0, y: 0, size: side, rootId};
}

function drawTree() {
  const root = personById(state.focusId), slots = slotsFor(root);
  const levels = Math.max(...slots.map(slot => slot.level));
  const centerRadius = 72, step = 115, outer = centerRadius + levels * step;
  const side = Math.max(760, outer * 2 + 160), cx = side / 2, cy = side / 2;
  if (!state.view || state.view.rootId !== root.id) resetView(side, root.id);
  state.treeSide = side;
  const dark = document.body.classList.contains('dark');
  const palette = dark ? ['#355b2d','#416b36','#4d7a41','#58884b','#639655'] : ['#c2efae','#d8edcc','#e8f4df','#f1f7ec','#f6faf3'];
  const emptyFill = dark ? '#2a3228' : '#f1f3ee';
  const visualScale = ($('#tree')?.clientWidth || 900) / state.view.size;
  const sectors = slots.filter(slot => slot.level).map(slot => {
    const count = 2 ** slot.level, index = parseInt(slot.path, 2), span = 360 / count;
    const start = -180 + index * span, end = start + span;
    const inner = centerRadius + (slot.level - 1) * step + 4, outerRadius = inner + step - 8;
    const mean = (inner + outerRadius) / 2, [x, y] = polar(cx, cy, mean, (start + end) / 2);
    const available = Math.max(20, mean * (span * Math.PI / 180) - 16);
    const label = slot.person ? fullName(slot.person) : `Añadir ${roleName(slot.role)}`;
    const sub = slot.person ? years(slot.person) : 'Pulsa aquí';
    return `<g class="sector ${slot.person ? 'filled' : 'empty'}" data-path="${slot.path}"><path d="${wedge(cx, cy, inner, outerRadius, start, end)}" fill="${slot.person ? palette[Math.min(slot.level - 1, palette.length - 1)] : emptyFill}"/>${labelSvg(x, y, label, sub, available, visualScale)}</g>`;
  }).join('');
  const view = state.view;
  $('#tree').innerHTML = `<div class="zoom-hint">Rueda: ampliar · Arrastrar: mover</div><button id="resetZoom" class="zoom-reset">Vista completa</button><svg id="treeSvg" viewBox="${view.x} ${view.y} ${view.size} ${view.size}" aria-label="Árbol circular de antepasados"><g>${sectors}<g class="root-node"><circle cx="${cx}" cy="${cy}" r="${centerRadius}"/>${labelSvg(cx, cy, fullName(root), years(root), centerRadius * 1.7, visualScale, true)}</g></g></svg>`;
  const activate = element => {
    const sector = element.closest('.sector');
    if (sector) {
      const slot = slots.find(item => item.path === sector.dataset.path);
      if (slot.person) openEditor(slot.person); else addAncestor(slot);
    } else if (element.closest('.root-node')) openEditor(root);
  };
  $('#resetZoom').onclick = () => { resetView(side, root.id); drawTree(); };
  bindViewport(activate, side);
  const lastLevel = Math.max(...slots.filter(slot => slot.person).map(slot => slot.level));
  const removeButton = $('#removeOuterLevel');
  removeButton.hidden = lastLevel === 0;
  removeButton.onclick = () => removeOuterLevel(slots, lastLevel);
}

function updateViewBox() {
  const svg = $('#treeSvg');
  if (svg) svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${state.view.size} ${state.view.size}`);
}

function bindViewport(activate, side) {
  const svg = $('#treeSvg');
  let drag = null, redrawTimer = null;
  const scheduleRedraw = () => {
    if (redrawTimer) return;
    redrawTimer = requestAnimationFrame(() => { redrawTimer = null; drawTree(); });
  };
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    const box = svg.getBoundingClientRect();
    const x = state.view.x + (event.clientX - box.left) / box.width * state.view.size;
    const y = state.view.y + (event.clientY - box.top) / box.height * state.view.size;
    const nextSize = Math.max(24, Math.min(side * 1.25, state.view.size * (event.deltaY < 0 ? .78 : 1.28)));
    state.view.x = x - (x - state.view.x) * nextSize / state.view.size;
    state.view.y = y - (y - state.view.y) * nextSize / state.view.size;
    state.view.size = nextSize;
    scheduleRedraw();
  }, {passive: false});
  svg.addEventListener('pointerdown', event => {
    drag = {x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, target: event.target};
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    const box = svg.getBoundingClientRect();
    state.view.x -= (event.clientX - drag.x) / box.width * state.view.size;
    state.view.y -= (event.clientY - drag.y) / box.height * state.view.size;
    drag.x = event.clientX; drag.y = event.clientY;
    updateViewBox();
  });
  svg.addEventListener('pointerup', event => {
    if (drag && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) activate(drag.target);
    drag = null;
  });
  svg.addEventListener('pointercancel', () => drag = null);
}

function openDialog(title, content) {
  $('#dialogTitle').textContent = title;
  $('#dialogContent').innerHTML = content;
  $('#dialogBackdrop').hidden = false;
  setTimeout(() => $('#dialogContent input, #dialogContent select')?.focus(), 30);
}
function closeDialog() { $('#dialogBackdrop').hidden = true; }
function personForm(person = {}, canDelete = false) {
  return `<form id="personForm"><div class="form-grid"><div class="field"><label>Nombre *</label><input name="first_name" value="${esc(person.first_name)}" required></div><div class="field"><label>Apellidos</label><input name="last_name" value="${esc(person.last_name)}"></div><div class="field full"><label>Notas o recuerdos</label><textarea name="notes">${esc(person.notes)}</textarea></div></div><div class="dialog-actions">${canDelete ? '<button type="button" class="delete-button" data-delete-person>Borrar miembro</button>' : ''}<button type="button" class="text-button" data-cancel>Cancelar</button><button class="primary">Guardar persona</button></div></form>`;
}

function bindPersonForm(id = null, afterSave = null, isTreeRoot = false) {
  $('#personForm').onsubmit = async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    if (!id) body.is_tree_root = isTreeRoot;
    try {
      const person = await api(id ? `/api/people/${id}` : '/api/people', {method: id ? 'PUT' : 'POST', body: JSON.stringify(body)});
      if (afterSave) await afterSave(person);
      state.focusId = isTreeRoot ? person.id : state.focusId;
      closeDialog(); toast('La persona se ha guardado'); await load(true);
    } catch (error) { toast(error.message); }
  };
  $('[data-cancel]').onclick = closeDialog;
  const deleteButton = $('[data-delete-person]');
  if (deleteButton) deleteButton.onclick = async () => {
    if (!confirm('¿Borrar este miembro del árbol? También se quitarán sus relaciones.')) return;
    try { await api(`/api/people/${id}`, {method: 'DELETE'}); closeDialog(); toast('Miembro borrado'); await load(true); }
    catch (error) { toast(error.message); }
  };
}

function newTree() { openDialog('Añadir un árbol familiar', personForm()); bindPersonForm(null, null, true); }
function openEditor(person) { openDialog(`Editar a ${fullName(person)}`, personForm(person, true)); bindPersonForm(person.id); }
function addAncestor(slot) {
  openDialog(`Añadir ${roleName(slot.role)} de ${fullName(slot.child)}`, personForm());
  bindPersonForm(null, async parent => api('/api/relationships', {method: 'POST', body: JSON.stringify({person_id: slot.child.id, relative_id: parent.id, relation_type: 'parent', parent_role: slot.role})}));
}

async function removeOuterLevel(slots, level) {
  const outer = slots.filter(slot => slot.level === level && slot.person);
  if (!confirm(`¿Quitar ${outer.length === 1 ? 'esta persona' : `las ${outer.length} personas`} de la generación exterior? Sus fichas se conservarán.`)) return;
  try {
    for (const slot of outer) {
      const relation = state.relationships.find(row => row.person_id === slot.child.id && row.relative_id === slot.person.id && row.relation_type === 'parent');
      if (relation) await api(`/api/relationships/${relation.id}`, {method: 'DELETE'});
    }
    toast('Generación exterior quitada'); await load(true);
  } catch (error) { toast(error.message); }
}

function toast(message) { const element = $('#toast'); element.textContent = message; element.hidden = false; clearTimeout(element.timer); element.timer = setTimeout(() => element.hidden = true, 2800); }
function setTheme(dark) {
  document.body.classList.toggle('dark', dark);
  $('#themeToggle').textContent = dark ? 'Modo claro' : 'Modo oscuro';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1b1f19' : '#426836';
  localStorage.setItem('arbol-theme', dark ? 'dark' : 'light');
  if (state.roots.length) drawTree();
}

const savedTheme = localStorage.getItem('arbol-theme');
setTheme(savedTheme ? savedTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
$('#themeToggle').onclick = () => setTheme(!document.body.classList.contains('dark'));
document.querySelectorAll('[data-action="new-person"]').forEach(button => button.onclick = newTree);
$('#focusPerson').onchange = event => { state.focusId = Number(event.target.value); state.view = null; render(); };
$('#deleteTreeButton').onclick = async () => {
  const root = personById(state.focusId);
  if (!confirm(`¿Borrar por completo el árbol de ${fullName(root)}? Se eliminarán esta persona y sus antepasados.`)) return;
  try { const result = await api(`/api/trees/${root.id}`, {method:'DELETE'}); state.focusId = null; state.view = null; toast(`Árbol borrado: ${result.deleted_people} personas eliminadas`); await load(true); }
  catch (error) { toast(error.message); }
};
$('#closeDialog').onclick = closeDialog;
$('#dialogBackdrop').onclick = event => { if (event.target.id === 'dialogBackdrop') closeDialog(); };
$('#helpButton').onclick = () => openDialog('Cómo construir el árbol', '<div class="help"><ol><li>Elige arriba el árbol que quieres consultar.</li><li>Pulsa un sector vacío para añadir el padre o la madre correspondiente.</li><li>Al añadir a un progenitor, aparecen sus propios padres.</li><li>Usa la rueda para ampliar hasta los niveles más profundos y arrastra para moverte.</li></ol><div class="dialog-actions"><button class="primary" data-cancel>Entendido</button></div></div>');
document.addEventListener('click', event => { if (event.target.matches('[data-cancel]')) closeDialog(); });
document.addEventListener('keydown', event => {
  if ($('#dialogBackdrop').hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); closeDialog(); }
  if (event.key === 'Enter') { const form = $('#dialogContent form'); if (form) { event.preventDefault(); form.requestSubmit(); } }
});
load(true).catch(error => toast(error.message));
