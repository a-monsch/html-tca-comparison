let folderStructure = {};
let columns = [];

// Cross-column highlight state
let pinnedVars = new Set();
let hoveredVar = null;
let colorMap = new Map();
let nextColorIndex = 0;
let isRestoringState = false;
let isAnalysisPanelOpen = false;
let lastExcludeInputValue = '';

const VAR_COL_MIN_WIDTH = 140;
const MONO_CHAR_WIDTH_PX = 8.4;
const VAR_CELL_PADDING_PX = 28;

function requestPermalinkUpdate() {
    if (!isRestoringState) {
        generatePermalink();
    }
}

function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseLegacyTitles(rawTitles) {
    if (!rawTitles) return [];
    try {
        const parsed = JSON.parse(rawTitles);
        if (Array.isArray(parsed)) return parsed.map(String);
    } catch (e) {
        // Keep backward compatibility with old comma-separated links.
    }
    return rawTitles.split(',');
}

function getLegacyColumnsFromParams(params) {
    const files = params.getAll('file');
    const titles = params.getAll('title');
    if (files.length > 0) {
        return files
            .filter(f => f)
            .map((file, idx) => ({ title: titles[idx] ?? 'TC Data Column', selections: [file] }));
    }

    const legacyFiles = params.get('files');
    if (!legacyFiles) return [];
    const legacyTitles = parseLegacyTitles(params.get('titles'));
    return legacyFiles
        .split(',')
        .filter(f => f)
        .map((file, idx) => ({ title: legacyTitles[idx] ?? 'TC Data Column', selections: [file] }));
}

function normalizeAnalysisState(rawAnalysis = null) {
    const raw = rawAnalysis && typeof rawAnalysis === 'object' ? rawAnalysis : {};

    const uniqueN = raw.uniqueN;
    const alpha = raw.alpha;

    return {
        open: Boolean(raw.open),
        uniqueN: uniqueN === null || uniqueN === undefined ? '' : String(uniqueN),
        alpha: alpha === null || alpha === undefined ? '' : String(alpha),
        uniqueMenuOpen: Boolean(raw.uniqueMenuOpen),
        alphaMenuOpen: Boolean(raw.alphaMenuOpen)
    };
}

function getViewStateFromPermalink() {
    const params = new URLSearchParams(window.location.search);
    const stateParam = params.get('state');

    if (stateParam) {
        try {
            const parsed = JSON.parse(stateParam);
            if (parsed && Array.isArray(parsed.columns)) {
                return {
                    columns: parsed.columns.map(col => ({
                        title: typeof col.title === 'string' ? col.title : 'TC Data Column',
                        selections: Array.isArray(col.selections)
                            ? col.selections.map(sel => (typeof sel === 'string' && sel ? sel : null))
                            : [],
                        sortCol: col.sortCol === 'v1' || col.sortCol === 'v2' || col.sortCol === 'val' ? col.sortCol : 'val',
                        sortDir: col.sortDir === 1 || col.sortDir === -1 ? col.sortDir : -1,
                        sortValIndex: Number.isInteger(col.sortValIndex) ? col.sortValIndex : 0
                    })),
                    exclude: typeof parsed.exclude === 'string' ? parsed.exclude : '',
                    dim: parsed.dim === '1d' || parsed.dim === '2d' || parsed.dim === 'both' ? parsed.dim : 'both',
                    searchText: typeof parsed.searchText === 'string' ? parsed.searchText : '',
                    searchMode: parsed.searchMode === 'filter' || parsed.searchMode === 'highlight' ? parsed.searchMode : 'highlight',
                    aggregate: Boolean(parsed.aggregate),
                    pinned: Array.isArray(parsed.pinned) ? parsed.pinned.map(String) : [],
                    analysis: normalizeAnalysisState(parsed.analysis)
                };
            }
        } catch (e) {
            // Fall through to legacy query parsing.
        }
    }

    const legacyColumns = getLegacyColumnsFromParams(params);
    if (legacyColumns.length > 0) {
        return {
            columns: legacyColumns,
            exclude: '',
            dim: 'both',
            searchText: '',
            searchMode: 'highlight',
            aggregate: false,
            pinned: [],
            analysis: normalizeAnalysisState()
        };
    }

    return null;
}

function formatScientific(value) {
    if (!Number.isFinite(value)) return String(value);
    if (value === 0) return '0.00∙10<sup>0</sup>';

    const [mantissaRaw, exponentRaw] = value.toExponential(2).split('e');
    const mantissa = Number(mantissaRaw).toFixed(2);
    const exponent = Number(exponentRaw);
    return `${mantissa}∙10<sup>${exponent}</sup>`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function applyDarkMode(enabled) {
    document.body.classList.toggle('dark-mode', enabled);
    localStorage.setItem('tc-dark-mode', enabled ? '1' : '0');
}

function handleDarkModeToggle() {
    const toggle = document.getElementById('dark-mode-toggle');
    applyDarkMode(Boolean(toggle?.checked));
}

function countCommas(text) {
    return (text.match(/,/g) || []).length;
}

function applyExcludeFilter() {
    renderAllColumns();
    requestPermalinkUpdate();
}

function handleExcludeInput(event) {
    const currentValue = event?.target?.value ?? '';
    const previousCommaCount = countCommas(lastExcludeInputValue);
    const currentCommaCount = countCommas(currentValue);

    lastExcludeInputValue = currentValue;

    // Commit and re-filter only when a new comma is introduced.
    if (currentCommaCount > previousCommaCount) {
        applyExcludeFilter();
    }
}

function handleExcludeInputKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    lastExcludeInputValue = event.target?.value ?? '';
    applyExcludeFilter();
}

function getExcludedVariablesSet() {
    const raw = document.getElementById('exclude-input')?.value ?? '';
    return new Set(
        raw
            .split(',')
            .map(part => part.trim().toLowerCase())
            .filter(Boolean)
    );
}

document.addEventListener('DOMContentLoaded', () => {
    const storedDarkMode = localStorage.getItem('tc-dark-mode') === '1';
    const darkToggle = document.getElementById('dark-mode-toggle');
    const aggregateCheckbox = document.getElementById('aggregate-checkbox');
    if (darkToggle) darkToggle.checked = storedDarkMode;
    applyDarkMode(storedDarkMode);

    if (aggregateCheckbox) {
        aggregateCheckbox.addEventListener('change', () => {
            requestPermalinkUpdate();
        });
    }

    fetch('folder_structure.json')
        .then(response => response.json())
        .then(data => {
            folderStructure = data;

            const viewState = getViewStateFromPermalink();
            if (viewState) {
                isRestoringState = true;
                document.getElementById('exclude-input').value = viewState.exclude || '';
                lastExcludeInputValue = viewState.exclude || '';
                document.getElementById('dim-select').value = viewState.dim;
                document.getElementById('search-input').value = viewState.searchText;
                document.getElementById('search-mode').value = viewState.searchMode;
                if (aggregateCheckbox) aggregateCheckbox.checked = viewState.aggregate;
                pinnedVars = new Set(viewState.pinned);
                assignColors();

                if (viewState.columns.length > 0) {
                    viewState.columns.forEach(config => addColumn(config, null, true));
                } else {
                    addColumn(null, null, true);
                }

                renderAllColumns();
                applyAnalysisState(viewState.analysis);
                isRestoringState = false;
            } else {
                lastExcludeInputValue = document.getElementById('exclude-input')?.value ?? '';
                addColumn();
            }
        })
        .catch(() => alert('Could not load folder_structure.json.'));

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.nested-dropdown')) {
            document.querySelectorAll('.dropdown-content').forEach(el => {
                el.style.display = 'none';
            });
        }
    });

    const uniqueVarsMenu = document.getElementById('analysis-menu-unique-vars');
    if (uniqueVarsMenu) {
        uniqueVarsMenu.addEventListener('toggle', () => {
            if (uniqueVarsMenu.open) {
                renderUniqueVariablesAnalysis();
            }
            requestPermalinkUpdate();
        });
    }

    const alphaVarsMenu = document.getElementById('analysis-menu-alpha-vars');
    if (alphaVarsMenu) {
        alphaVarsMenu.addEventListener('toggle', () => {
            if (alphaVarsMenu.open) {
                renderAlphaVariablesAnalysis();
            }
            requestPermalinkUpdate();
        });
    }
});

function normalizeColumnConfig(configOrPath = null, titleToLoad = null) {
    if (typeof configOrPath === 'object' && configOrPath !== null && !Array.isArray(configOrPath)) {
        const selections = Array.isArray(configOrPath.selections)
            ? configOrPath.selections.map(sel => (typeof sel === 'string' && sel ? sel : null))
            : [];
        return {
            title: typeof configOrPath.title === 'string' ? configOrPath.title : 'TC Data Column',
            selections,
            sortCol: configOrPath.sortCol === 'v1' || configOrPath.sortCol === 'v2' || configOrPath.sortCol === 'val' ? configOrPath.sortCol : 'val',
            sortDir: configOrPath.sortDir === 1 || configOrPath.sortDir === -1 ? configOrPath.sortDir : -1,
            sortValIndex: Number.isInteger(configOrPath.sortValIndex) ? configOrPath.sortValIndex : 0
        };
    }

    if (typeof configOrPath === 'string' && configOrPath) {
        return {
            title: titleToLoad ?? 'TC Data Column',
            selections: [configOrPath],
            sortCol: 'val',
            sortDir: -1,
            sortValIndex: 0
        };
    }

    return {
        title: titleToLoad ?? 'TC Data Column',
        selections: [],
        sortCol: 'val',
        sortDir: -1,
        sortValIndex: 0
    };
}

function addColumn(configOrPath = null, titleToLoad = null, suppressPermalinkUpdate = false) {
    const config = normalizeColumnConfig(configOrPath, titleToLoad);
    const colId = createId('col');
    const colObj = {
        id: colId,
        title: config.title,
        selections: [],
        rowsMap: {},
        sortCol: config.sortCol,
        sortDir: config.sortDir,
        sortValIndex: config.sortValIndex
    };
    columns.push(colObj);

    const colHtml = `
        <div class="column" id="col-${colId}">
            <div class="column-header">
                <button class="close-btn" onclick="removeColumn('${colId}')">&times;</button>
                <input type="text" class="column-title-input" id="title-${colId}" placeholder="Column title">
                <div class="select-container">
                    <div class="selector-stack" id="selectors-${colId}"></div>
                    <button class="selector-add-btn" type="button" onclick="addSelectionControl('${colId}')">+</button>
                </div>
            </div>
            <div class="table-container">
                <table>
                    <colgroup id="colgroup-${colId}"></colgroup>
                    <thead id="thead-${colId}"></thead>
                    <tbody id="tbody-${colId}"></tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById('columns-container').insertAdjacentHTML('beforeend', colHtml);
    const titleInput = document.getElementById(`title-${colId}`);
    titleInput.value = config.title;
    titleInput.addEventListener('input', (e) => updateColumnTitle(colId, e.target.value));

    const initialSelections = config.selections.length > 0 ? config.selections : [null];
    initialSelections.forEach(path => addSelectionControl(colId, path, false));
    renderColumn(colId);
    if (!suppressPermalinkUpdate) requestPermalinkUpdate();
}

function updateColumnTitle(colId, newTitle) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;
    col.title = newTitle;
    requestPermalinkUpdate();
}

function removeColumn(colId) {
    columns = columns.filter(c => c.id !== colId);
    const el = document.getElementById(`col-${colId}`);
    if (el) el.remove();
    refreshBasicAnalysisPanel();
    requestPermalinkUpdate();
}

function addSelectionControl(colId, fileToLoad = null, updatePermalinkAfter = true) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    const selectionId = createId('sel');
    col.selections.push({ id: selectionId, path: null, data: [] });

    const selectorsContainer = document.getElementById(`selectors-${colId}`);
    selectorsContainer.insertAdjacentHTML('beforeend', `
        <div class="selector-item" id="selector-${colId}-${selectionId}">
            <div class="nested-dropdown selector-dropdown">
                <button class="dropbtn" id="btn-${colId}-${selectionId}" onclick="toggleDropdown('${colId}', '${selectionId}')">Select JSON file...</button>
                <div class="dropdown-content" id="dropdown-${colId}-${selectionId}"></div>
            </div>
            <button class="selector-remove-btn" type="button" onclick="removeSelectionControl('${colId}', '${selectionId}')" title="Remove selection">-</button>
        </div>
    `);

    document
        .getElementById(`dropdown-${colId}-${selectionId}`)
        .appendChild(buildDropdown(colId, selectionId, folderStructure, 'data'));

    if (fileToLoad) {
        loadSelectionFile(colId, selectionId, fileToLoad, updatePermalinkAfter);
    } else {
        renderColumn(colId);
        if (updatePermalinkAfter) requestPermalinkUpdate();
    }
}

function removeSelectionControl(colId, selectionId) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    col.selections = col.selections.filter(s => s.id !== selectionId);
    const selEl = document.getElementById(`selector-${colId}-${selectionId}`);
    if (selEl) selEl.remove();

    if (col.sortValIndex >= col.selections.length) {
        col.sortValIndex = Math.max(0, col.selections.length - 1);
    }

    if (col.selections.length === 0) {
        addSelectionControl(colId, null, false);
    }

    renderColumn(colId);
    requestPermalinkUpdate();
}

function toggleDropdown(colId, selectionId) {
    const el = document.getElementById(`dropdown-${colId}-${selectionId}`);
    if (!el) return;

    const isVisible = el.style.display === 'block';
    document.querySelectorAll('.dropdown-content').forEach(d => {
        d.style.display = 'none';
    });

    if (!isVisible) el.style.display = 'block';
}

function buildDropdown(colId, selectionId, node, currentPath) {
    const ul = document.createElement('ul');

    if (node.files) {
        node.files.forEach(f => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.textContent = f;
            li.onclick = (e) => {
                e.stopPropagation();
                const fullPath = currentPath ? `${currentPath}/${f}` : f;
                loadSelectionFile(colId, selectionId, fullPath, true);
                const dropdown = document.getElementById(`dropdown-${colId}-${selectionId}`);
                if (dropdown) dropdown.style.display = 'none';
            };
            ul.appendChild(li);
        });
    }

    for (const key in node) {
        if (key === 'files') continue;

        const li = document.createElement('li');
        li.className = 'folder-item';

        const span = document.createElement('span');
        span.className = 'folder-toggle';
        span.textContent = key;
        li.appendChild(span);

        const childUl = buildDropdown(colId, selectionId, node[key], currentPath ? `${currentPath}/${key}` : key);
        li.appendChild(childUl);

        span.onclick = (e) => {
            e.stopPropagation();
            li.classList.toggle('open');
        };

        ul.appendChild(li);
    }

    return ul;
}

function parseRawDataToArray(data) {
    const parsed = [];
    Object.entries(data).forEach(([k, v]) => {
        const parts = k.split(',');
        parsed.push({
            key: k,
            v1: parts[0],
            v2: parts.length > 1 ? parts[1] : '',
            val: Number(v)
        });
    });
    return parsed;
}

function loadSelectionFile(colId, selectionId, filePath, updatePermalinkAfter = true) {
    fetch(filePath)
        .then(res => res.json())
        .then(data => {
            const col = columns.find(c => c.id === colId);
            if (!col) return;

            const sel = col.selections.find(s => s.id === selectionId);
            if (!sel) return;

            sel.path = filePath;
            sel.data = parseRawDataToArray(data);

            const button = document.getElementById(`btn-${colId}-${selectionId}`);
            if (button) {
                button.textContent = filePath.replace(/^data\//, '');
                button.title = filePath;
            }

            renderColumn(colId);
            if (updatePermalinkAfter) requestPermalinkUpdate();
        })
        .catch(e => alert(`Error loading JSON file ${filePath}: ${e}`));
}

function toggleSort(colId, field, valIndex = null) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    if (field === 'val') {
        const idx = Number.isInteger(valIndex) ? valIndex : 0;
        if (col.sortCol === 'val' && col.sortValIndex === idx) {
            col.sortDir *= -1;
        } else {
            col.sortCol = 'val';
            col.sortValIndex = idx;
            col.sortDir = -1;
        }
    } else {
        if (col.sortCol === field) {
            col.sortDir *= -1;
        } else {
            col.sortCol = field;
            col.sortDir = 1;
        }
    }

    renderColumn(colId);
    requestPermalinkUpdate();
}

function renderTableHead(col, showVar2) {
    const thead = document.getElementById(`thead-${col.id}`);
    if (!thead) return;

    const valueHeaders = col.selections.map((sel, idx) => {
        const fullLabel = sel.path ? sel.path.replace(/^data\//, '') : `TC ${idx + 1}`;
        const label = `TC ${idx + 1}`;
        return `
            <th class="th-sortable value-col" onclick="toggleSort('${col.id}', 'val', ${idx})" title="${fullLabel}">
                ${label}
                <span class="sort-icon" id="sort-${col.id}-val-${idx}"></span>
            </th>
        `;
    }).join('');

    const var2Header = showVar2
        ? `<th class="th-sortable var-col" onclick="toggleSort('${col.id}', 'v2')">Var 2 <span class="sort-icon" id="sort-${col.id}-v2"></span></th>`
        : '';

    thead.innerHTML = `
        <tr>
            <th class="th-sortable var-col" onclick="toggleSort('${col.id}', 'v1')">Var 1 <span class="sort-icon" id="sort-${col.id}-v1"></span></th>
            ${var2Header}
            ${valueHeaders}
        </tr>
    `;
}

function getLongestVariableLength(rows, showVar2) {
    let longest = 4;
    rows.forEach(item => {
        if (item.v1) longest = Math.max(longest, item.v1.length);
        if (showVar2 && item.v2) longest = Math.max(longest, item.v2.length);
    });
    return longest;
}

function computeTableWidths(col, showVar2, longestVarLength) {
    const tableContainer = document.querySelector(`#col-${col.id} .table-container`);
    const containerWidth = Math.max(320, tableContainer ? tableContainer.clientWidth : 520);
    const valueCount = Math.max(1, col.selections.length);
    const varColCount = showVar2 ? 2 : 1;

    const targetVarWidth = Math.max(
        VAR_COL_MIN_WIDTH,
        Math.ceil(longestVarLength * MONO_CHAR_WIDTH_PX + VAR_CELL_PADDING_PX)
    );

    let varWidth = targetVarWidth;
    const maxVarWidthThatFits = containerWidth / varColCount;
    if (varWidth > maxVarWidthThatFits) {
        varWidth = Math.max(80, maxVarWidthThatFits);
    }

    const remainingForValues = Math.max(0, containerWidth - (varColCount * varWidth));
    const valueWidth = remainingForValues / valueCount;

    return {
        varWidth,
        valueWidth
    };
}

function renderColgroup(col, showVar2, longestVarLength) {
    const colgroup = document.getElementById(`colgroup-${col.id}`);
    if (!colgroup) return;

    const { varWidth, valueWidth } = computeTableWidths(col, showVar2, longestVarLength);
    const valueCount = Math.max(1, col.selections.length);

    const valueCols = Array.from({ length: valueCount }, () => `<col style="width: ${valueWidth.toFixed(2)}px;">`).join('');
    const varCols = showVar2
        ? `<col style="width: ${varWidth.toFixed(2)}px;">\n        <col style="width: ${varWidth.toFixed(2)}px;">`
        : `<col style="width: ${varWidth.toFixed(2)}px;">`;

    colgroup.innerHTML = `
        ${varCols}
        ${valueCols}
    `;
}

function updateSortIcons(col) {
    ['v1', 'v2'].forEach(field => {
        const span = document.getElementById(`sort-${col.id}-${field}`);
        if (!span) return;
        if (col.sortCol === field) {
            span.textContent = col.sortDir === 1 ? '▲' : '▼';
        } else {
            span.textContent = '';
        }
    });

    col.selections.forEach((_, idx) => {
        const span = document.getElementById(`sort-${col.id}-val-${idx}`);
        if (!span) return;
        if (col.sortCol === 'val' && col.sortValIndex === idx) {
            span.textContent = col.sortDir === 1 ? '▲' : '▼';
        } else {
            span.textContent = '';
        }
    });
}

function handleSearchInput() {
    const mode = document.getElementById('search-mode').value;
    if (mode === 'filter') {
        renderAllColumns();
    } else {
        applyHighlights();
    }
    requestPermalinkUpdate();
}

function handleSearchModeChange() {
    renderAllColumns();
    requestPermalinkUpdate();
}

function handleDimChange() {
    renderAllColumns();
    requestPermalinkUpdate();
}

function toggleBasicAnalysisPanel(forceOpen = null) {
    const panel = document.getElementById('analysis-panel');
    const toggleBtn = document.getElementById('toggle-analysis-btn');
    if (!panel || !toggleBtn) return;

    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !isAnalysisPanelOpen;
    const hasChanged = shouldOpen !== isAnalysisPanelOpen;
    isAnalysisPanelOpen = shouldOpen;

    panel.classList.toggle('open', shouldOpen);
    panel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    toggleBtn.classList.toggle('is-active', shouldOpen);

    if (hasChanged) {
        // Recompute table geometry because available horizontal width changed.
        renderAllColumns();
    } else if (shouldOpen) {
        refreshBasicAnalysisPanel();
    }

    requestPermalinkUpdate();
}

function handleUniqueVariablesInput() {
    renderUniqueVariablesAnalysis();
    requestPermalinkUpdate();
}

function handleAlphaVariablesInput() {
    renderAlphaVariablesAnalysis();
    requestPermalinkUpdate();
}

function applyAnalysisState(analysisState) {
    const state = normalizeAnalysisState(analysisState);
    const uniqueInput = document.getElementById('unique-vars-n-input');
    const alphaInput = document.getElementById('alpha-vars-input');
    const uniqueMenu = document.getElementById('analysis-menu-unique-vars');
    const alphaMenu = document.getElementById('analysis-menu-alpha-vars');

    if (uniqueInput) uniqueInput.value = state.uniqueN;
    if (alphaInput) alphaInput.value = state.alpha;
    if (uniqueMenu) uniqueMenu.open = state.uniqueMenuOpen;
    if (alphaMenu) alphaMenu.open = state.alphaMenuOpen;

    if (state.open) {
        toggleBasicAnalysisPanel(true);
    } else {
        toggleBasicAnalysisPanel(false);
    }
}

function refreshBasicAnalysisPanel() {
    if (isAnalysisPanelOpen) {
        renderUniqueVariablesAnalysis();
        renderAlphaVariablesAnalysis();
    }
}

function getColumnDisplayName(col, index) {
    const title = (col.title ?? '').trim();
    return title || `Column ${index + 1}`;
}

function getVariableSetFromRows(rows, nRows) {
    const vars = new Set();
    const limit = Math.min(nRows, rows.length);

    for (let i = 0; i < limit; i++) {
        const row = rows[i];
        if (row.v1) vars.add(row.v1);
        if (row.v2) vars.add(row.v2);
    }

    return vars;
}

function sortedArrayFromSet(values) {
    return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function renderVariablesList(variables) {
    if (variables.length === 0) {
        return '<p class="analysis-empty">None</p>';
    }
    const items = variables.map(v => `<li>${escapeHtml(v)}</li>`).join('');
    return `<ul class="analysis-vars-list">${items}</ul>`;
}

function renderSetComparisonBlocks(perColumn) {
    if (perColumn.length === 1) {
        const only = perColumn[0];
        const onlyList = sortedArrayFromSet(only.vars);
        return `
            <div class="analysis-section">
                <h4>${escapeHtml(only.name)} (${onlyList.length})</h4>
                ${renderVariablesList(onlyList)}
            </div>
        `;
    }

    let intersection = new Set(perColumn[0].vars);
    const union = new Set();

    perColumn.forEach(entry => {
        entry.vars.forEach(v => union.add(v));
    });

    for (let i = 1; i < perColumn.length; i++) {
        intersection = new Set(Array.from(intersection).filter(v => perColumn[i].vars.has(v)));
    }

    const intersectionList = sortedArrayFromSet(intersection);
    const unionList = sortedArrayFromSet(union);

    let html = `
        <div class="analysis-section">
            <h4>Common in all columns (${intersectionList.length})</h4>
            ${renderVariablesList(intersectionList)}
        </div>
        <div class="analysis-section">
            <h4>Union across columns (${unionList.length})</h4>
            ${renderVariablesList(unionList)}
        </div>
    `;

    perColumn.forEach(entry => {
        const extra = new Set(Array.from(entry.vars).filter(v => !intersection.has(v)));
        const extraList = sortedArrayFromSet(extra);

        html += `
            <div class="analysis-section">
                <h4>${escapeHtml(entry.name)} only (${extraList.length})</h4>
                ${renderVariablesList(extraList)}
            </div>
        `;
    });

    return html;
}

function getColumnTcValueIndex(col) {
    if (!Array.isArray(col.selections) || col.selections.length === 0) {
        return -1;
    }

    if (Number.isInteger(col.sortValIndex) && col.sortValIndex >= 0 && col.sortValIndex < col.selections.length) {
        return col.sortValIndex;
    }

    return 0;
}

function getVariableSetFromRowsByAlpha(rows, valueIndex, alpha) {
    if (valueIndex < 0 || !Array.isArray(rows) || rows.length === 0) {
        return new Set();
    }

    let maxValue = Number.NEGATIVE_INFINITY;
    rows.forEach(row => {
        const value = row.values[valueIndex];
        if (Number.isFinite(value) && value > maxValue) {
            maxValue = value;
        }
    });

    if (!Number.isFinite(maxValue)) {
        return new Set();
    }

    const threshold = alpha * maxValue;
    const vars = new Set();

    rows.forEach(row => {
        const value = row.values[valueIndex];
        if (!Number.isFinite(value) || value <= threshold) return;
        if (row.v1) vars.add(row.v1);
        if (row.v2) vars.add(row.v2);
    });

    return vars;
}

function renderUniqueVariablesAnalysis() {
    const resultEl = document.getElementById('unique-vars-results');
    const inputEl = document.getElementById('unique-vars-n-input');
    if (!resultEl || !inputEl) return;

    const raw = inputEl.value.trim();
    if (!raw) {
        resultEl.textContent = 'Enter N to compute unique variables from the first N visible rows.';
        return;
    }

    const nRows = Number.parseInt(raw, 10);
    if (!Number.isInteger(nRows) || nRows <= 0) {
        resultEl.textContent = 'Please enter a positive integer for N.';
        return;
    }

    const visibleColumns = columns.filter(col => document.getElementById(`col-${col.id}`));
    if (visibleColumns.length === 0) {
        resultEl.textContent = 'No visible columns available.';
        return;
    }

    const perColumn = visibleColumns.map((col, idx) => {
        const rows = Array.isArray(col.visibleRows) ? col.visibleRows : [];
        return {
            name: getColumnDisplayName(col, idx),
            vars: getVariableSetFromRows(rows, nRows)
        };
    });

    let html = `<p class="analysis-meta">Using first ${nRows} visible rows per column (respecting each column's current sort and filters).</p>`;
    html += renderSetComparisonBlocks(perColumn);
    resultEl.innerHTML = html;
}

function renderAlphaVariablesAnalysis() {
    const resultEl = document.getElementById('alpha-vars-results');
    const inputEl = document.getElementById('alpha-vars-input');
    if (!resultEl || !inputEl) return;

    const raw = inputEl.value.trim();
    if (!raw) {
        resultEl.textContent = 'Enter alpha to compute variables from rows with TC value above alpha times the column maximum.';
        return;
    }

    const alpha = Number.parseFloat(raw);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        resultEl.textContent = 'Please enter alpha in the range [0, 1].';
        return;
    }

    const visibleColumns = columns.filter(col => document.getElementById(`col-${col.id}`));
    if (visibleColumns.length === 0) {
        resultEl.textContent = 'No visible columns available.';
        return;
    }

    const perColumn = visibleColumns.map((col, idx) => {
        const rows = Array.isArray(col.visibleRows) ? col.visibleRows : [];
        const tcValueIndex = getColumnTcValueIndex(col);
        return {
            name: getColumnDisplayName(col, idx),
            vars: getVariableSetFromRowsByAlpha(rows, tcValueIndex, alpha)
        };
    });

    let html = `<p class="analysis-meta">Using rows where TC value is greater than alpha times the per-column maximum TC value (alpha = ${alpha}).</p>`;
    html += renderSetComparisonBlocks(perColumn);
    resultEl.innerHTML = html;
}

function renderAllColumns() {
    columns.forEach(col => renderColumn(col.id, true));
    refreshBasicAnalysisPanel();
}

function getCombinedRows(col) {
    const rowsByKey = new Map();
    const valueCount = col.selections.length;

    col.selections.forEach((sel, selIdx) => {
        sel.data.forEach(item => {
            if (!rowsByKey.has(item.key)) {
                rowsByKey.set(item.key, {
                    key: item.key,
                    v1: item.v1,
                    v2: item.v2,
                    values: new Array(valueCount).fill(null)
                });
            }
            rowsByKey.get(item.key).values[selIdx] = item.val;
        });
    });

    return Array.from(rowsByKey.values());
}

function shouldExcludeRow(item, excludedVars) {
    const v1 = item.v1.toLowerCase();
    const v2 = item.v2.toLowerCase();
    return excludedVars.has(v1) || (v2 && excludedVars.has(v2));
}

function renderColumn(colId, suppressAnalysisRefresh = false) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    const tbody = document.getElementById(`tbody-${colId}`);
    if (!tbody) return;
    tbody.innerHTML = '';
    col.rowsMap = {};
    col.visibleRows = [];

    const dim = document.getElementById('dim-select').value;
    const showVar2 = dim !== '1d';
    const searchTxt = document.getElementById('search-input').value.toLowerCase();
    const searchMode = document.getElementById('search-mode').value;
    const excludedVars = getExcludedVariablesSet();

    if (!showVar2 && col.sortCol === 'v2') {
        col.sortCol = 'v1';
        col.sortDir = 1;
    }

    let filteredEntries = [];
    const allRows = getCombinedRows(col);
    const maxAbsValues = new Array(col.selections.length).fill(0);

    allRows.forEach(item => {
        const is2D = item.v2 !== '';
        if (dim === '1d' && is2D) return;
        if (dim === '2d' && !is2D) return;
        if (shouldExcludeRow(item, excludedVars)) return;

        if (searchMode === 'filter' && searchTxt) {
            if (!item.v1.toLowerCase().includes(searchTxt) && !item.v2.toLowerCase().includes(searchTxt)) {
                return;
            }
        }

        item.values.forEach((val, idx) => {
            if (val === null || Number.isNaN(val)) return;
            const absVal = Math.abs(val);
            if (absVal > maxAbsValues[idx]) maxAbsValues[idx] = absVal;
        });

        filteredEntries.push(item);
    });

    const longestVarLength = getLongestVariableLength(filteredEntries, showVar2);
    renderColgroup(col, showVar2, longestVarLength);
    renderTableHead(col, showVar2);
    updateSortIcons(col);

    filteredEntries.sort((a, b) => {
        if (col.sortCol === 'val') {
            const idx = col.sortValIndex;
            const aVal = a.values[idx];
            const bVal = b.values[idx];
            if (aVal === null && bVal === null) return 0;
            if (aVal === null) return 1;
            if (bVal === null) return -1;
            return (aVal - bVal) * col.sortDir;
        }

        const aText = a[col.sortCol] || '';
        const bText = b[col.sortCol] || '';
        return aText.localeCompare(bText) * col.sortDir;
    });

    col.visibleRows = filteredEntries.slice();

    if (filteredEntries.length === 0) {
        const tr = document.createElement('tr');
        tr.className = 'empty-row';
        const colCount = (showVar2 ? 2 : 1) + col.selections.length;
        tr.innerHTML = `<td colspan="${colCount}">No rows to display.</td>`;
        tbody.appendChild(tr);
        applyHighlights();
        if (!suppressAnalysisRefresh) refreshBasicAnalysisPanel();
        return;
    }

    filteredEntries.forEach(item => {
        const tr = document.createElement('tr');
        col.rowsMap[item.key] = { tr, item };

        const td1 = document.createElement('td');
        td1.textContent = item.v1;
        td1.className = 'td-interact var-col var-text';
        td1.onmouseenter = (e) => { e.stopPropagation(); handleHover(item.v1, true); };
        td1.onmouseleave = (e) => { e.stopPropagation(); handleHover(item.v1, false); };
        td1.onclick = (e) => { e.stopPropagation(); handleClick(item.v1); };

        tr.appendChild(td1);

        if (showVar2) {
            const td2 = document.createElement('td');
            td2.textContent = item.v2;
            td2.className = 'td-interact var-col var-text';
            if (item.v2) {
                td2.onmouseenter = (e) => { e.stopPropagation(); handleHover(item.v2, true); };
                td2.onmouseleave = (e) => { e.stopPropagation(); handleHover(item.v2, false); };
                td2.onclick = (e) => { e.stopPropagation(); handleClick(item.v2); };
            }
            tr.appendChild(td2);
        }

        col.selections.forEach((_, idx) => {
            const tdValue = document.createElement('td');
            tdValue.className = 'value-cell td-interact value-col';

            const value = item.values[idx];
            if (value === null || Number.isNaN(value)) {
                tdValue.innerHTML = `
                    <div class="bar-container bar-empty">
                        <div class="bar-text bar-text-empty">-</div>
                    </div>
                `;
            } else {
                const maxAbs = maxAbsValues[idx];
                const widthPerc = maxAbs === 0 ? 0 : (Math.abs(value) / maxAbs) * 100;
                tdValue.innerHTML = `
                    <div class="bar-container">
                        <div class="bar-plot" style="width: ${widthPerc}%;"></div>
                        <div class="bar-text">${formatScientific(value)}</div>
                    </div>
                `;
            }

            tdValue.onmouseenter = (e) => { e.stopPropagation(); handleHover(item.key, true); };
            tdValue.onmouseleave = (e) => { e.stopPropagation(); handleHover(item.key, false); };
            tdValue.onclick = (e) => { e.stopPropagation(); handleClick(item.key); };

            tr.appendChild(tdValue);
        });

        tbody.appendChild(tr);
    });

    updateSortIcons(col);
    applyHighlights();
    if (!suppressAnalysisRefresh) refreshBasicAnalysisPanel();
}

function handleHover(targetString, isEntering) {
    hoveredVar = isEntering ? targetString : null;
    applyHighlights();
}

function handleClick(targetString) {
    const aggregate = document.getElementById('aggregate-checkbox').checked;

    if (!aggregate) {
        if (pinnedVars.has(targetString) && pinnedVars.size === 1) {
            pinnedVars.clear();
        } else {
            pinnedVars.clear();
            pinnedVars.add(targetString);
        }
    } else if (pinnedVars.has(targetString)) {
        pinnedVars.delete(targetString);
    } else {
        pinnedVars.add(targetString);
    }

    assignColors();
    applyHighlights();
    requestPermalinkUpdate();
}

function assignColors() {
    for (const key of colorMap.keys()) {
        if (!pinnedVars.has(key)) colorMap.delete(key);
    }

    pinnedVars.forEach(key => {
        if (!colorMap.has(key)) {
            colorMap.set(key, nextColorIndex % 11);
            nextColorIndex++;
        }
    });
}

function applyHighlights() {
    const searchTxt = document.getElementById('search-input').value.toLowerCase();
    const searchMode = document.getElementById('search-mode').value;

    columns.forEach(col => {
        Object.values(col.rowsMap).forEach(({ tr, item }) => {
            tr.className = '';

            let isSearchMatch = false;
            if (searchMode === 'highlight' && searchTxt) {
                if (item.v1.toLowerCase().includes(searchTxt) || item.v2.toLowerCase().includes(searchTxt)) {
                    isSearchMatch = true;
                }
            }

            const pinMatch = Array.from(pinnedVars).find(
                p => p === item.v1 || p === item.v2 || p === item.key
            );

            if (hoveredVar && (item.v1 === hoveredVar || item.v2 === hoveredVar || item.key === hoveredVar)) {
                tr.classList.add('highlight-row');
            } else if (pinMatch) {
                const colorIdx = colorMap.get(pinMatch);
                tr.classList.add(`highlight-color-${colorIdx}`);
            } else if (isSearchMatch) {
                tr.classList.add('highlight-search');
            }
        });
    });
}

function generatePermalink() {
    const params = new URLSearchParams();

    const uniqueInput = document.getElementById('unique-vars-n-input');
    const alphaInput = document.getElementById('alpha-vars-input');
    const uniqueMenu = document.getElementById('analysis-menu-unique-vars');
    const alphaMenu = document.getElementById('analysis-menu-alpha-vars');

    const state = {
        columns: columns.map(col => ({
            title: col.title ?? 'TC Data Column',
            selections: col.selections.map(sel => sel.path ?? null),
            sortCol: col.sortCol,
            sortDir: col.sortDir,
            sortValIndex: col.sortValIndex
        })),
        exclude: document.getElementById('exclude-input')?.value ?? '',
        dim: document.getElementById('dim-select')?.value ?? 'both',
        searchText: document.getElementById('search-input')?.value ?? '',
        searchMode: document.getElementById('search-mode')?.value ?? 'highlight',
        aggregate: Boolean(document.getElementById('aggregate-checkbox')?.checked),
        pinned: Array.from(pinnedVars),
        analysis: {
            open: isAnalysisPanelOpen,
            uniqueN: uniqueInput?.value ?? '',
            alpha: alphaInput?.value ?? '',
            uniqueMenuOpen: Boolean(uniqueMenu?.open),
            alphaMenuOpen: Boolean(alphaMenu?.open)
        }
    };

    params.set('state', JSON.stringify(state));

    const query = params.toString();
    const permalink = query ? `${location.pathname}?${query}` : location.pathname;
    window.history.replaceState({}, '', permalink);
}

window.addEventListener('resize', () => {
    renderAllColumns();
});
