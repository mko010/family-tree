const state = {people: [], relationships: [], roots: [], focusId: null, view: null, treeSide: 0, rotation: 0};
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
function abbreviate(text, chars, preferFirstName = false) {
  if (text.length <= chars) return text;
  if (preferFirstName) {
    const firstName = text.trim().split(/\s+/)[0] || text;
    if (firstName.length < chars) return `${firstName}…`;
    if (firstName.length === chars) return firstName;
    return `${firstName.slice(0, Math.max(1, chars - 1)).trimEnd()}…`;
  }
  return `${text.slice(0, Math.max(1, chars - 1)).trimEnd()}…`;
}

function towardCenterRotation(angle) {
  // SVG text begins at its left edge. Adding 180° makes its reading axis
  // point from the outer ring toward the centre of the tree. In the lower
  // right quadrant that direction would turn the glyphs upside down, so use
  // the opposite radial direction there to preserve readable text.
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized > 0 && normalized < 90 || normalized > 270) return angle;
  return angle + 180;
}

function tangentRotation(angle) {
  let rotation = ((angle + 90 + 540) % 360) - 180;
  if (rotation > 90) rotation -= 180;
  if (rotation < -90) rotation += 180;
  return rotation;
}

function labelSvg(x, y, label, subtitle, available, crossAvailable, visibleScale, root = false, angle = null, radial = false, preferFirstName = false) {
  const availablePixels = available * visibleScale;
  if (!root && availablePixels < 38) return '';
  const allowed = Math.max(root ? 8 : 5, Math.floor(availablePixels / (root ? 8 : 7)));
  const shown = abbreviate(label, allowed, preferFirstName);
  const words = shown.split(' ');
  const lines = shown.length > Math.min(18, allowed) && words.length > 1
    ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
    : [shown];
  const longest = Math.max(...lines.map(line => line.length));
  // At deep levels the available SVG arc is tiny.  The font must be allowed
  // to be tiny in SVG units so that it becomes readable only after zooming.
  const size = Math.max(root ? 5 : .25, Math.min(root ? 16 : 15, available / Math.max(1, longest) / .58, crossAvailable / (lines.length * 1.45)));
  const start = y - (lines.length === 2 ? size * .58 : size * .18);
  const subtitleY = y + (lines.length === 2 ? size * 1.65 : size * 1.05);
  const subtitleSize = Math.max(.18, Math.min(12, size * .72));
  const transform = angle === null ? '' : ` transform="rotate(${radial ? towardCenterRotation(angle) : tangentRotation(angle)} ${x} ${y})"`;
  const cap = available * .88;
  return `<text x="${x}" y="${start}"${transform} class="${root ? 'root-name' : 'sector-name'}" style="font-size:${size}px">${lines.map((line, index) => { const natural = line.length * size * .58; const fit = natural > cap ? ` textLength="${cap}" lengthAdjust="spacingAndGlyphs"` : ''; return `<tspan x="${x}" dy="${index ? size * 1.03 : 0}"${fit}>${esc(line)}</tspan>`; }).join('')}</text>${subtitle && availablePixels > 96 ? `<text x="${x}" y="${subtitleY}"${transform} class="sector-sub" style="font-size:${subtitleSize}px">${esc(subtitle)}</text>` : ''}`;
}

function curvedLabelSvg(id, cx, cy, radius, start, end, label, available, visibleScale, paths, preferFirstName = false) {
  const availablePixels = available * visibleScale;
  if (availablePixels < 42) return '';
  const shown = abbreviate(label, Math.max(5, Math.floor(availablePixels / 7)), preferFirstName);
  const size = Math.max(.35, Math.min(15, available / Math.max(1, shown.length) / .58));
  const cap = available * .84;
  const middle = ((start + end) / 2 + 360) % 360;
  // Keep labels readable in every quadrant. The top-right arc needs the
  // same reversed path direction as the lower semicircle.
  const reverse = middle < 180;
  const pathStart = reverse ? end : start, pathEnd = reverse ? start : end, sweep = reverse ? 0 : 1;
  const [x1, y1] = polar(cx, cy, radius, pathStart), [x2, y2] = polar(cx, cy, radius, pathEnd);
  paths.push(`<path id="${id}" d="M${x1},${y1} A${radius},${radius} 0 0 ${sweep} ${x2},${y2}"/>`);
  const natural = shown.length * size * .58;
  const fit = natural > cap ? ` textLength="${cap}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text class="sector-name" style="font-size:${size}px"><textPath href="#${id}" startOffset="50%" text-anchor="middle"${fit}>${esc(shown)}</textPath></text>`;
}

function resetView(view, rootId) {
  state.view = {...view, rootId};
}

function generalViewFor(slots, cx, cy, centerRadius, step) {
  let minX = cx - centerRadius, maxX = cx + centerRadius, minY = cy - centerRadius, maxY = cy + centerRadius;
  for (const slot of slots.filter(item => item.level)) {
    const count = 2 ** slot.level, index = parseInt(slot.path, 2), span = 360 / count;
    const start = -180 + index * span + state.rotation, end = start + span;
    const outer = centerRadius + slot.level * step - 4;
    const angles = [start, end, -180, -90, 0, 90, 180].filter(angle => angle >= start && angle <= end);
    angles.forEach(angle => {
      const [x, y] = polar(cx, cy, outer, angle);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
  }
  const padding = 24, size = Math.max(maxX - minX, maxY - minY) + padding * 2;
  return {x: (minX + maxX - size) / 2, y: (minY + maxY - size) / 2, size};
}

function drawTree() {
  const root = personById(state.focusId), slots = slotsFor(root);
  const levels = Math.max(...slots.map(slot => slot.level));
  const centerRadius = 72, step = 115, outer = centerRadius + levels * step;
  const side = Math.max(760, outer * 2 + 160), cx = side / 2, cy = side / 2;
  const generalView = generalViewFor(slots, cx, cy, centerRadius, step);
  if (!state.view || state.view.rootId !== root.id) resetView(generalView, root.id);
  state.treeSide = side;
  const dark = document.body.classList.contains('dark');
  const palette = dark
    ? ['#355b2d','#416b36','#27626b','#355a85','#58477a','#75466f','#805438','#7a672a','#475f38','#375f57','#514f7c','#734f52']
    : ['#c2efae','#bde8c4','#b7e9e8','#c7dcff','#ded2ff','#f2cef0','#ffd7b6','#f5e59e','#d6e9b6','#bfe5dc','#d5d2ff','#f1cbd1'];
  const emptyFill = dark ? '#2a3228' : '#f1f3ee';
  const visualScale = ($('#tree')?.clientWidth || 900) / state.view.size;
  const curvePaths = [];
  const sectors = slots.filter(slot => slot.level).map(slot => {
    const count = 2 ** slot.level, index = parseInt(slot.path, 2), span = 360 / count;
    const start = -180 + index * span + state.rotation, end = start + span;
    const inner = centerRadius + (slot.level - 1) * step + 4, outerRadius = inner + step - 8;
    const middleAngle = (start + end) / 2, mean = (inner + outerRadius) / 2, [x, y] = polar(cx, cy, mean, middleAngle);
    const arcAvailable = Math.max(2, mean * (span * Math.PI / 180) * .85);
    const radial = slot.level >= 7;
    const available = radial ? (outerRadius - inner) * .78 : arcAvailable;
    const crossAvailable = radial ? arcAvailable : (outerRadius - inner) * .78;
    const label = slot.person ? fullName(slot.person) : `Añadir ${roleName(slot.role)}`;
    const sub = slot.person ? years(slot.person) : 'Pulsa aquí';
    const text = radial
      ? labelSvg(x, y, label, sub, available, crossAvailable, visualScale, false, middleAngle, true, Boolean(slot.person))
      : curvedLabelSvg(`curve-${slot.path || 'root'}`, cx, cy, mean, start + 4, end - 4, label, available, visualScale, curvePaths, Boolean(slot.person));
    return `<g class="sector ${slot.person ? 'filled' : 'empty'}" data-path="${slot.path}"><path d="${wedge(cx, cy, inner, outerRadius, start, end)}" fill="${slot.person ? palette[Math.min(slot.level - 1, palette.length - 1)] : emptyFill}"/>${text}</g>`;
  }).join('');
  const view = state.view;
  $('#tree').innerHTML = `<div class="zoom-hint">Rueda: ampliar · Arrastrar: mover · Shift + arrastrar: girar</div><div class="tree-view-controls"><button id="rotateLeft" class="zoom-reset" aria-label="Girar a la izquierda">↺ Girar</button><button id="resetZoom" class="zoom-reset">Vista completa</button><button id="rotateRight" class="zoom-reset" aria-label="Girar a la derecha">Girar ↻</button></div><svg id="treeSvg" data-general-view="${generalView.x} ${generalView.y} ${generalView.size} ${generalView.size}" viewBox="${view.x} ${view.y} ${view.size} ${view.size}" aria-label="Árbol circular de antepasados"><defs>${curvePaths.join('')}</defs><g>${sectors}<g class="root-node"><circle cx="${cx}" cy="${cy}" r="${centerRadius}"/>${labelSvg(cx, cy, fullName(root), years(root), centerRadius * 1.7, centerRadius * 1.7, visualScale, true, null, false, true)}</g></g></svg>`;
  const activate = element => {
    const sector = element.closest('.sector');
    if (sector) {
      const slot = slots.find(item => item.path === sector.dataset.path);
      if (slot.person) openEditor(slot.person); else addAncestor(slot);
    } else if (element.closest('.root-node')) openEditor(root);
  };
  $('#resetZoom').onclick = () => { resetView(generalView, root.id); drawTree(); };
  $('#rotateLeft').onclick = () => { state.rotation -= 15; drawTree(); };
  $('#rotateRight').onclick = () => { state.rotation += 15; drawTree(); };
  bindViewport(activate, generalView.size);
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
    const wheelFactor = Math.min(1.07, Math.max(.94, Math.exp(event.deltaY * .001)));
    const nextSize = Math.max(24, Math.min(side * 1.25, state.view.size * wheelFactor));
    state.view.x = x - (x - state.view.x) * nextSize / state.view.size;
    state.view.y = y - (y - state.view.y) * nextSize / state.view.size;
    state.view.size = nextSize;
    scheduleRedraw();
  }, {passive: false});
  svg.addEventListener('pointerdown', event => {
    drag = {x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, target: event.target, rotating: event.shiftKey};
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    if (drag.rotating) {
      state.rotation += (event.clientX - drag.x) * .35;
      drag.x = event.clientX; drag.y = event.clientY;
      scheduleRedraw();
      return;
    }
    const box = svg.getBoundingClientRect();
    state.view.x -= (event.clientX - drag.x) / box.width * state.view.size;
    state.view.y -= (event.clientY - drag.y) / box.height * state.view.size;
    drag.x = event.clientX; drag.y = event.clientY;
    updateViewBox();
  });
  svg.addEventListener('pointerup', event => {
    if (drag && !drag.rotating && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) activate(drag.target);
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
      closeDialog(); toast('La persona se ha guardado'); await load(isTreeRoot);
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
function exportTreeSvg() {
  const source = $('#treeSvg');
  if (!source) return;
  const copy = source.cloneNode(true), dark = document.body.classList.contains('dark');
  copy.querySelectorAll('.sector.empty').forEach(sector => sector.remove());
  const view = source.dataset.generalView;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('viewBox', view);
  copy.setAttribute('width', '1800'); copy.setAttribute('height', '1800');
  const [x, y, width, height] = view.split(' ');
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('x', x); background.setAttribute('y', y); background.setAttribute('width', width); background.setAttribute('height', height); background.setAttribute('fill', dark ? '#11140f' : '#fbfdf6');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `.sector path{stroke:${dark ? '#54624e' : '#ffffff'};stroke-width:3;vector-effect:non-scaling-stroke}.sector.empty path{stroke-dasharray:6 4}.sector-name{font-family:Arial,sans-serif;font-weight:700;fill:${dark ? '#e0e5da' : '#263426'};text-anchor:middle}.sector-sub{font-family:Arial,sans-serif;fill:${dark ? '#e0e5da' : '#536052'};text-anchor:middle}.root-node circle{fill:#426836;stroke:#fff;stroke-width:5;vector-effect:non-scaling-stroke}.root-node text{font-family:Arial,sans-serif;font-weight:700;fill:#fff;text-anchor:middle}`;
  copy.insertBefore(style, copy.firstChild); copy.insertBefore(background, copy.firstChild);
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], {type: 'image/svg+xml;charset=utf-8'});
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = `arbol-${fullName(personById(state.focusId)).replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'familiar'}.svg`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  toast('Árbol exportado en formato SVG');
}
function setTheme(dark) {
  document.body.classList.toggle('dark', dark);
  $('#themeToggle').textContent = dark ? 'Modo claro' : 'Modo oscuro';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1b1f19' : '#426836';
  localStorage.setItem('arbol-theme', dark ? 'dark' : 'light');
  if (state.roots.length) drawTree();
}

const savedTheme = localStorage.getItem('arbol-theme');
setTheme(savedTheme ? savedTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
function keepLocalAppAlive() { fetch('/api/heartbeat', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}).catch(() => {}); }
keepLocalAppAlive();
setInterval(keepLocalAppAlive, 3000);
$('#themeToggle').onclick = () => setTheme(!document.body.classList.contains('dark'));
document.querySelectorAll('[data-action="new-person"]').forEach(button => button.onclick = newTree);
$('#exportTreeButton').onclick = exportTreeSvg;
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
