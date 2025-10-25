// --- CONFIGURATION ---
const classList = [
    '0+1 jets vbf - vbf (201-202)',
    '0 jets ggh - ggh (105-106)',
    '1 jets ggh - ggh (107-109)',
    '2p jets high mjj - ggh (113-116)',
    '2p jets high mjj high ptH vbf (206)',
    '2p jets high mjj low ptH high ptHjj vbf - vbf (209-210)',
    '2p jets high mjj low ptH low ptHjj vbf - vbf (207-208)',
    '2p jets low mjj - ggh (110-112)',
    '2p jets low mjj - vbf (203-205)',
    'background (all)',
    'diboson',
    'dyjets',
    'embedding',
    'ggh (105)',
    'ggh (106)',
    'ggh (107)',
    'ggh (108)',
    'ggh (109)',
    'ggh (all)',
    'high ptH ggh - ggh (101-104)',
    'jetFakes',
    'signal (all)',
    'ttbar',
    'vbf (all)',
    'all (binary)',
];

const scalingList = [
    "m10_to_m10__Multiclass__Sigmoid",
    "m10_to_m10__Multiclass__Softmax",
    "m10_to_NaN__Multiclass__Sigmoid",
    "m10_to_NaN__Multiclass__Softmax",
    "m10_to_m10__Binary__Sigmoid",
    "m10_to_NaN__Binary__Sigmoid",
];
const modeList = ["TP", "all"];

// Color classes from style.css for aggregate highlighting
const HIGHLIGHT_COLORS = [
    'highlight-color-0', 'highlight-color-1', 'highlight-color-2',
    'highlight-color-3', 'highlight-color-4', 'highlight-color-5',
    'highlight-color-6', 'highlight-color-7', 'highlight-color-8',
    'highlight-color-9', 'highlight-color-10', 'highlight-color-11'
];

// --- APPLICATION STATE ---
let columnsState = {};
let nextColumnId = 0;
let highlightedVars = new Map();
let globalMaxValue = 0;

// --- HELPER FUNCTIONS ---

function escapeJS(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function filterScalingForClass(className, scaling) {
    if (className.includes('(binary)')) {
        return scaling.includes('Binary');
    } else {
        return scaling.includes('Multiclass');
    }
}

function getFolderStructure() {
    const structure = {};
    classList.forEach(c => {
        structure[c] = {};
        scalingList.forEach(s => {
            if (filterScalingForClass(c, s)) {
                structure[c][s] = modeList;
            }
        });
    });
    return structure;
}

function buildNestedMenu(columnId) {
    const structure = getFolderStructure();
    return `<ul class="menu-level-1">
        ${Object.keys(structure).map(c => {
            return `<li><span title="${c}">${c}</span>
                <ul class="menu-level-2">
                    ${Object.keys(structure[c]).map(s => {
                        return `<li><span title="${s}">${s}</span>
                            <ul class="menu-level-3">
                                ${structure[c][s].map(m => {
                                    return `<li><span title="${m}">${m}</span>
                                        <ul class="menu-level-4">
                                            <li title="${c}/${s}/${m}/${c}.csv" onclick="selectConfig('${columnId}', '${escapeJS(c)}', '${escapeJS(s)}', '${escapeJS(m)}')">${c}.csv</li>
                                        </ul>
                                    </li>`;
                                }).join('')}
                            </ul>
                        </li>`;
                    }).join('')}
                </ul>
            </li>`;
        }).join('')}
    </ul>`;
}

function toggleMenu(button, level = 1) {
    const dropdown = button.nextElementSibling;
    const isOpen = dropdown.style.display === 'block';
    if (isOpen) {
        closeAllMenus(button.closest('.nested-dropdown'));
    } else {
        closeAllMenus(button.closest('.nested-dropdown'));
        const rect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${rect.bottom}px`;
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.display = 'block';
    }
}

function toggleSubMenu(span, level) {
    const li = span.parentElement;
    const submenu = li.querySelector(`.menu-level-${level + 1}`);
    if (!submenu) return;
    const isActive = li.classList.contains('active');
    closeAllSubMenus(li.closest(`.menu-level-${level}`));
    if (!isActive) {
        const rect = span.getBoundingClientRect();
        submenu.style.position = 'fixed';
        submenu.style.top = `${rect.top}px`;
        submenu.style.left = `${rect.right + 5}px`; // Small offset for clarity
        submenu.style.display = 'block';
        li.classList.add('active');
        // Adjust position to stay within viewport
        const submenuRect = submenu.getBoundingClientRect();
        if (submenuRect.right > window.innerWidth) {
            submenu.style.left = `${rect.left - submenuRect.width - 5}px`;
        }
        if (submenuRect.bottom > window.innerHeight) {
            submenu.style.top = `${window.innerHeight - submenuRect.height}px`;
        }
    }
}

function closeAllMenus(nestedDropdown) {
    nestedDropdown.querySelectorAll('.dropdown-content, .menu-level-2, .menu-level-3, .menu-level-4').forEach(menu => {
        menu.style.display = 'none';
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
    });
    nestedDropdown.querySelectorAll('li.active').forEach(li => li.classList.remove('active'));
}

function closeAllSubMenus(menu) {
    menu.querySelectorAll('li.active').forEach(li => {
        li.classList.remove('active');
        const submenu = li.querySelector('ul');
        if (submenu) {
            submenu.style.display = 'none';
            submenu.style.position = '';
            submenu.style.top = '';
            submenu.style.left = '';
        }
    });
}

// --- CORE LOGIC ---

function recalculateAndRedrawAll() {
    let maxVal = 0;
    Object.values(columnsState).forEach(state => {
        if (state.data && state.data.length > 1) {
            const lastColIndex = state.data[0].length - 1;
            for (let i = 1; i < state.data.length; i++) {
                const numericValue = parseFloat(state.data[i][lastColIndex]);
                if (!isNaN(numericValue)) {
                    maxVal = Math.max(maxVal, numericValue);
                }
            }
        }
    });
    globalMaxValue = maxVal;

    Object.keys(columnsState).forEach(columnId => {
        if (columnsState[columnId].className && columnsState[columnId].scaling && columnsState[columnId].mode) {
            renderTable(columnId);
        }
    });
}

async function loadDataForColumn(className, scaling, mode, columnId) {
    try {
        const path = `data/${encodeURIComponent(className)}/${encodeURIComponent(scaling)}/${encodeURIComponent(mode)}/${encodeURIComponent(className)}.csv`;
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const text = await response.text();
        const rows = text.split('\n').filter(line => line.trim() !== '').map(row => row.split(','));
        columnsState[columnId].data = rows;
    } catch (error) {
        console.error(`Error loading data for ${className}/${scaling}/${mode}:`, error);
        columnsState[columnId].data = [];
    }
}

// --- UI-TRIGGERED FUNCTIONS ---

function handleAggregateToggle(isChecked) {
    if (!isChecked) clearHighlights();
}

function addColumn() {
    const columnId = `col-${nextColumnId++}`;
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.columnId = columnId;
    columnEl.innerHTML = `
        <div class="column-header">
            <input type="text" class="custom-header" placeholder="Custom label" oninput="onCustomHeader(this.value, '${columnId}')">
            <div class="select-container">
                <div class="nested-dropdown">
                    <button class="dropbtn">Select Configuration</button>
                    <div class="dropdown-content">
                        ${buildNestedMenu(columnId)}
                    </div>
                </div>
            </div>
            <button class="close-btn" onclick="closeColumn('${columnId}')">&times;</button>
        </div>
        <div class="table-container"></div>`;
    document.getElementById('columns-container').appendChild(columnEl);
    columnsState[columnId] = { className: null, scaling: null, mode: null, customHeader: '', data: [], sort: {} };
    const button = columnEl.querySelector('.dropbtn');
    button.addEventListener('click', () => toggleMenu(button));
    const spans = columnEl.querySelectorAll('.menu-level-1 > li > span, .menu-level-2 > li > span, .menu-level-3 > li > span');
    spans.forEach(span => {
        span.addEventListener('click', (e) => {
            e.stopPropagation();
            const level = parseInt(span.closest('ul').className.match(/menu-level-(\d)/)[1]);
            toggleSubMenu(span, level);
        });
    });
}

function onCustomHeader(value, columnId) {
    columnsState[columnId].customHeader = value;
}

function selectConfig(columnId, className, scaling, mode) {
    columnsState[columnId].className = className;
    columnsState[columnId].scaling = scaling;
    columnsState[columnId].mode = mode;
    const button = document.querySelector(`.column[data-column-id='${columnId}'] .dropbtn`);
    button.textContent = className;
    button.title = `${className}/${scaling}/${mode}`;
    closeAllMenus(button.closest('.nested-dropdown'));
    tryLoadData(columnId);
}

async function tryLoadData(columnId) {
    const state = columnsState[columnId];
    const { className, scaling, mode } = state;
    if (className && scaling && mode) {
        await loadDataForColumn(className, scaling, mode, columnId);
        if (state.data && state.data.length > 1) {
            const lastColIndex = state.data[0].length - 1;
            state.sort = { by: lastColIndex, order: 'desc' };
        }
        recalculateAndRedrawAll();
    } else {
        state.data = [];
        renderTable(columnId);
    }
}

function closeColumn(columnId) {
    const columnEl = document.querySelector(`.column[data-column-id='${columnId}']`);
    if (columnEl) {
        columnEl.remove();
        delete columnsState[columnId];
        recalculateAndRedrawAll();
    }
}

// --- RENDERING & SORTING ---

async function renderTable(columnId) {
    const { data, sort } = columnsState[columnId];
    const container = document.querySelector(`.column[data-column-id='${columnId}'] .table-container`);
    if (!data || data.length < 2) {
        container.innerHTML = '';
        return;
    }
    const header = data[0];
    let bodyRows = [...data.slice(1)];

    if (sort && sort.by !== undefined) {
        bodyRows.sort((a, b) => {
            let valA = a[sort.by] || ''; let valB = b[sort.by] || '';
            const numA = parseFloat(valA); const numB = parseFloat(valB);
            if (!isNaN(numA) && !isNaN(numB)) { valA = numA; valB = numB; }
            if (valA < valB) return sort.order === 'asc' ? -1 : 1;
            if (valA > valB) return sort.order === 'asc' ? 1 : -1;
            return 0;
        });
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    const headerRow = document.createElement('tr');
    header.forEach((h, i) => {
        const th = document.createElement('th');
        if (h.startsWith('$') && h.endsWith('$')) th.innerHTML = h;
        else th.textContent = h;
        th.onclick = () => sortColumn(columnId, i);
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    bodyRows.forEach((rowContent) => {
        const tr = document.createElement('tr');
        tr.dataset.rowId = rowContent.join('-').replace(/\s/g, '_');
        rowContent.forEach((cell, cellIndex) => {
            const td = document.createElement('td');
            if (cellIndex === header.length - 1) {
                td.classList.add('value-cell');
                const numericValue = parseFloat(cell);
                if (!isNaN(numericValue)) {
                    const widthPercentage = globalMaxValue > 0 ? (numericValue / globalMaxValue) * 100 : 0;
                    td.innerHTML = `
                        <div class="bar-container">
                            <div class="bar-plot" style="width: ${widthPercentage}%;"></div>
                            <span class="bar-text">${formatScientific(numericValue)}</span>
                        </div>`;
                } else {
                    td.textContent = cell;
                }
            } else {
                td.dataset.rawValue = cell;
                if (cell.startsWith('$') && cell.endsWith('$')) td.innerHTML = cell;
                else td.textContent = cell;

                if (cellIndex < 3 && cell.trim() !== '') {
                    td.style.cursor = 'pointer';
                    td.onclick = (e) => {
                        e.stopPropagation();
                        const rawValue = e.currentTarget.dataset.rawValue;
                        const variableToHighlight = rawValue.replace(/^\$\(|\)$/g, '').replace(/^\$|\$$/g, '');
                        highlightVariable(variableToHighlight);
                    };
                }
            }
            tr.appendChild(td);
        });
        tr.onclick = (e) => {
            if (!e.target.closest('td[style*="cursor: pointer;"]')) {
                highlightRow(tr.dataset.rowId);
            }
        };
        tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);

    reapplyAllHighlights();

    if (typeof MathJax !== 'undefined' && MathJax.startup) {
        await MathJax.startup.promise;
        await MathJax.typesetPromise([container]);
    }
}

function sortColumn(columnId, sortBy) {
    const currentSort = columnsState[columnId].sort || {};
    let order = 'asc';
    if (currentSort.by === sortBy && currentSort.order === 'asc') order = 'desc';
    columnsState[columnId].sort = { by: sortBy, order };
    renderTable(columnId);
}

// --- HIGHLIGHTING & PERMALINK ---

function formatScientific(value) {
    if (value === 0) return "0.00";
    if (isNaN(value)) return "";
    const [mantissa, exponent] = value.toExponential(2).split('e');
    return `${mantissa} &times; 10<sup>${exponent}</sup>`;
}

function clearHighlights() {
    document.querySelectorAll('td').forEach(cell => {
        cell.className = cell.className.replace(/\bhighlight-color-\d+\b/g, '').trim();
        cell.classList.remove('highlight-row');
    });
    highlightedVars.clear();
}

function highlightVariable(variableToMatch) {
    const isAggregate = document.getElementById('aggregate-checkbox').checked;
    const performHighlight = (variable, shouldAdd) => {
        document.querySelectorAll('td[data-raw-value]').forEach(td => {
            const rawValue = td.dataset.rawValue;
            const storedVariable = rawValue.replace(/^\$\(|\)$/g, '').replace(/^\$|\$$/g, '');
            if (storedVariable === variable) {
                if (shouldAdd) {
                    const colorIndex = highlightedVars.get(variable);
                    td.classList.add(HIGHLIGHT_COLORS[colorIndex]);
                } else {
                    highlightedVars.forEach((colorIndex, key) => {
                        if (key === variable) {
                            td.classList.remove(HIGHLIGHT_COLORS[colorIndex]);
                        }
                    });
                }
            }
        });
    };

    if (isAggregate) {
        if (highlightedVars.has(variableToMatch)) {
            performHighlight(variableToMatch, false);
            highlightedVars.delete(variableToMatch);
        } else {
            const nextColorIndex = highlightedVars.size % HIGHLIGHT_COLORS.length;
            highlightedVars.set(variableToMatch, nextColorIndex);
            performHighlight(variableToMatch, true);
        }
    } else {
        clearHighlights();
        highlightedVars.set(variableToMatch, 0);
        performHighlight(variableToMatch, true);
    }
}

function reapplyAllHighlights() {
    if (highlightedVars.size === 0) return;
    highlightedVars.forEach((colorIndex, variable) => {
        const className = HIGHLIGHT_COLORS[colorIndex];
        document.querySelectorAll('td[data-raw-value]').forEach(td => {
            const rawValue = td.dataset.rawValue;
            const storedVariable = rawValue.replace(/^\$\(|\)$/g, '').replace(/^\$|\$$/g, '');
            if (storedVariable === variable) {
                td.classList.add(className);
            }
        });
    });
}

function highlightRow(rowId) {
    clearHighlights();
    document.querySelectorAll(`tr[data-row-id='${rowId}']`).forEach(tr => {
        tr.classList.add('highlight-row');
    });
}

function generatePermalink() {
    const aggregateChecked = document.getElementById('aggregate-checkbox').checked;
    const highlights = Array.from(highlightedVars.entries());
    const columns = Object.values(columnsState).map(state => ({
        className: state.className,
        scaling: state.scaling,
        mode: state.mode,
        customHeader: state.customHeader,
        sort: state.sort
    })).filter(c => c.className && c.scaling && c.mode);

    const state = { aggregateChecked, highlights, columns };
    const hash = btoa(JSON.stringify(state));
    window.location.hash = hash;
    alert('Permalink created! Copy the URL from your address bar.');
}

async function loadFromPermalink() {
    if (!window.location.hash || window.location.hash.length < 2) return;
    try {
        const hash = window.location.hash.substring(1);
        const state = JSON.parse(atob(hash));
        
        if (state.aggregateChecked) {
            document.getElementById('aggregate-checkbox').checked = true;
        }

        if (state.highlights && Array.isArray(state.highlights)) {
            highlightedVars = new Map(state.highlights);
        }

        if (state.columns && Array.isArray(state.columns)) {
            const loadPromises = state.columns.map(colState => {
                const columnId = `col-${nextColumnId++}`;
                const columnEl = document.createElement('div');
                columnEl.className = 'column';
                columnEl.dataset.columnId = columnId;
                columnEl.innerHTML = `
                    <div class="column-header">
                        <input type="text" class="custom-header" placeholder="Custom label" value="${colState.customHeader || ''}" oninput="onCustomHeader(this.value, '${columnId}')">
                        <div class="select-container">
                            <div class="nested-dropdown">
                                <button class="dropbtn">Select Configuration</button>
                                <div class="dropdown-content">
                                    ${buildNestedMenu(columnId)}
                                </div>
                            </div>
                        </div>
                        <button class="close-btn" onclick="closeColumn('${columnId}')">&times;</button>
                    </div>
                    <div class="table-container"></div>`;
                document.getElementById('columns-container').appendChild(columnEl);
                
                columnsState[columnId] = { 
                    className: colState.className, 
                    scaling: colState.scaling, 
                    mode: colState.mode, 
                    customHeader: colState.customHeader || '', 
                    data: [], 
                    sort: colState.sort || {} 
                };
                
                const button = columnEl.querySelector('.dropbtn');
                button.addEventListener('click', () => toggleMenu(button));
                const spans = columnEl.querySelectorAll('.menu-level-1 > li > span, .menu-level-2 > li > span, .menu-level-3 > li > span');
                spans.forEach(span => {
                    span.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const level = parseInt(span.closest('ul').className.match(/menu-level-(\d)/)[1]);
                        toggleSubMenu(span, level);
                    });
                });

                if (colState.className && colState.scaling && colState.mode) {
                    button.textContent = colState.className;
                    button.title = `${colState.className}/${colState.scaling}/${colState.mode}`;
                }
                
                return tryLoadData(columnId);
            });

            await Promise.all(loadPromises);
        }
    } catch (e) {
        console.error("Fatal error loading from permalink:", e);
        window.location.hash = '';
    }
}

// --- INITIALIZATION ---
window.onload = loadFromPermalink;
