let folderStructure = {};
let isFolderStructureLoaded = false;

async function initFolderStructure() {
    try {
        const response = await fetch('folder_structure.json');
        if (!response.ok) throw new Error(`Failed to load folder structure: ${response.status}`);
        folderStructure = await response.json();
        if (Object.keys(folderStructure).length === 0) {
            throw new Error('Folder structure is empty');
        }
        isFolderStructureLoaded = true;
        document.getElementById('add-column-btn').disabled = false;
        console.log('Folder structure loaded:', folderStructure);
    } catch (error) {
        console.error('Error loading folder structure:', error);
        alert('Failed to load folder structure. Please check folder_structure.json.');
        isFolderStructureLoaded = false;
        document.getElementById('add-column-btn').disabled = true;
    }
}

const HIGHLIGHT_COLORS = [
    'highlight-color-0', 'highlight-color-1', 'highlight-color-2',
    'highlight-color-3', 'highlight-color-4', 'highlight-color-5',
    'highlight-color-6', 'highlight-color-7', 'highlight-color-8',
    'highlight-color-9', 'highlight-color-10', 'highlight-color-11'
];

let columnsState = {};
let nextColumnId = 0;
let highlightedVars = new Map();
let globalMaxValue = 0;

function escapeJS(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function getFolderStructure() {
    return folderStructure;
}

async function buildNestedMenu(columnId) {
    if (!isFolderStructureLoaded) {
        console.warn('Folder structure not loaded yet');
        return '<ul><li>Folder structure not loaded</li></ul>';
    }
    const structure = getFolderStructure();
    const menuHtml = buildMenu(structure, columnId);
    console.log('Generated menu HTML:', menuHtml);
    return menuHtml;
}

function buildMenu(node, columnId, path = []) {
    if (Array.isArray(node)) {
        console.log('Building menu for files:', node, 'at path:', path);
        return `<ul>
            ${node.map(file => {
                const fullPath = path.join('/');
                return `<li title="${fullPath}/${file}" onclick="selectConfig('${columnId}', '${escapeJS(fullPath)}', '${escapeJS(file)}')">${file}</li>`;
            }).join('')}
        </ul>`;
    } else if (node && node.files && Array.isArray(node.files)) {
        console.log('Building menu for files key:', node.files, 'at path:', path);
        return `<ul>
            ${node.files.map(file => {
                const fullPath = path.join('/');
                return `<li title="${fullPath}/${file}" onclick="selectConfig('${columnId}', '${escapeJS(fullPath)}', '${escapeJS(file)}')">${file}</li>`;
            }).join('')}
        </ul>`;
    } else {
        return `<ul>
            ${Object.keys(node).map(key => {
                if (key === 'files') return ''; // Skip files here, handled above
                const newPath = [...path, key];
                // Handle incorrect JSON structure with CSV as key
                if (Array.isArray(node[key]) && node[key].length > 0 && node[key][0].endsWith('.csv')) {
                    console.log('Building menu for CSV key:', key, 'files:', node[key], 'at path:', path);
                    return `<ul>
                        ${node[key].map(file => {
                            const fullPath = path.join('/');
                            return `<li title="${fullPath}/${file}" onclick="selectConfig('${columnId}', '${escapeJS(fullPath)}', '${escapeJS(file)}')">${file}</li>`;
                        }).join('')}
                    </ul>`;
                }
                return `<li><span title="${key}">${key}</span>
                    ${buildMenu(node[key], columnId, newPath)}
                </li>`;
            }).join('')}
        </ul>`;
    }
}

function toggleMenu(button, event) {
    event.stopPropagation();
    const dropdown = button.nextElementSibling;
    const isOpen = dropdown.style.display === 'block';
    document.querySelectorAll('.nested-dropdown').forEach(nestedDropdown => {
        closeAllMenus(nestedDropdown);
    });
    if (!isOpen) {
        const rect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${rect.bottom + window.scrollY}px`;
        dropdown.style.left = `${rect.left + window.scrollX}px`;
        dropdown.style.display = 'block';
        dropdown.style.backgroundColor = '#fff';
        dropdown.style.zIndex = '10000';
        dropdown.querySelector('ul').style.display = 'block';
        console.log('Dropdown opened at top:', dropdown.style.top, 'left:', dropdown.style.left);
        console.log('Dropdown content:', dropdown.innerHTML);
    }
}

function toggleSubMenu(span, event) {
    event.stopPropagation();
    const li = span.parentElement;
    const submenu = li.querySelector('ul');
    if (!submenu) return;
    const isOpen = li.classList.contains('open');
    closeAllSubMenus(li.closest('ul'));
    if (!isOpen) {
        const rect = span.getBoundingClientRect();
        submenu.style.position = 'fixed';
        submenu.style.top = `${rect.top + window.scrollY}px`;
        submenu.style.left = `${rect.right + 5 + window.scrollX}px`;
        submenu.style.display = 'block';
        submenu.style.zIndex = '10001';
        li.classList.add('open');
        const submenuRect = submenu.getBoundingClientRect();
        if (submenuRect.right > window.innerWidth) {
            submenu.style.left = `${rect.left - submenuRect.width - 5 + window.scrollX}px`;
        }
        if (submenuRect.bottom > window.innerHeight) {
            submenu.style.top = `${window.innerHeight - submenuRect.height + window.scrollY}px`;
        }
        console.log('Submenu opened at top:', submenu.style.top, 'left:', submenu.style.left);
    }
}

function closeAllMenus(nestedDropdown) {
    nestedDropdown.querySelectorAll('.dropdown-content, .dropdown-content ul').forEach(menu => {
        menu.style.display = 'none';
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
    });
    nestedDropdown.querySelectorAll('li.open').forEach(li => li.classList.remove('open'));
}

function closeAllSubMenus(menu) {
    menu.querySelectorAll('li.open').forEach(li => {
        li.classList.remove('open');
        const submenu = li.querySelector('ul');
        if (submenu) {
            submenu.style.display = 'none';
            submenu.style.position = '';
            submenu.style.top = '';
            submenu.style.left = '';
        }
    });
}

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
        if (columnsState[columnId].fullPath) {
            renderTable(columnId);
        }
    });
}

async function loadDataForColumn(fullPath, csvFile, columnId) {
    const container = document.querySelector(`.column[data-column-id='${columnId}'] .table-container`);
    const baseUrl = 'data/';
    const attempts = [
        // Primary path with encoding
        `${baseUrl}${encodeURIComponent(fullPath)}/${encodeURIComponent(csvFile)}`,
        // Raw path without encoding
        `${baseUrl}${fullPath}/${csvFile}`,
        // Path without deepest directory
        `${baseUrl}${encodeURIComponent(fullPath.split('/').slice(0, -1).join('/'))}/${encodeURIComponent(csvFile)}`
    ];

    let lastError = null;
    for (const url of attempts) {
        console.log('Attempting to load CSV from:', url);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'text/csv',
                    'Cache-Control': 'no-cache'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            const rows = text.split('\n').filter(line => line.trim() !== '').map(row => row.split(','));
            columnsState[columnId].data = rows;
            container.innerHTML = '';
            console.log(`Successfully loaded CSV from: ${url}`);
            return;
        } catch (error) {
            console.error(`Failed to load CSV from ${url}:`, error);
            lastError = error;
        }
    }

    columnsState[columnId].data = [];
    const errorMessage = `Failed to load CSV: ${lastError.message}.<br>Attempted URLs:<br>${attempts.join('<br>')}<br>Please verify the file exists on the server at: ${baseUrl}${fullPath}/${csvFile}`;
    container.innerHTML = `<p style="color: red; padding: 10px;">${errorMessage}</p>`;
}

function handleAggregateToggle(isChecked) {
    if (!isChecked) clearHighlights();
}

async function addColumn() {
    if (!isFolderStructureLoaded) {
        alert('Folder structure is still loading. Please wait.');
        return;
    }
    const columnId = `col-${nextColumnId++}`;
    const columnEl = document.createElement('div');
    columnEl.className = 'column';
    columnEl.dataset.columnId = columnId;
    const menuHtml = await buildNestedMenu(columnId);
    columnEl.innerHTML = `
        <div class="column-header">
            <input type="text" class="custom-header" placeholder="Custom label" oninput="onCustomHeader(this.value, '${columnId}')">
            <div class="select-container">
                <div class="nested-dropdown">
                    <button class="dropbtn">Select Configuration</button>
                    <div class="dropdown-content">
                        ${menuHtml}
                    </div>
                </div>
            </div>
            <button class="close-btn" onclick="closeColumn('${columnId}')">&times;</button>
        </div>
        <div class="table-container"></div>`;
    document.getElementById('columns-container').appendChild(columnEl);
    columnsState[columnId] = { className: null, fullPath: null, csvFile: null, customHeader: '', data: [], sort: {} };
    const button = columnEl.querySelector('.dropbtn');
    button.addEventListener('click', (e) => toggleMenu(button, e));
    const spans = columnEl.querySelectorAll('.dropdown-content li > span');
    spans.forEach(span => {
        span.addEventListener('click', (e) => toggleSubMenu(span, e));
    });
}

function onCustomHeader(value, columnId) {
    columnsState[columnId].customHeader = value;
}

function selectConfig(columnId, fullPath, csv) {
    const className = fullPath.split('/')[0];
    columnsState[columnId].className = className;
    columnsState[columnId].fullPath = fullPath;
    columnsState[columnId].csvFile = csv;
    const button = document.querySelector(`.column[data-column-id='${columnId}'] .dropbtn`);
    button.textContent = className;
    button.title = `${fullPath}/${csv}`;
    console.log('Selected config path:', fullPath, 'CSV:', csv);
    closeAllMenus(button.closest('.nested-dropdown'));
    tryLoadData(columnId);
}

async function tryLoadData(columnId) {
    const state = columnsState[columnId];
    const { fullPath, csvFile } = state;
    if (fullPath && csvFile) {
        await loadDataForColumn(fullPath, csvFile, columnId);
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

async function renderTable(columnId) {
    const { data, sort } = columnsState[columnId];
    const container = document.querySelector(`.column[data-column-id='${columnId}'] .table-container`);
    if (!data || data.length < 2) {
        if (!container.innerHTML) {
            container.innerHTML = '<p>No data loaded.</p>';
        }
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
        fullPath: state.fullPath,
        className: state.className,
        csvFile: state.csvFile,
        customHeader: state.customHeader,
        sort: state.sort
    })).filter(c => c.fullPath && c.className && c.csvFile);

    const state = { aggregateChecked, highlights, columns };
    const hash = btoa(JSON.stringify(state));
    window.location.hash = hash;
    alert('Permalink created! Copy the URL from your address bar.');
}

async function loadFromPermalink() {
    if (!isFolderStructureLoaded) {
        console.warn('Cannot load permalink: folder structure not loaded yet');
        return;
    }
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
            const loadPromises = state.columns.map(async colState => {
                const columnId = `col-${nextColumnId++}`;
                const columnEl = document.createElement('div');
                columnEl.className = 'column';
                columnEl.dataset.columnId = columnId;
                const menuHtml = await buildNestedMenu(columnId);
                columnEl.innerHTML = `
                    <div class="column-header">
                        <input type="text" class="custom-header" placeholder="Custom label" value="${colState.customHeader || ''}" oninput="onCustomHeader(this.value, '${columnId}')">
                        <div class="select-container">
                            <div class="nested-dropdown">
                                <button class="dropbtn">Select Configuration</button>
                                <div class="dropdown-content">
                                    ${menuHtml}
                                </div>
                            </div>
                        </div>
                        <button class="close-btn" onclick="closeColumn('${columnId}')">&times;</button>
                    </div>
                    <div class="table-container"></div>`;
                document.getElementById('columns-container').appendChild(columnEl);
                
                columnsState[columnId] = { 
                    className: colState.className, 
                    fullPath: colState.fullPath,
                    csvFile: colState.csvFile,
                    customHeader: colState.customHeader || '', 
                    data: [], 
                    sort: colState.sort || {} 
                };
                
                const button = columnEl.querySelector('.dropbtn');
                button.addEventListener('click', (e) => toggleMenu(button, e));
                const spans = columnEl.querySelectorAll('.dropdown-content li > span');
                spans.forEach(span => {
                    span.addEventListener('click', (e) => toggleSubMenu(span, e));
                });

                if (colState.fullPath && colState.className && colState.csvFile) {
                    button.textContent = colState.className;
                    button.title = `${colState.fullPath}/${colState.csvFile}`;
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

window.onload = async () => {
    document.getElementById('add-column-btn').disabled = true;
    document.addEventListener('click', (e) => {
        setTimeout(() => {
            if (!e.target.closest('.nested-dropdown')) {
                console.log('Document click handler triggered');
                document.querySelectorAll('.nested-dropdown').forEach(nestedDropdown => {
                    closeAllMenus(nestedDropdown);
                });
            }
        }, 0);
    }, { once: false });
    await initFolderStructure();
    await loadFromPermalink();
};
