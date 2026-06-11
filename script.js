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
const VAR_COL_MAX_WIDTH = 280;
const MONO_CHAR_WIDTH_PX = 8.4;
const VAR_CELL_PADDING_PX = 28;
const VALUE_CELL_MIN_WIDTH = 120;
const VALUE_CELL_PADDING_PX = 26;
const COLUMN_BASE_MIN_WIDTH = 360;

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

function normalizeDisabledValueIndices(rawColumn = null) {
    const indices = new Set();

    if (rawColumn && Array.isArray(rawColumn.disabledValueIndices)) {
        rawColumn.disabledValueIndices.forEach(idx => {
            if (Number.isInteger(idx) && idx >= 0) {
                indices.add(idx);
            }
        });
    }

    // Backward compatibility with old per-cell format.
    if (rawColumn && Array.isArray(rawColumn.disabledCells)) {
        rawColumn.disabledCells.forEach(cellKey => {
            if (typeof cellKey !== 'string') return;
            const separatorIdx = cellKey.lastIndexOf('::');
            if (separatorIdx < 0) return;

            const valueIndex = Number.parseInt(cellKey.slice(separatorIdx + 2), 10);
            if (Number.isInteger(valueIndex) && valueIndex >= 0) {
                indices.add(valueIndex);
            }
        });
    }

    return Array.from(indices).sort((a, b) => a - b);
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
                        sortValIndex: Number.isInteger(col.sortValIndex) ? col.sortValIndex : 0,
                        disabledValueIndices: normalizeDisabledValueIndices(col)
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
        const disabledValueIndices = normalizeDisabledValueIndices(configOrPath);
        return {
            title: typeof configOrPath.title === 'string' ? configOrPath.title : 'TC Data Column',
            selections,
            sortCol: configOrPath.sortCol === 'v1' || configOrPath.sortCol === 'v2' || configOrPath.sortCol === 'val' ? configOrPath.sortCol : 'val',
            sortDir: configOrPath.sortDir === 1 || configOrPath.sortDir === -1 ? configOrPath.sortDir : -1,
            sortValIndex: Number.isInteger(configOrPath.sortValIndex) ? configOrPath.sortValIndex : 0,
            disabledValueIndices
        };
    }

    if (typeof configOrPath === 'string' && configOrPath) {
        return {
            title: titleToLoad ?? 'TC Data Column',
            selections: [configOrPath],
            sortCol: 'val',
            sortDir: -1,
            sortValIndex: 0,
            disabledValueIndices: []
        };
    }

    return {
        title: titleToLoad ?? 'TC Data Column',
        selections: [],
        sortCol: 'val',
        sortDir: -1,
        sortValIndex: 0,
        disabledValueIndices: []
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
        sortValIndex: config.sortValIndex,
        analysisDisabledValueIndices: new Set(config.disabledValueIndices)
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
    pruneAnalysisDisabledValueIndices(col);

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

    const removedIndex = col.selections.findIndex(s => s.id === selectionId);

    col.selections = col.selections.filter(s => s.id !== selectionId);
    const selEl = document.getElementById(`selector-${colId}-${selectionId}`);
    if (selEl) selEl.remove();

    if (removedIndex >= 0 && col.analysisDisabledValueIndices instanceof Set) {
        const remapped = new Set();
        col.analysisDisabledValueIndices.forEach(idx => {
            if (!Number.isInteger(idx)) return;
            if (idx === removedIndex) return;
            remapped.add(idx > removedIndex ? idx - 1 : idx);
        });
        col.analysisDisabledValueIndices = remapped;
    }

    if (col.sortValIndex >= col.selections.length) {
        col.sortValIndex = Math.max(0, col.selections.length - 1);
    }

    if (col.selections.length === 0) {
        addSelectionControl(colId, null, false);
    }

    pruneAnalysisDisabledValueIndices(col);

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
        const isAnalysisEnabled = isAnalysisValueEnabled(col, idx);
        return `
            <th class="th-sortable value-col ${isAnalysisEnabled ? '' : 'analysis-col-disabled'}" onclick="toggleSort('${col.id}', 'val', ${idx})" title="${fullLabel}">
                <span class="value-header-label">${label}</span>
                <label class="analysis-col-toggle" title="Include this TC column in Basic Analysis" onclick="event.stopPropagation()">
                    <input
                        type="checkbox"
                        ${isAnalysisEnabled ? 'checked' : ''}
                        aria-label="Include ${label} in Basic Analysis"
                        onclick="event.stopPropagation()"
                        onchange="handleAnalysisValueToggle('${col.id}', ${idx}, this.checked, event)"
                    >
                </label>
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

function handleAnalysisValueToggle(colId, valueIndex, isEnabled, event) {
    if (event) event.stopPropagation();
    setAnalysisValueEnabled(colId, valueIndex, isEnabled);
    renderColumn(colId, true);
}

function getLongestVariableLength(rows, showVar2) {
    let longest = 4;
    rows.forEach(item => {
        if (item.v1) longest = Math.max(longest, item.v1.length);
        if (showVar2 && item.v2) longest = Math.max(longest, item.v2.length);
    });
    return longest;
}

function getScientificTextLength(value) {
    if (!Number.isFinite(value)) {
        return String(value).length;
    }
    if (value === 0) {
        return '0.00e0'.length;
    }

    const [mantissaRaw, exponentRaw] = value.toExponential(2).split('e');
    const mantissa = Number(mantissaRaw).toFixed(2);
    const exponent = Number(exponentRaw);
    return `${mantissa}e${exponent}`.length;
}

function computeTableWidths(col, showVar2, longestVarLength, longestValueLength) {
    const valueCount = Math.max(1, col.selections.length);
    const varColCount = showVar2 ? 2 : 1;

    const targetVarWidth = Math.ceil(longestVarLength * MONO_CHAR_WIDTH_PX + VAR_CELL_PADDING_PX);
    const varWidth = Math.max(VAR_COL_MIN_WIDTH, Math.min(VAR_COL_MAX_WIDTH, targetVarWidth));

    const baseValueWidth = Math.max(
        VALUE_CELL_MIN_WIDTH,
        Math.ceil(longestValueLength * MONO_CHAR_WIDTH_PX + VALUE_CELL_PADDING_PX)
    );

    const minContentWidth = (varColCount * varWidth) + (valueCount * baseValueWidth);
    const totalWidth = Math.max(COLUMN_BASE_MIN_WIDTH, minContentWidth);
    const extraWidth = totalWidth - minContentWidth;
    const valueWidth = baseValueWidth + (extraWidth / valueCount);

    return {
        varWidth,
        valueWidth,
        totalWidth
    };
}

function applyColumnWidth(colId, totalWidth) {
    const columnEl = document.getElementById(`col-${colId}`);
    if (!columnEl || !Number.isFinite(totalWidth)) return;

    const widthPx = Math.ceil(totalWidth);
    columnEl.style.width = `${widthPx}px`;
    columnEl.style.minWidth = `${widthPx}px`;
    columnEl.style.flex = `0 0 ${widthPx}px`;
}

function renderColgroup(col, showVar2, widths) {
    const colgroup = document.getElementById(`colgroup-${col.id}`);
    if (!colgroup) return;

    const { varWidth, valueWidth } = widths;
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

function isAnalysisValueEnabled(col, valueIndex) {
    if (!col || !(col.analysisDisabledValueIndices instanceof Set)) {
        return true;
    }

    return !col.analysisDisabledValueIndices.has(valueIndex);
}

function setAnalysisValueEnabled(colId, valueIndex, isEnabled) {
    const col = columns.find(c => c.id === colId);
    if (!col) return;

    if (!(col.analysisDisabledValueIndices instanceof Set)) {
        col.analysisDisabledValueIndices = new Set();
    }

    if (isEnabled) {
        col.analysisDisabledValueIndices.delete(valueIndex);
    } else {
        col.analysisDisabledValueIndices.add(valueIndex);
    }

    refreshBasicAnalysisPanel();
    requestPermalinkUpdate();
}

function pruneAnalysisDisabledValueIndices(col) {
    if (!col) return;

    if (!(col.analysisDisabledValueIndices instanceof Set)) {
        col.analysisDisabledValueIndices = new Set();
        return;
    }

    const maxValueIndex = col.selections.length - 1;
    const pruned = new Set();

    col.analysisDisabledValueIndices.forEach(valueIndex => {
        if (!Number.isInteger(valueIndex) || valueIndex < 0 || valueIndex > maxValueIndex) return;
        pruned.add(valueIndex);
    });

    col.analysisDisabledValueIndices = pruned;
}

function isRowIncludedInBasicAnalysis(col, row) {
    if (!row || !Array.isArray(row.values)) {
        return false;
    }

    return row.values.some((value, idx) => Number.isFinite(value) && isAnalysisValueEnabled(col, idx));
}

function getRowsForBasicAnalysis(col, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    return rows.filter(row => isRowIncludedInBasicAnalysis(col, row));
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

function getVariableSetFromRowsByAlpha(col, rows, alpha) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return new Set();
    }

    let maxValue = Number.NEGATIVE_INFINITY;
    rows.forEach(row => {
        row.values.forEach((value, idx) => {
            if (!isAnalysisValueEnabled(col, idx)) return;
            if (Number.isFinite(value) && value > maxValue) {
                maxValue = value;
            }
        });
    });

    if (!Number.isFinite(maxValue)) {
        return new Set();
    }

    const threshold = alpha * maxValue;
    const vars = new Set();

    rows.forEach(row => {
        const hasPassingValue = row.values.some((value, idx) => {
            if (!isAnalysisValueEnabled(col, idx)) return false;
            return Number.isFinite(value) && value > threshold;
        });

        if (!hasPassingValue) return;
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
        const rows = getRowsForBasicAnalysis(col, Array.isArray(col.visibleRows) ? col.visibleRows : []);
        return {
            name: getColumnDisplayName(col, idx),
            vars: getVariableSetFromRows(rows, nRows)
        };
    });

    let html = `<p class="analysis-meta">Using first ${nRows} visible rows per column with at least one analysis-enabled TC value (respecting each column's current sort and filters).</p>`;
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
        const rows = getRowsForBasicAnalysis(col, Array.isArray(col.visibleRows) ? col.visibleRows : []);
        return {
            name: getColumnDisplayName(col, idx),
            vars: getVariableSetFromRowsByAlpha(col, rows, alpha)
        };
    });

    let html = `<p class="analysis-meta">Using rows where at least one analysis-enabled TC value is greater than alpha times the per-column maximum enabled TC value (alpha = ${alpha}).</p>`;
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
    let longestValueLength = Math.max(4, ...col.selections.map((_, idx) => `TC ${idx + 1}`.length));

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
            longestValueLength = Math.max(longestValueLength, getScientificTextLength(val));
        });

        filteredEntries.push(item);
    });

    const longestVarLength = getLongestVariableLength(filteredEntries, showVar2);
    const widths = computeTableWidths(col, showVar2, longestVarLength, longestValueLength);
    applyColumnWidth(col.id, widths.totalWidth);
    renderColgroup(col, showVar2, widths);
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
            const isAnalysisEnabled = isAnalysisValueEnabled(col, idx);
            tdValue.classList.toggle('analysis-col-disabled', !isAnalysisEnabled);

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
            sortValIndex: col.sortValIndex,
            disabledValueIndices: Array.from(col.analysisDisabledValueIndices ?? [])
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

/**
 * Standalone Tree-Integrated Wildcard & Granular Sync Manager (Self-Parsing & Synchronous)
 */
(function() {
    let isUpdating = false;
    let isTriggeringLoad = false;

    // 1. Inject Styles with Flex Overrides
    const style = document.createElement('style');
    style.innerHTML = `
        .dropdown-content li > span,
        .dropdown-content li.file-item {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            width: 100% !important;
            box-sizing: border-box !important;
            padding: 8px 14px !important;
        }
        .wildcard-controls-container {
            margin-top: 8px;
            padding: 8px 10px;
            border: 1px dashed var(--border);
            border-radius: 6px;
            background: var(--bg-panel-alt);
            display: flex;
            flex-direction: column;
            gap: 6px;
            width: 100%;
            box-sizing: border-box;
        }
        .wildcard-level-row {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 13px;
        }
        .wildcard-select {
            padding: 3px 6px;
            border: 1px solid var(--border);
            border-radius: 4px;
            font-size: 13px;
            background: var(--bg-panel);
            color: var(--text);
            flex-grow: 1;
            min-width: 0;
        }
        .syncCheckbox {
            width: 16px;
            height: 16px;
            accent-color: var(--button, #1d4ed8);
            cursor: pointer;
            margin: 0;
            flex-shrink: 0;
        }
        .dropdown-tree-chk {
            width: 14px;
            height: 14px;
            accent-color: var(--button, #1d4ed8);
            cursor: pointer;
            margin: 0;
            flex-shrink: 0;
        }
    `;
    document.head.appendChild(style);

    // Clean text nodes from folder markers
    function getCleanText(node) {
        const clone = node.cloneNode(true);
        const injected = clone.querySelectorAll('.dropdown-tree-chk');
        injected.forEach(el => el.remove());
        return clone.textContent.replace(/[▸▾\s]+/g, '').trim();
    }

    // Determine exact folder depth (0-indexed)
    function getLiDepth(li) {
        let depth = 0;
        let parent = li.parentElement.closest('ul');
        while (parent) {
            if (parent.parentElement.classList.contains('dropdown-content')) {
                break;
            }
            depth++;
            parent = parent.parentElement.closest('ul');
        }
        return depth;
    }

    // Reconstruct list item path
    function getItemPath(item) {
        const pathParts = [];
        let current = item.closest('li');
        while (current) {
            const span = current.querySelector(':scope > span');
            const text = span ? getCleanText(span) : getCleanText(current);
            if (text) {
                pathParts.unshift(text);
            }
            current = current.parentElement.closest('li');
        }
        return pathParts.join('/');
    }

    // Parse options directly from the global folderStructure object
    function getOptionsAtDepth(structure, selectedPath) {
        let current = structure || folderStructure;
        for (let segment of selectedPath) {
            if (current && typeof current === 'object' && segment in current) {
                current = current[segment];
            } else {
                return null;
            }
        }
        if (!current) return null;
        const folders = Object.keys(current).filter(key => key !== 'files');
        const files = current.files || [];
        return { folders, files };
    }

    // Force native file loader
    function triggerNativeFileLoad(colId, selectionId) {
        const col = columns.find(c => c.id === colId);
        if (!col) return;

        const sel = col.selections.find(s => s.id === selectionId);
        if (!sel || !sel._selectedPath) return;

        const baseSegment = (folderStructure && !('data' in folderStructure)) ? 'data' : '';
        const fullPath = baseSegment ? [baseSegment, ...sel._selectedPath].join('/') : sel._selectedPath.join('/');

        isTriggeringLoad = true;
        try {
            loadSelectionFile(colId, selectionId, fullPath, true);
        } finally {
            isTriggeringLoad = false;
        }
    }

    // Re-resolve active paths
    function updateSubtreeSelections(sel, startIdx) {
        for (let i = startIdx; i < sel._selectedPath.length; i++) {
            const opts = getOptionsAtDepth(folderStructure, sel._selectedPath.slice(0, i));
            if (!opts) break;

            const available = opts.folders.length > 0 ? opts.folders : opts.files;
            if (available && available.length > 0) {
                const currentVal = sel._selectedPath[i];
                if (!available.includes(currentVal)) {
                    sel._selectedPath[i] = available[0];
                }
            }
        }
    }

    // Sync changed paths ONLY if both target and source have this row's sync checkbox checked
    function handleWildcardSelectChange(colId, selectionId, levelIdx, newValue) {
        if (isUpdating) return;

        const col = columns.find(c => c.id === colId);
        if (!col) return;

        const sel = col.selections.find(s => s.id === selectionId);
        if (!sel) return;

        sel._selectedPath[levelIdx] = newValue;
        updateSubtreeSelections(sel, levelIdx + 1);

        const syncCheckbox = document.getElementById('sync-columns-chk');
        const globalSyncActive = syncCheckbox ? syncCheckbox.checked : false;

        if (globalSyncActive && sel._checkedLevels && sel._checkedLevels[levelIdx]) {
            isUpdating = true;
            try {
                columns.forEach(otherCol => {
                    if (otherCol.id === colId) return;

                    otherCol.selections.forEach(otherSel => {
                        if (
                            otherSel._wildcardEnabledLevels && otherSel._wildcardEnabledLevels[levelIdx] &&
                            otherSel._checkedLevels && otherSel._checkedLevels[levelIdx] && 
                            otherSel._selectedPath
                        ) {
                            otherSel._selectedPath[levelIdx] = newValue;
                            updateSubtreeSelections(otherSel, levelIdx + 1);
                            triggerNativeFileLoad(otherCol.id, otherSel.id);
                        }
                    });
                });
            } finally {
                isUpdating = false;
            }
        }

        updateAllWildcardControls();
        triggerNativeFileLoad(colId, selectionId);
    }

    // Inject checkboxes into original dropdown elements
    function injectTreeCheckboxes(colId, selectionId) {
        const dropdown = document.getElementById(`dropdown-${colId}-${selectionId}`);
        if (!dropdown) return;

        const col = columns.find(c => c.id === colId);
        if (!col) return;
        const sel = col.selections.find(s => s.id === selectionId);
        if (!sel) return;

        if (!sel._wildcardEnabledLevels) sel._wildcardEnabledLevels = {};

        const items = dropdown.querySelectorAll('li > span, li.file-item');
        items.forEach(item => {
            if (item.querySelector('.dropdown-tree-chk')) return;

            const li = item.closest('li');
            if (!li) return;

            const depth = getLiDepth(li);

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'dropdown-tree-chk';
            chk.checked = !!sel._wildcardEnabledLevels[depth];

            chk.addEventListener('click', (e) => {
                e.stopPropagation();
                sel._wildcardEnabledLevels[depth] = chk.checked;

                // Unify sibling checks at this depth
                const siblings = Array.from(dropdown.querySelectorAll('li')).filter(sib => getLiDepth(sib) === depth);
                siblings.forEach(sib => {
                    const sibChk = sib.querySelector('.dropdown-tree-chk');
                    if (sibChk) sibChk.checked = chk.checked;
                });

                updateAllWildcardControls();
                generatePermalink(); // Force permalink state serialization update
            });

            item.appendChild(chk);
        });
    }

    // Get globally active level indices across entire dashboard
    function getGloballyActiveLevels() {
        const active = new Set();
        columns.forEach(c => {
            c.selections.forEach(s => {
                if (s._wildcardEnabledLevels) {
                    Object.entries(s._wildcardEnabledLevels).forEach(([lvl, isEnabled]) => {
                        if (isEnabled) active.add(Number(lvl));
                    });
                }
            });
        });
        return active;
    }

    // Global layout recalculation trigger
    function updateAllWildcardControls() {
        columns.forEach(col => {
            col.selections.forEach(sel => {
                renderWildcardControls(col.id, sel.id);
            });
        });
    }

    // Render selects inside .column-header.
    function renderWildcardControls(colId, selectionId) {
        const col = columns.find(c => c.id === colId);
        if (!col) return;

        const sel = col.selections.find(s => s.id === selectionId);
        if (!sel || !sel._selectedPath) return;

        const columnEl = document.getElementById(`col-${colId}`);
        if (!columnEl) return;

        const header = columnEl.querySelector('.column-header');
        if (!header) return;

        let container = header.querySelector(`.wildcard-controls-container-${selectionId}`);
        if (!container) {
            container = document.createElement('div');
            container.className = `wildcard-controls-container wildcard-controls-container-${selectionId}`;
            header.appendChild(container);
        }

        // Focus Preservation Hook
        const activeEl = document.activeElement;
        let focusedLevelIdx = null;
        if (activeEl && activeEl.classList.contains('wildcard-select') && activeEl.closest(`.wildcard-controls-container-${selectionId}`)) {
            focusedLevelIdx = Number(activeEl.getAttribute('data-level'));
        }

        container.innerHTML = '';

        const globallyActiveLevels = getGloballyActiveLevels();
        if (globallyActiveLevels.size === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';

        sel._selectedPath.forEach((segment, levelIdx) => {
            if (!globallyActiveLevels.has(levelIdx)) return;

            const row = document.createElement('div');
            row.className = 'wildcard-level-row';

            if (!sel._wildcardEnabledLevels || !sel._wildcardEnabledLevels[levelIdx]) {
                row.style.visibility = 'hidden';
                row.style.height = '25px';
                row.innerHTML = '&nbsp;';
                container.appendChild(row);
                return;
            }

            const select = document.createElement('select');
            select.className = 'wildcard-select';
            select.setAttribute('data-level', levelIdx);

            const parentPath = sel._selectedPath.slice(0, levelIdx);
            const opts = getOptionsAtDepth(folderStructure, parentPath);

            if (opts) {
                const pool = opts.folders.length > 0 ? opts.folders : opts.files;
                pool.forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.textContent = opt;
                    select.appendChild(option);
                });
                select.value = segment;
            }

            select.addEventListener('change', () => {
                handleWildcardSelectChange(colId, selectionId, levelIdx, select.value);
            });

            row.appendChild(select);

            // Syncing checkbox
            const syncChk = document.createElement('input');
            syncChk.type = 'checkbox';
            syncChk.className = 'syncCheckbox';

            if (!sel._checkedLevels) sel._checkedLevels = {};
            if (sel._checkedLevels[levelIdx] === undefined) sel._checkedLevels[levelIdx] = true;
            syncChk.checked = !!sel._checkedLevels[levelIdx];

            syncChk.addEventListener('change', () => {
                sel._checkedLevels[levelIdx] = syncChk.checked;
                generatePermalink(); // Force permalink state serialization update
            });

            row.appendChild(syncChk);

            container.appendChild(row);
        });

        if (focusedLevelIdx !== null) {
            const selectToFocus = container.querySelector(`.wildcard-select[data-level="${focusedLevelIdx}"]`);
            if (selectToFocus) selectToFocus.focus();
        }
    }

    function initSelectionWildcards(colId, selectionId, filePath) {
        const col = columns.find(c => c.id === colId);
        if (!col) return;

        const sel = col.selections.find(s => s.id === selectionId);
        if (!sel) return;

        const segments = filePath.split('/');
        const cleanSegments = (segments.length > 0 && segments[0].toLowerCase() === 'data' && folderStructure && !('data' in folderStructure))
            ? segments.slice(1)
            : segments;

        sel._selectedPath = cleanSegments;

        // Apply permalink restore state if cached in memory
        const colIdx = columns.indexOf(col);
        const selIdx = col.selections.indexOf(sel);
        let cachedState = null;
        if (colIdx !== -1 && selIdx !== -1 && restoredWildcardStates[colIdx]) {
            cachedState = restoredWildcardStates[colIdx][selIdx];
        }

        if (cachedState) {
            sel._wildcardEnabledLevels = cachedState.enabledLevels || {};
            sel._checkedLevels = cachedState.checkedLevels || {};
            // Consume cache row to prevent multiple overrides on subsequent actions
            restoredWildcardStates[colIdx][selIdx] = null;
        } else {
            if (!sel._wildcardEnabledLevels) sel._wildcardEnabledLevels = {};
            if (!sel._checkedLevels) sel._checkedLevels = {};
        }

        injectTreeCheckboxes(colId, selectionId);
        renderWildcardControls(colId, selectionId);
    }

    // Intercept native toggle dropdown lexically
    const originalToggleDropdown = toggleDropdown;
    toggleDropdown = function(colId, selectionId) {
        originalToggleDropdown(colId, selectionId);
        injectTreeCheckboxes(colId, selectionId);
    };

    // Synchronous execution hooked to renderColumn. Executes exactly when the active file load completes.
    const originalRenderColumn = renderColumn;
    renderColumn = function(colId, suppressAnalysisRefresh) {
        originalRenderColumn(colId, suppressAnalysisRefresh);

        if (isTriggeringLoad) return;

        const col = columns.find(c => c.id === colId);
        if (!col) return;

        col.selections.forEach(sel => {
            if (sel.path) {
                initSelectionWildcards(colId, sel.id, sel.path);
            }
        });
    };

    // 2. LEXICAL PERMALINK ENGINES INTERCEPTION

    // Save State Hook: Redefine lexical generator to include wildcard selections
    const originalGeneratePermalink = generatePermalink;
    generatePermalink = function() {
        originalGeneratePermalink(); // Run original to establish basic state params

        const params = new URLSearchParams(window.location.search);
        const stateParam = params.get('state');
        if (!stateParam) return;

        try {
            const state = JSON.parse(stateParam);
            if (state && Array.isArray(state.columns)) {
                // Populate parallel properties alongside column definitions
                state.columns.forEach((colConfig, colIdx) => {
                    const nativeCol = columns[colIdx];
                    if (nativeCol) {
                        colConfig.wildcardStates = nativeCol.selections.map(sel => ({
                            enabledLevels: sel._wildcardEnabledLevels || {},
                            checkedLevels: sel._checkedLevels || {}
                        }));
                    }
                });

                params.set('state', JSON.stringify(state));
                const query = params.toString();
                const permalink = query ? `${location.pathname}?${query}` : location.pathname;
                window.history.replaceState({}, '', permalink);
            }
        } catch (e) {
            console.error("Wildcard permalink serialization failed:", e);
        }
    };

    // Self-Parsing URL context resolver (100% decoupled from async lifecycle)
    function parseWildcardStatesFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const stateParam = params.get('state');
        if (stateParam) {
            try {
                const state = JSON.parse(stateParam);
                if (state && Array.isArray(state.columns)) {
                    return state.columns.map(col => col.wildcardStates || []);
                }
            } catch (e) {
                console.error("Failed to parse wildcard states from URL:", e);
            }
        }
        return [];
    }

    let restoredWildcardStates = parseWildcardStatesFromUrl();
})();
