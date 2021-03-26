'use strict';

const { remote, shell, ipcRenderer } = require('electron');
const fs = require('fs');
const customTitlebar = require('custom-electron-titlebar');
const defaultDataDir = remote.app.getPath("userData");
const { EditorState } = require("prosemirror-state");
const { EditorView } = require("prosemirror-view");
//const { exampleSetup } = require("prosemirror-example-setup");
const { exampleSetup } = require("./prosemirror/setup");
const { Schema } = require('prosemirror-model');
const { schema } = require('./prosemirror/schema');
const { tableNodes } = require('prosemirror-tables');
const { addListNodes } = require('prosemirror-schema-list');
const contextMenu = require('electron-context-menu');



let tableSchema = new Schema({
    nodes: schema.spec.nodes.append(tableNodes({
        tableGroup: "block",
        cellContent: "block+",
        cellAttributes: {
            background: {
                default: null,
                getFromDOM(dom) { return dom.style.backgroundColor || null },
                setDOMAttr(value, attrs) { if (value) attrs.style = (attrs.style || "") + `background-color: ${value};` }
            }
        }
    })),
    marks: schema.spec.marks
});

var mySchema = new Schema({
    nodes: addListNodes(tableSchema.spec.nodes, "paragraph block*", "block"),
    marks: tableSchema.spec.marks
});

tableSchema = null;

alert = function (msg, det = null) {
    var options = {
        type: 'error',
        buttons: ["Ok"],
        defaultId: 0,
        cancelId: 0,
        detail: (det != null) ? det : 'Please report this error to support@codexnotes.com',
        message: msg
    }
    remote.dialog.showMessageBox(remote.getCurrentWindow(), options);
}

function popup(title, mes, det) {
    var options = {
        type: 'info',
        buttons: ["Ok"],
        defaultId: 0,
        cancelId: 0,
        detail: det,
        title: title,
        message: mes
    }
    remote.dialog.showMessageBox(remote.getCurrentWindow(), options);
}

class UserPrefs {
    theme = "0";
    codeStyle = "atom-one-dark";
    accentColor = "#FF7A27";
    defaultZoom = 1.0;
    defaultMaximized = false;
    dataDir = defaultDataDir;
    pdfBreakOnH1 = false;
    pdfDarkMode = false;
    openPDFonExport = true;
    openedNotebooks = [];
    tabSize = 4;
}

class Save {
    nextPageIndex = 0;
    notebooks = [];
}

class Notebook {
    name;
    color;
    pages = [];
    constructor(name, color) {
        this.name = name;
        this.color = color;
        this.pages = [];
    }
}

class Page {
    title;
    fileName;
    favorite = false;
    constructor(title) {
        this.title = title;
        this.fileName = "";
    }
}

window.onbeforeunload = (e) => {


    //cache which notebooks are opened
    prefs.openedNotebooks = [];


    if (destroyOpenedNotebooks == false) {
        for (let i = 0; i < save.notebooks.length; i++) {

            let nbList = document.getElementById(`nb-${i}-list`);
            if (nbList.classList.contains('show')) {
                prefs.openedNotebooks[prefs.openedNotebooks.length] = i;
            }
        }
    }


    saveData();
    savePrefs();
}

var darkStyleLink;

var save;
var prefs;
var selectedPage;
var selectedPageContent;

var rightClickedNotebookIndex;
// PAGE INDEX IS LOCAL TO THE NOTEBOOK
var rightClickedPageIndex;

var expandedNotebooks = [];
var activePage;

var draggedNotebookIndex;
var draggedPageIndex;
var draggedPagesNotebookIndex;
var draggingNotebook = false;
var draggingPage = false;

var fadeInSaveIndicator;

var canSaveData = false;
var canSavePrefs = false;
var zoomLevel = 1.000;
var titlebar;
var normalMenu;
var editingMenu;
var sidebarOpen = true;

var favoritePages = [];

var destroyOpenedNotebooks = false;


/**
 * Run this function at start.
 */
function init() {

    contextMenu({
        showSearchWithGoogle: false,
        showLookUpSelection: false
    });

    if (remote.process.platform === 'win32') {
        titlebar = new customTitlebar.Titlebar({
            backgroundColor: customTitlebar.Color.fromHex('#343A40'),
            unfocusEffect: true,
            icon: './icons/icon.ico'
        });


        document.getElementById('editorRibbon').style.marginTop = "40px";
    }

    normalMenu = new remote.Menu();
    normalMenu.append(new remote.MenuItem({
        label: 'File',
        submenu: [
            {
                label: 'New Notebook',
                accelerator: 'CmdOrCtrl+N',
                click: () => $('#newNotebookModal').modal('show')
            },
            {
                type: 'separator'
            },
            {
                label: 'Exit',
                click: () => remote.app.exit()
            }
        ]
    }));

    normalMenu.append(new remote.MenuItem({
        label: 'View',
        submenu: [
            {
                label: 'Toggle Sidebar',
                accelerator: 'CmdOrCtrl+D',
                click: () => toggleSidebar()
            }/*,
      {
        label: 'Open Dev Tools',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => remote.getCurrentWebContents().openDevTools()
      }*/
        ]
    }));

    normalMenu.append(new remote.MenuItem({
        label: 'Help',
        submenu: [
            {
                label: 'Help',
                accelerator: 'F1',
                click: () => {
                    let tab = document.getElementById('helpTab');
                    if (tab.getAttribute('aria-expanded') != "true") {
                        $('#helpTab').click();
                    }

                    document.querySelectorAll('.my-sidebar-link').forEach(function (item) {
                        item.classList.toggle('active', false);
                    });
                    let page = document.getElementById('firstHelpPage');
                    page.classList.toggle('active', true);

                    showHelpPage();
                    loadHelpPage('howtouse.html');
                }
            },
            {
                label: 'Website',
                click: () => shell.openExternal('https://www.codexnotes.com/')
            },
            {
                label: 'Update notes',
                click: () => shell.openExternal('https://www.codexnotes.com/updates/')
            },
            {
                type: 'separator'
            },
            {
                label: 'About',
                click: () => openAboutPage()
            }
        ]
    }));


    editingMenu = new remote.Menu();
    editingMenu.append(new remote.MenuItem({
        label: 'File',
        submenu: [
            {
                label: 'New Notebook',
                accelerator: 'CmdOrCtrl+N',
                click: () => $('#newNotebookModal').modal('show')
            },
            {
                label: 'Save Page',
                accelerator: 'CmdOrCtrl+S',
                click: () => saveSelectedPage(true)
            },
            {
                type: 'separator'
            },
            {
                label: 'Export page to PDF...',
                accelerator: 'CmdOrCtrl+P',
                click: () => printPage()
            },
            {
                type: 'separator'
            },
            {
                label: 'Exit',
                click: () => remote.app.exit()
            }
        ]
    }));

    editingMenu.append(new remote.MenuItem({
        label: 'Edit',
        submenu: [
            {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                click: () => document.execCommand("cut")
            },
            {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                click: () => document.execCommand("copy")
            },
            {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                click: () => document.execCommand("paste")
            }
        ]
    }));

    editingMenu.append(new remote.MenuItem({
        label: 'View',
        submenu: [
            {
                label: 'Zoom In',
                accelerator: 'CmdOrCtrl+=',
                click: () => zoomIn()
            },
            {
                label: 'Zoom Out',
                accelerator: 'CmdOrCtrl+-',
                click: () => zoomOut()
            },
            {
                label: 'Restore Default Zoom',
                accelerator: 'CmdOrCtrl+R',
                click: () => defaultZoom()
            },
            {
                type: 'separator'
            },
            {
                label: 'Toggle Sidebar',
                accelerator: 'CmdOrCtrl+D',
                click: () => toggleSidebar()
            },
            {
                label: 'Toggle Editor Toolbar',
                accelerator: 'CmdOrCtrl+T',
                click: () => toggleEditorRibbon()
            }/*,
      {
        type: 'separator'
      },
      {
        label: 'Open Dev Tools',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: () => remote.getCurrentWebContents().openDevTools()
      }*/
        ]
    }));

    editingMenu.append(new remote.MenuItem({
        label: 'Help',
        submenu: [
            {
                label: 'Help',
                accelerator: 'F1',
                click: () => {
                    let tab = document.getElementById('helpTab');
                    if (tab.getAttribute('aria-expanded') != "true") {
                        $('#helpTab').click();
                    }

                    document.querySelectorAll('.my-sidebar-link').forEach(function (item) {
                        item.classList.toggle('active', false);
                    });
                    let page = document.getElementById('firstHelpPage');
                    page.classList.toggle('active', true);

                    showHelpPage();
                    loadHelpPage('howtouse.html');
                }
            },
            {
                label: 'Website',
                click: () => shell.openExternal('https://www.codexnotes.com/')
            },
            {
                label: 'Update notes',
                click: () => shell.openExternal('https://www.codexnotes.com/updates/')
            },
            {
                type: 'separator'
            },
            {
                label: 'About',
                click: () => openAboutPage()
            }
        ]
    }));


    remote.Menu.setApplicationMenu(normalMenu);
    if (remote.process.platform === 'win32') {
        titlebar.updateMenu(normalMenu);
    }

    document.getElementById('revertToDefaultDataDirBtnTooltip').title = "Revert to" + defaultDataDir;
    $('#revertToDefaultDataDirBtnTooltip').tooltip();
    $('#dataDirButton').tooltip();

    //HIGHLIGHT THE EXAMPLE CODE IN THE SETTINGS PAGE
    let hljs = require("highlight.js/lib/core");  // require only the core library
    // separately require languages
    hljs.registerLanguage('cpp', require('highlight.js/lib/languages/cpp'));

    document.getElementById('exampleCode').innerHTML = hljs.highlight('cpp', document.getElementById('exampleCode').innerText).value;

    hljs = null;


    //get user preferences
    if (fs.existsSync(defaultDataDir + "/prefs.json")) {
        try {
            let json = fs.readFileSync(defaultDataDir + "/prefs.json", 'utf8');
            prefs = JSON.parse(json);
            fixPrefs();
            applyPrefsFromFile();
            canSavePrefs = true;
        }
        catch (err) {
            alert('Your preferences file could not be parsed correctly.', 'Please make sure your prefs.json JSON file is intact');
        }
    }
    else {
        prefs = new UserPrefs();
        canSavePrefs = true;
        savePrefs();
        applyPrefsFromFile();
    }

    //get notebooks save file
    if (fs.existsSync(prefs.dataDir + "/save.json")) {
        try {
            let json = fs.readFileSync(prefs.dataDir + "/save.json", 'utf8');
            save = JSON.parse(json);
            canSaveData = true;
        }
        catch (err) {
            canSaveData = false;
            alert('Your save file could not be parsed correctly.', 'Please make sure your save.json JSON file is intact');
        }
    }
    else {
        save = new Save();
        save.notebooks = [];
        save.nextPageIndex = 0;
        canSaveData = true;
        saveData();
    }

    if (fs.existsSync(prefs.dataDir + "/notes/") == false) {
        fs.mkdirSync(prefs.dataDir + "/notes/");
    }

    addSidebarLinkEvents();

    if (remote.process.platform === 'win32') {
        document.getElementById('mainContainer').style.height = `${document.body.clientHeight - 30}px`;
    }
    else {
        document.getElementById('mainContainer').style.height = `${document.body.clientHeight}px`;
    }


    window.addEventListener('resize', () => {

        if (remote.process.platform === 'win32') {
            document.getElementById('mainContainer').style.height = `${document.body.clientHeight - 30}px`;
        }
        else {
            document.getElementById('mainContainer').style.height = `${document.body.clientHeight}px`;
        }

    });

    applyModalEventHandlers();

    displayNotebooks();

    // open the notebooks which were open before
    for (let i = 0; i < prefs.openedNotebooks.length; i++) {
        try {
            let nbList = document.getElementById(`nb-${prefs.openedNotebooks[i]}-list`);
            nbList.classList.add('show');
        }
        catch (error) {
            console.error(error);
        }
    }

    feather.replace();



    document.execCommand("enableObjectResizing", false, false)
    document.execCommand("enableInlineTableEditing", false, false)


    // first time use tutorial
    if (save.notebooks.length <= 0) {
        //probably first use
        setTimeout(() => { $("#tutorialModal1").modal('show') }, 500);
    }

}

init();

/**
 * Saves the 'save' file which contains the notebooks and stuff.
 */
function saveData() {
    if (canSaveData) {
        try {
            fs.writeFileSync(prefs.dataDir + "/save.json", JSON.stringify(save, null, 2), 'utf8');
            saveSelectedPage();
        }
        catch (err) {
            alert(err.toString());
        }
    }
}

/**
 * Saves the content of the 'selected page' to that page's individual TXT file.
 */
function saveSelectedPage(showIndicator = false) {
    if (selectedPage != null && canSaveData) {

        try {
            let cont = JSON.stringify(window.view.state.doc.toJSON());

            fs.writeFileSync(prefs.dataDir + "/notes/" + selectedPage.fileName, cont, 'utf8');

            let title = selectedPage.title;
            if (title.length > 40) {
                title = title.substring(0, 40) + "...";
            }

            if (showIndicator) {
                clearTimeout(fadeInSaveIndicator);

                document.getElementById('saveIndicatorTitle').innerText = `"${title}" saved!`
                document.getElementById('saveIndicator').style.opacity = 1;

                fadeInSaveIndicator = setTimeout(() => {
                    document.getElementById('saveIndicator').style.opacity = 0;
                }, 3000);
            }
        }
        catch (err) {
            alert(err.toString());
        }
    }
}

function fixPrefs() {
    if (typeof prefs.theme === "undefined")
        prefs.theme = "0";
    if (typeof prefs.codeStyle === "undefined")
        prefs.codeStyle = "atom-one-dark";
    if (typeof prefs.accentColor === "undefined")
        prefs.accentColor = "#FF7A27";
    if (typeof prefs.defaultZoom === "undefined")
        prefs.defaultZoom = 1.0;
    if (typeof prefs.defaultMaximized === "undefined")
        prefs.defaultMaximized = false;
    if (typeof prefs.dataDir === "undefined")
        prefs.dataDir = defaultDataDir;
    if (typeof prefs.pdfBreakOnH1 === "undefined")
        prefs.pdfBreakOnH1 = false;
    if (typeof prefs.pdfDarkMode === "undefined")
        prefs.pdfDarkMode = false;
    if (typeof prefs.openPDFonExport === "undefined")
        prefs.openPDFonExport = true;
    if (typeof prefs.openedNotebooks === "undefined")
        prefs.openedNotebooks = [];
    if (typeof prefs.tabSize === "undefined")
        prefs.tabSize = 4;
}

/**
 * Save's the user prefs to the prefs JSON file.
 */
function savePrefs() {
    if (canSavePrefs) {
        prefs.defaultMaximized = remote.getCurrentWindow().isMaximized();

        if (destroyOpenedNotebooks) {
            prefs.openedNotebooks = [];
        }

        try {
            fs.writeFileSync(defaultDataDir + "/prefs.json", JSON.stringify(prefs, null, 2), 'utf8');
        }
        catch (err) {
            alert(err.toString());
        }
    }
}

/**
 * This function is run at the start and applies all prefs found in the prefs JSON file.
 */
function applyPrefsFromFile() {
    document.getElementById('themeSelect').value = prefs.theme;
    let header = document.getElementsByTagName('head')[0];
    if (prefs.theme == 1) {
        darkStyleLink = document.createElement('link');
        darkStyleLink.rel = 'stylesheet';
        darkStyleLink.type = 'text/css';
        darkStyleLink.href = 'css/dark.css';
        darkStyleLink.media = 'all';
        header.appendChild(darkStyleLink);
        remote.nativeTheme.themeSource = "dark";
    }
    else if (prefs.theme == 0) {
        remote.nativeTheme.themeSource = "light";
        if (darkStyleLink != null) {
            header.removeChild(darkStyleLink);
            darkStyleLink = null;
        }
    }
    else if (prefs.theme == 2) {
        remote.nativeTheme.themeSource = "system";
        if (remote.nativeTheme.shouldUseDarkColors) {
            darkStyleLink = document.createElement('link');
            darkStyleLink.rel = 'stylesheet';
            darkStyleLink.type = 'text/css';
            darkStyleLink.href = 'css/dark.css';
            darkStyleLink.media = 'all';
            header.appendChild(darkStyleLink);
        }
    }
    else {
        prefs.theme = 0;
        remote.nativeTheme.themeSource = "light";
    }

    document.getElementById('codeStyleSelect').value = prefs.codeStyle;
    //document.getElementById('codeStyleLink').href = `hljs_styles/${prefs.codeStyle}.css`;
    document.getElementById('codeStyleLink').href = `./node_modules/highlight.js/styles/${prefs.codeStyle}.css`;

    document.getElementById('accentColorPicker').value = prefs.accentColor;
    document.documentElement.style.setProperty('--accent-color', prefs.accentColor);

    document.getElementById('tabSizeSelect').value = prefs.tabSize;

    if (prefs.defaultMaximized) {
        remote.getCurrentWindow().maximize();
    }

    zoomLevel = prefs.defaultZoom;
    updateZoom();

    $('#exportBreakPageOnH1Check').prop("checked", prefs.pdfBreakOnH1);
    $('#darkmodePDFCheck').prop("checked", prefs.pdfDarkMode);
    $('#openPDFonExportCheck').prop("checked", prefs.openPDFonExport);
    console.log("openPDFonExport = " + prefs.openPDFonExport)

    if (fs.existsSync(prefs.dataDir)) {
        document.getElementById('dataDirInput').innerText = prefs.dataDir;

        if (prefs.dataDir == defaultDataDir) {
            document.getElementById('revertToDefaultDataDirBtn').disabled = true;
            document.getElementById('revertToDefaultDataDirBtn').style.pointerEvents = "none";
            document.getElementById('revertToDefaultDataDirBtnTooltip').title = "You're already in the default location.";
            $('#revertToDefaultDataDirBtnTooltip').tooltip('dispose');
            $('#revertToDefaultDataDirBtnTooltip').tooltip();
        }
        else {
            document.getElementById('revertToDefaultDataDirBtn').disabled = false;
            document.getElementById('revertToDefaultDataDirBtn').style.pointerEvents = "auto";
            document.getElementById('revertToDefaultDataDirBtnTooltip').title = "Revert to " + defaultDataDir;
            $('#revertToDefaultDataDirBtnTooltip').tooltip('dispose');
            $('#revertToDefaultDataDirBtnTooltip').tooltip();
        }
    }
    else {
        alert("Your Save location (" + prefs.dataDir + ") could not be accessed. Reverting to the default (" + defaultDataDir + ")");
        prefs.dataDir = defaultDataDir;
        document.getElementById('dataDirInput').innerText = prefs.dataDir;
    }

}

/**
 * Called during runtime to apply any prefs changes the user has made, and saves to the JSON file.
 */
function applyPrefsRuntime(needsRestart = false) {

    prefs.codeStyle = document.getElementById('codeStyleSelect').value;
    //document.getElementById('codeStyleLink').href = `hljs_styles/${prefs.codeStyle}.css`;
    document.getElementById('codeStyleLink').href = `./node_modules/highlight.js/styles/${prefs.codeStyle}.css`;

    prefs.theme = document.getElementById('themeSelect').value;
    let header = document.getElementsByTagName('head')[0];
    if (prefs.theme == 1) {
        if (darkStyleLink == null) {
            darkStyleLink = document.createElement('link');
            darkStyleLink.rel = 'stylesheet';
            darkStyleLink.type = 'text/css';
            darkStyleLink.href = 'css/dark.css';
            darkStyleLink.media = 'all';
            header.appendChild(darkStyleLink);
            remote.nativeTheme.themeSource = "dark";
        }
    }
    else if (prefs.theme == 0) {
        remote.nativeTheme.themeSource = "light";
        if (darkStyleLink != null) {
            header.removeChild(darkStyleLink);
            darkStyleLink = null;
        }
    }
    else if (prefs.theme == 2) {
        remote.nativeTheme.themeSource = "system";
        if (remote.nativeTheme.shouldUseDarkColors) {
            darkStyleLink = document.createElement('link');
            darkStyleLink.rel = 'stylesheet';
            darkStyleLink.type = 'text/css';
            darkStyleLink.href = 'css/dark.css';
            darkStyleLink.media = 'all';
            header.appendChild(darkStyleLink);
        }
        else {
            if (darkStyleLink != null) {
                header.removeChild(darkStyleLink);
                darkStyleLink = null;
            }
        }
    }
    else {
        prefs.theme = 0;
    }

    prefs.accentColor = document.getElementById('accentColorPicker').value;
    document.documentElement.style.setProperty('--accent-color', prefs.accentColor);

    prefs.tabSize = parseInt(document.getElementById('tabSizeSelect').value);

    prefs.pdfBreakOnH1 = $('#exportBreakPageOnH1Check').is(':checked');
    prefs.pdfDarkMode = $('#darkmodePDFCheck').is(':checked');
    prefs.openPDFonExport = $('#openPDFonExportCheck').is(':checked');

    //check to make sure this path is valid
    prefs.dataDir = document.getElementById('dataDirInput').innerText;

    if (fs.existsSync(prefs.dataDir)) {
        document.getElementById('dataDirInput').innerText = prefs.dataDir;

        if (prefs.dataDir == defaultDataDir) {
            document.getElementById('revertToDefaultDataDirBtn').disabled = true;
            document.getElementById('revertToDefaultDataDirBtn').style.pointerEvents = "none";
            document.getElementById('revertToDefaultDataDirBtnTooltip').title = "You're already in the default location.";
            $('#revertToDefaultDataDirBtnTooltip').tooltip('dispose');
            $('#revertToDefaultDataDirBtnTooltip').tooltip();
        }
        else {
            document.getElementById('revertToDefaultDataDirBtn').disabled = false;
            document.getElementById('revertToDefaultDataDirBtn').style.pointerEvents = "auto";
            document.getElementById('revertToDefaultDataDirBtnTooltip').title = "Revert to " + defaultDataDir;
            $('#revertToDefaultDataDirBtnTooltip').tooltip('dispose');
            $('#revertToDefaultDataDirBtnTooltip').tooltip();
        }
    }
    else {
        prefs.dataDir = defaultDataDir;
        document.getElementById('dataDirInput').innerText = prefs.dataDir;
        alert("The specified save directory could not be accessed. Reverting to default.");
    }

    savePrefs();

    if (needsRestart) {
        remote.app.relaunch();
        remote.app.exit();
    }
}

/**
 * Adds events to the modals for when the user submits the respective HTML form such as creating or editing a notebook.
 */
function applyModalEventHandlers() {

    /* NEW NOTEBOOK MODAL */
    document.getElementById('newNotebookForm').addEventListener('submit', (e) => {
        e.preventDefault();
        let name = document.getElementById('newNotebookNameInput').value;
        let color = document.getElementById('newNotebookColorPicker').value;
        if (name !== "") {

            getExpandedNotebookData();

            let nb = new Notebook(name, color);
            let index = save.notebooks.length;
            save.notebooks.push(nb);

            //addNotebookToList(index);
            $('#newNotebookModal').modal('hide');
            //showHomePage();
            //displayNotebooks();
            saveData();
            displayNotebooks();
            document.getElementById('newNotebookNameInput').classList.remove("is-invalid");
            document.getElementById('newNotebookNameInput').value = "";
            document.getElementById('newNotebookColorPicker').value = "000000";
        }
        else {
            document.getElementById('newNotebookNameInput').classList.add("is-invalid");
        }
    });

    $('#newNotebookModal').on('shown.bs.modal', (e) => {
        document.getElementById('newNotebookNameInput').focus();
    });

    $('#newNotebookModal').on('hidden.bs.modal', (e) => {
        document.getElementById('newNotebookNameInput').classList.remove('is-invalid');
    });


    /* EDIT NOTEBOOK MODAL */
    document.getElementById('editNotebookForm').addEventListener('submit', (e) => {
        e.preventDefault();
        let newName = document.getElementById('editNotebookNameInput').value;
        let newColor = document.getElementById('editNotebookColorPicker').value;

        if (newName !== "") {
            $('#editNotebookModal').modal('hide');

            getExpandedNotebookData();

            save.notebooks[rightClickedNotebookIndex].name = newName;
            save.notebooks[rightClickedNotebookIndex].color = newColor;
            saveData();

            displayNotebooks();

            //displayNotebooks();
            //document.getElementById(`nb-${rightClickedNotebookIndex}-icon`).style.color = newColor;

            //document.getElementById(`nb-${rightClickedNotebookIndex}`).children[0].style.color = newColor;
            //document.getElementById(`nb-${rightClickedNotebookIndex}`).children[1].innerText = ` ${newName} `;
            //document.getElementById(`nb-${rightClickedNotebookIndex}`).children[1].title = `${newName}`;

            //document.getElementById(`nb-${rightClickedNotebookIndex}-name`).innerText = ` ${newName} `;
        }
        else {
            document.getElementById('editNotebookNameInput').classList.add("is-invalid");
        }
    });

    $('#editNotebookModal').on('shown.bs.modal', (e) => {
        document.getElementById('editNotebookNameInput').focus();
        document.getElementById('editNotebookNameInput').select();
    });

    $('#editNotebookModal').on('hidden.bs.modal', (e) => {
        document.getElementById('editNotebookNameInput').classList.remove('is-invalid');
    });


    /* NEW PAGE MODAL */
    document.getElementById('newPageForm').addEventListener('submit', (e) => {
        e.preventDefault();
        let name = document.getElementById('newPageNameInput').value;

        if (name !== "") {
            $('#newPageModal').modal('hide');

            getExpandedNotebookData();

            let p = new Page(name);
            p.fileName = save.nextPageIndex.toString() + ".json";
            save.nextPageIndex++;

            let index = save.notebooks[rightClickedNotebookIndex].pages.length;
            save.notebooks[rightClickedNotebookIndex].pages.push(p);

            fs.writeFileSync(prefs.dataDir + "/notes/" + p.fileName, '{"type":"doc","content":[{"type":"paragraph"}]}', 'utf8');
            //showHomePage();
            //displayNotebooks();
            saveData();

            displayNotebooks();
            //addPageToAList(rightClickedNotebookIndex, index);

            document.getElementById('newPageNameInput').value = "";

            //tutorial purposes
            if (doingTutorial == true) {
                setTimeout(() => {
                    $("#tutorialModal4").modal('show');
                    doingTutorial = false;
                }, 300);
            }
        }
        else {
            document.getElementById('newPageNameInput').classList.add("is-invalid");
        }
    });

    $('#newPageModal').on('shown.bs.modal', (e) => {
        document.getElementById('newPageNameInput').focus();
    });

    $('#newPageModal').on('hidden.bs.modal', (e) => {
        document.getElementById('newPageNameInput').classList.remove('is-invalid');
    });


    /* EDIT PAGE MODAL */
    document.getElementById('editPageForm').addEventListener('submit', (e) => {
        e.preventDefault();
        let newName = document.getElementById('editPageNameInput').value;

        if (newName !== "") {
            $('#editPageModal').modal('hide');

            getExpandedNotebookData();

            save.notebooks[rightClickedNotebookIndex].pages[rightClickedPageIndex].title = newName;
            saveData();
            displayNotebooks();

            //displayNotebooks();
            //document.getElementById(`page-ref-${rightClickedPageIndex}-name`).innerText = ` ${newName} `;

            //document.querySelector(`[notebook-index='${rightClickedNotebookIndex}'][page-index='${rightClickedPageIndex}']`).children[1].innerText = ` ${newName} `;
            //document.querySelector(`[notebook-index='${rightClickedNotebookIndex}'][page-index='${rightClickedPageIndex}']`).children[1].title = `${newName}`;
        }
        else {
            document.getElementById('editPageNameInput').classList.add("is-invalid");
        }
    });

    $('#editPageModal').on('shown.bs.modal', (e) => {
        document.getElementById('editPageNameInput').focus();
        document.getElementById('editPageNameInput').select();
    });

    $('#editPageModal').on('hidden.bs.modal', (e) => {
        document.getElementById('editPageNameInput').classList.remove('is-invalid');
    });
}

/**
 * Clears sidebar, and loads all notebooks/pages into the sidebar using the instance of Save.
 */
function displayNotebooks() {

    //clear the list
    document.getElementById("notebookList").innerHTML = '';
    favoritePages = [];

    for (let i = 0; i < save.notebooks.length; i++) {

        addNotebookToList(i);

        if (expandedNotebooks.includes(save.notebooks[i])) {
            document.getElementById(`nb-${i}-list`).classList.add('show');
            document.getElementById(`nb-${i}`).setAttribute('aria-expanded', "true");
        }

        //populate the notebook with its pages
        for (let e = 0; e < save.notebooks[i].pages.length; e++) {

            addPageToAList(i, e);

            if (save.notebooks[i].pages[e] == activePage) {
                let pageA = document.querySelector(`a[notebook-index="${i}"][page-index="${e}"]`);
                pageA.classList.add('active');
            }

            if (save.notebooks[i].pages[e].favorite) {
                favoritePages.push(save.notebooks[i].pages[e]);
            }

        }
    }

    //updateFavoritesSection();
}

/**
 * Call this BEFORE making any changes to the save structure (moving notebooks up/down or sorting them) and then call displayNotebooks()
 */
function getExpandedNotebookData() {
    expandedNotebooks = [];
    activePage = null;
    for (let i = 0; i < save.notebooks.length; i++) {

        let nbList = document.getElementById(`nb-${i}-list`);
        if (nbList.classList.contains('show')) {
            expandedNotebooks.push(save.notebooks[i]);
        }

        //populate the notebook with its pages
        for (let e = 0; e < save.notebooks[i].pages.length; e++) {

            let pageA = document.querySelector(`a[notebook-index="${i}"][page-index="${e}"]`);
            if (pageA.classList.contains('active')) {
                activePage = save.notebooks[i].pages[e];
            }
        }
    }
}

function addNotebookToList(index) {
    let notebook = save.notebooks[index];

    let el = document.createElement("li");
    el.classList.add("nav-item");
    el.draggable = true;
    el.style.transition = "box-shadow 0.2s ease";

    let a = document.createElement("a");
    a.id = `nb-${index}`;
    a.title = notebook.name;
    a.setAttribute('notebook-index', index);
    a.classList.add('nav-link', 'dropdown-toggle', 'notebook', 'unselectable');
    a.href = `#nb-${index}-list`;
    a.setAttribute('data-toggle', 'collapse');
    a.setAttribute('aria-expanded', 'false');
    a.innerHTML = `
  <span data-feather="book" style="color: ${notebook.color}"></span><span class="notebook-title"> ${notebook.name} </span><span class="caret"></span>
  `;
    el.appendChild(a);

    let ul = document.createElement("ul");
    ul.classList.add('nav', 'collapse');
    ul.id = `nb-${index}-list`;
    el.appendChild(ul);

    if (notebook.pages.length == 0) {
        let emptyIndicator = document.createElement("li");
        emptyIndicator.classList.add('nav-item', 'emptyIndicator');
        emptyIndicator.innerHTML = '<i class="nav-link indent font-weight-light unselectable">Nothing here yet...</i>';
        ul.appendChild(emptyIndicator);
    }

    document.getElementById("notebookList").appendChild(el);
    feather.replace();

    //Add necessary event listeners
    a.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        document.getElementById('page-context-menu').style.display = "none";
        let cm = document.getElementById('notebook-context-menu');
        cm.style.display = "block";
        cm.style.left = `${e.clientX}px`;
        if (remote.process.platform === 'win32') {
            cm.style.top = `${e.clientY - 30}px`;
        }
        else {
            cm.style.top = `${e.clientY}px`;
        }
        rightClickedNotebookIndex = parseInt(this.getAttribute("notebook-index"));
    });



    //DRAG SORTING
    el.addEventListener('dragstart', function (e) {
        draggedNotebookIndex = parseInt(this.children[0].getAttribute('notebook-index'));
        draggingNotebook = true;
        e.dataTransfer.dropEffect = "move";
        let img = new Image();
        e.dataTransfer.setDragImage(img, 0, 0);
    });
    el.addEventListener('dragover', function (e) {
        e.preventDefault();

        if (draggingNotebook) {

            let otherIndex = draggedNotebookIndex;
            let thisIndex = parseInt(this.children[0].getAttribute('notebook-index'));

            if (otherIndex != thisIndex) {
                e.dataTransfer.dropEffect = "move";
                let relativeY = e.clientY - this.getBoundingClientRect().top;
                if (relativeY > 18) {
                    //PLACE THE OTHER NOTEBOOK BELOW THIS ONE
                    this.style.boxShadow = "0px -2px 0px orange inset";
                }
                else if (relativeY <= 18) {
                    //PLACE THE OTHER NOTEBOOK ABOVE THIS ONE
                    this.style.boxShadow = "0px 2px 0px orange inset";
                }
            }
            else {
                e.dataTransfer.dropEffect = "none";
                return false;
            }
        }
        else if (draggingPage) {
            this.style.boxShadow = "0px -2px 0px pink inset";
        }
        else {
            e.dataTransfer.dropEffect = "none";
            return false;
        }

    });
    el.addEventListener('dragleave', function (e) {
        this.style.boxShadow = "none";
    });
    el.addEventListener('drop', function (e) {
        e.preventDefault();
        //this is called on the element that is being dropped on
        this.style.boxShadow = "none";

        if (draggingNotebook) {
            let myIndex = parseInt(this.children[0].getAttribute('notebook-index'));
            let draggedIndex = draggedNotebookIndex;

            if (myIndex != draggedIndex) {
                let relativeY = e.clientY - this.getBoundingClientRect().top;

                getExpandedNotebookData();
                if (relativeY > 18) {
                    //PLACE MY NOTEBOOK BELOW THE LANDED ONE

                    let nb = save.notebooks[draggedIndex];
                    let fillerNB = new Notebook("empty", "000000");
                    save.notebooks[draggedIndex] = fillerNB;
                    save.notebooks.splice(myIndex + 1, 0, nb);
                    save.notebooks.splice(save.notebooks.indexOf(fillerNB), 1);
                }
                else if (relativeY <= 18) {
                    //PLACE MY NOTEBOOK ABOVE THE LANDED ONE

                    let nb = save.notebooks[draggedIndex];
                    let fillerNB = new Notebook("empty", "000000");
                    save.notebooks[draggedIndex] = fillerNB;
                    save.notebooks.splice(myIndex, 0, nb);
                    save.notebooks.splice(save.notebooks.indexOf(fillerNB), 1);
                }

                saveData();
                displayNotebooks();
            }
        }
        else if (draggingPage) {
            let myNotebookIndex = parseInt(this.children[0].getAttribute('notebook-index'));

            if (myNotebookIndex != draggedPagesNotebookIndex) {
                getExpandedNotebookData();

                let pg = save.notebooks[draggedPagesNotebookIndex].pages[draggedPageIndex];
                save.notebooks[myNotebookIndex].pages.push(pg);
                save.notebooks[draggedPagesNotebookIndex].pages.splice(draggedPageIndex, 1);

                saveData();
                displayNotebooks();
            }
        }
    });
    el.addEventListener('dragend', function (e) {
        draggingNotebook = false;
    })
}

function addPageToAList(notebookIndex, index) {

    let page = save.notebooks[notebookIndex].pages[index];

    let el = document.createElement("li");
    el.classList.add('nav-item');
    el.classList.add('my-sidebar-item');
    el.draggable = true;
    el.style.transition = "box-shadow 0.2s ease";

    let a = document.createElement("a");
    a.id = `page-${index}`;
    a.title = `${page.title}`;
    a.href = "#";
    a.classList.add('nav-link', 'my-sidebar-link', 'page', 'indent', 'unselectable');
    a.innerHTML = `
  <span data-feather="file-text"></span><span class="page-title"> ${page.title} </span>
  `;

    if (page.favorite) {
        a.innerHTML += '<span data-feather="star" style="width: 14px; height: 14px; color: orange"></span>'
    }

    a.setAttribute('notebook-index', `${notebookIndex}`);
    a.setAttribute('page-index', `${index}`);
    el.appendChild(a);

    let nbList = document.getElementById(`nb-${notebookIndex}-list`);

    //Delete empty indicator if it's there
    nbList.querySelectorAll('.emptyIndicator').forEach((indicator) => {
        indicator.parentNode.removeChild(indicator);
    });

    nbList.appendChild(el);
    feather.replace();

    a.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        document.getElementById('notebook-context-menu').style.display = "none";
        let cm = document.getElementById('page-context-menu');
        cm.style.display = "block";
        cm.style.left = `${e.clientX}px`;
        cm.style.top = `${e.clientY - 30}px`;
        rightClickedNotebookIndex = parseInt(this.getAttribute("notebook-index"));
        rightClickedPageIndex = parseInt(this.getAttribute("page-index"));

        if (save.notebooks[rightClickedNotebookIndex].pages[rightClickedPageIndex].favorite) {
            document.getElementById('FavoritePageLink').innerText = "Unfavorite page";
        }
        else {
            document.getElementById('FavoritePageLink').innerText = "Favorite page";
        }
    });
    a.addEventListener('click', function () {
        showEditorPage();
        loadPage(parseInt(this.getAttribute("notebook-index")), parseInt(this.getAttribute("page-index")));

        //change selected sidebar item

        document.querySelectorAll('.my-sidebar-link').forEach((item) => {
            item.classList.toggle('active', false);
        });

        this.classList.toggle('active', true);

    });

    el.addEventListener('dragstart', function (e) {
        e.stopPropagation();
        draggedPagesNotebookIndex = parseInt(this.children[0].getAttribute('notebook-index'));
        draggedPageIndex = parseInt(this.children[0].getAttribute('page-index'));
        draggingPage = true;
        let img = new Image();
        e.dataTransfer.setDragImage(img, 0, 0);
        e.dataTransfer.dropEffect = "move";
    });
    el.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();

        if (draggingPage) {

            let otherPageIndex = draggedPageIndex;
            let thisPageIndex = parseInt(this.children[0].getAttribute('page-index'));
            let otherNotebookIndex = draggedPagesNotebookIndex;
            let thisNotebookIndex = parseInt(this.children[0].getAttribute('notebook-index'));

            if (save.notebooks[thisNotebookIndex].pages[thisPageIndex] != save.notebooks[otherNotebookIndex].pages[otherPageIndex]) {
                e.dataTransfer.dropEffect = "move";
                let relativeY = e.clientY - this.getBoundingClientRect().top;
                if (relativeY > 18) {
                    //PLACE THE OTHER NOTEBOOK BELOW THIS ONE
                    this.style.boxShadow = "0px -2px 0px blue inset";
                }
                else if (relativeY <= 18) {
                    //PLACE THE OTHER NOTEBOOK ABOVE THIS ONE
                    this.style.boxShadow = "0px 2px 0px blue inset";
                }
            }
            else {
                e.dataTransfer.dropEffect = "none";
                return false;
            }
        }
        else {
            e.dataTransfer.dropEffect = "none";
            return false;
        }

    });
    el.addEventListener('dragleave', function (e) {
        e.stopPropagation();
        this.style.boxShadow = "none";
    });
    el.addEventListener('drop', function (e) {
        e.stopPropagation();
        e.preventDefault();
        //this is called on the element that is being dropped on
        this.style.boxShadow = "none";

        let otherPageIndex = draggedPageIndex;
        let thisPageIndex = parseInt(this.children[0].getAttribute('page-index'));
        let otherNotebookIndex = draggedPagesNotebookIndex;
        let thisNotebookIndex = parseInt(this.children[0].getAttribute('notebook-index'));

        if (save.notebooks[thisNotebookIndex].pages[thisPageIndex] != save.notebooks[otherNotebookIndex].pages[otherPageIndex]) {

            if (thisNotebookIndex == otherNotebookIndex) {
                //MOVING PAGE IN THE SAME NOTEBOOK
                let relativeY = e.clientY - this.getBoundingClientRect().top;

                getExpandedNotebookData();
                if (relativeY > 18) {
                    //PLACE DRAGGED PAGE BELOW THE LANDED ONE

                    let pg = save.notebooks[otherNotebookIndex].pages[otherPageIndex];
                    let fillerPG = new Page("empty");
                    save.notebooks[otherNotebookIndex].pages[otherPageIndex] = fillerPG;
                    save.notebooks[otherNotebookIndex].pages.splice(thisPageIndex + 1, 0, pg);
                    save.notebooks[otherNotebookIndex].pages.splice(save.notebooks[otherNotebookIndex].pages.indexOf(fillerPG), 1);
                }
                else if (relativeY <= 18) {
                    //PLACE DRAGGED PAGE ABOVE THE LANDED ONE

                    let pg = save.notebooks[otherNotebookIndex].pages[otherPageIndex];
                    let fillerPG = new Page("empty");
                    save.notebooks[otherNotebookIndex].pages[otherPageIndex] = fillerPG;
                    save.notebooks[otherNotebookIndex].pages.splice(thisPageIndex, 0, pg);
                    save.notebooks[otherNotebookIndex].pages.splice(save.notebooks[otherNotebookIndex].pages.indexOf(fillerPG), 1);
                }

                saveData();
                displayNotebooks();
            }
            else {
                //MOVING PAGE INTO ANOTHER NOTEBOOK

                let relativeY = e.clientY - this.getBoundingClientRect().top;

                getExpandedNotebookData();
                if (relativeY > 18) {
                    //PLACE DRAGGED PAGE BELOW THE LANDED ONE

                    let pg = save.notebooks[otherNotebookIndex].pages[otherPageIndex];
                    let fillerPG = new Page("empty");
                    save.notebooks[otherNotebookIndex].pages[otherPageIndex] = fillerPG;
                    save.notebooks[thisNotebookIndex].pages.splice(thisPageIndex + 1, 0, pg);
                    save.notebooks[otherNotebookIndex].pages.splice(save.notebooks[otherNotebookIndex].pages.indexOf(fillerPG), 1);
                }
                else if (relativeY <= 18) {
                    //PLACE DRAGGED PAGE ABOVE THE LANDED ONE

                    let pg = save.notebooks[otherNotebookIndex].pages[otherPageIndex];
                    let fillerPG = new Page("empty");
                    save.notebooks[otherNotebookIndex].pages[otherPageIndex] = fillerPG;
                    save.notebooks[thisNotebookIndex].pages.splice(thisPageIndex, 0, pg);
                    save.notebooks[otherNotebookIndex].pages.splice(save.notebooks[otherNotebookIndex].pages.indexOf(fillerPG), 1);
                }

                saveData();
                displayNotebooks();
            }

        }
    });
    el.addEventListener('dragend', function (e) {
        e.stopPropagation();
        draggingPage = false;
    });
}

/**
 * Iterates through sidebar links and tells them to become 'active' and load their content on click, and other events like onContextMenu.
 */
function addSidebarLinkEvents() {
    document.querySelectorAll('.my-sidebar-link').forEach(function (item) {
        item.addEventListener('click', () => {
            //change selected sidebar item

            document.querySelectorAll('.my-sidebar-link').forEach(function (item) {
                item.classList.toggle('active', false);
            });

            item.classList.toggle('active', true);

        })
    });

    document.addEventListener('click', (e) => {
        if (e.target != document.getElementById('notebook-context-menu') && e.target != document.getElementById('page-context-menu')) {
            document.getElementById('notebook-context-menu').style.display = "none";
            document.getElementById('page-context-menu').style.display = "none";
        }
    });
    /*document.querySelectorAll('.notebook').forEach(function(el) {
      el.addEventListener('contextmenu', function(e) {
        document.getElementById('page-context-menu').style.display = "none";
        let cm = document.getElementById('notebook-context-menu');
        cm.style.display = "block";
        cm.style.left = `${e.clientX}px`;
        cm.style.top = `${e.clientY - 30}px`;
        rightClickedNotebookIndex = parseInt(this.getAttribute("notebook-index"));
      });
    });*/
    /*document.querySelectorAll('.page').forEach(function(el) {
      el.addEventListener('contextmenu', function(e) {
        document.getElementById('notebook-context-menu').style.display = "none";
        let cm = document.getElementById('page-context-menu');
        cm.style.display = "block";
        cm.style.left = `${e.clientX}px`;
        cm.style.top = `${e.clientY - 30}px`;
      });
    });*/
    window.addEventListener('resize', () => {
        document.getElementById('notebook-context-menu').style.display = "none";
        document.getElementById('page-context-menu').style.display = "none";
    })
}

/**
 * Shows the Home page and makes that sidebar link active.
 */
function showHomePage() {
    saveSelectedPage();
    document.getElementById('editorPage').style.display = "none";
    document.getElementById('settingsPage').style.display = "none";
    document.getElementById('homePage').style.display = "block";
    document.getElementById('helpPage').style.display = "none";
    //titlebar.updateTitle('Codex');
    selectedPage = null;

    remote.Menu.setApplicationMenu(normalMenu);
    if (remote.process.platform === 'win32') {
        titlebar.updateMenu(normalMenu);
    }
}

/**
 * Shows the Settings page and makes that sidebar link active.
 */
function showSettingsPage() {
    saveSelectedPage();
    document.getElementById('editorPage').style.display = "none";
    document.getElementById('homePage').style.display = "none";
    document.getElementById('settingsPage').style.display = "block";
    document.getElementById('helpPage').style.display = "none";
    //titlebar.updateTitle('Codex');
    selectedPage = null;

    remote.Menu.setApplicationMenu(normalMenu);
    if (remote.process.platform === 'win32') {
        titlebar.updateMenu(normalMenu);
    }
}

/**
 * Shows the Editor page. A page's content must be loaded to the editor afterwards.
 */
function showEditorPage() {
    document.getElementById('settingsPage').style.display = "none";
    document.getElementById('homePage').style.display = "none";
    document.getElementById('editorPage').style.display = "block";
    document.getElementById('helpPage').style.display = "none";

    remote.Menu.setApplicationMenu(editingMenu);
    if (remote.process.platform === 'win32') {
        titlebar.updateMenu(editingMenu);
    }
}

function showHelpPage() {
    saveSelectedPage();
    document.getElementById('settingsPage').style.display = "none";
    document.getElementById('homePage').style.display = "none";
    document.getElementById('editorPage').style.display = "none";
    document.getElementById('helpPage').style.display = "block";

    remote.Menu.setApplicationMenu(normalMenu);
    if (remote.process.platform === 'win32') {
        titlebar.updateMenu(normalMenu);
    }
}

function loadHelpPage(filename) {
    document.getElementById('helpContent').innerHTML = fs.readFileSync(__dirname + "/docs/" + filename, 'utf8');
}

/**
 * Shows modal used for editing a notebook, and updates the input controls with that notebook's data. THIS FUNCTION DOES NOT ACTUALLY EDIT THE DATA.
 * @see applyModalEventHandlers()
 */
function editSelectedNotebook() {
    $('#editNotebookModal').modal('show');
    document.getElementById('editNotebookNameInput').value = save.notebooks[rightClickedNotebookIndex].name;
    document.getElementById('editNotebookColorPicker').value = save.notebooks[rightClickedNotebookIndex].color;
}

/**
 * Deletes the right-clicked notebook from the Save.
 */
function deleteSelectedNotebook() {
    getExpandedNotebookData();
    save.notebooks.splice(rightClickedNotebookIndex, 1);
    saveData();
    displayNotebooks();
    showHomePage();

    // let nbLI = document.getElementById(`nb-${rightClickedNotebookIndex}`).parentNode;
    // while (nbLI.firstChild) {
    //   nbLI.removeChild(nbLI.lastChild);
    // }
    // nbLI.parentNode.removeChild(nbLI);
}

function editSelectedPage() {
    $('#editPageModal').modal('show');
    document.getElementById('editPageNameInput').value = save.notebooks[rightClickedNotebookIndex].pages[rightClickedPageIndex].title;
}

function deleteSelectedPage() {
    getExpandedNotebookData();
    save.notebooks[rightClickedNotebookIndex].pages.splice(rightClickedPageIndex, 1);
    saveData();
    displayNotebooks();

    showHomePage();

    //delete the page's list element
    // let pgLI = document.querySelector(`[notebook-index="${rightClickedNotebookIndex}"][page-index="${rightClickedPageIndex}]"`).parentNode;
    // while (pgLI.firstChild) {
    //   pgLI.removeChild(pgLI.lastChild);
    // }
    // pgLI.parentNode.removeChild(pgLI);
}

/**
 * Loads the specified page's contents into the Editor.
 */
function loadPage(notebookIndex, pageIndex) {
    saveSelectedPage();
    selectedPageContent = "";
    selectedPage = save.notebooks[notebookIndex].pages[pageIndex];
    selectedPageContent = fs.readFileSync(prefs.dataDir + "/notes/" + selectedPage.fileName, 'utf8');

    if (window.view) {
        window.view.destroy();
    }
    window.view = new EditorView(document.getElementById('editor'), {
        state: EditorState.create({
            doc: mySchema.nodeFromJSON(JSON.parse(selectedPageContent)),
            plugins: exampleSetup({ schema: mySchema, tabSize: prefs.tabSize })
        })
    })

    //window.view.focus();
}

/**
 * Increases the zoom level and calls updateZoom().
 * @see updateZoom()
 */
function zoomIn() {
    if (selectedPage != null) {
        if (zoomLevel < 4.000) {
            zoomLevel += 0.100;
            updateZoom();
        }
    }
}

/**
 * Decreases the zoom level and calls updateZoom().
 * @see updateZoom()
 */
function zoomOut() {
    if (selectedPage != null) {
        if (zoomLevel > 0.700) {
            zoomLevel -= 0.100;
            updateZoom();
        }
    }
}

/**
 * Sets the zoom level to 1.0 calls updateZoom().
 * @see updateZoom()
 */
function defaultZoom() {
    if (selectedPage != null) {
        zoomLevel = 1.000;
        updateZoom();
    }
}

/**
 * Applies the zoom level to the transform scale of the editor.
 */
function updateZoom() {
    prefs.defaultZoom = zoomLevel;
    let ec = document.getElementById('editorContent');

    //ec.style.transform = `scale(${zoomLevel})`;
    ec.style.zoom = `${zoomLevel}`;
    //let ep = document.getElementById('editorPage');
    //ep.style.height = `${ep.style.height * zoomLevel}px`;
}

/**
 * Toggles the editor ribbon
 */
function toggleEditorRibbon() {
    let ribbon = document.getElementById('editorRibbon');

    if (ribbon.style.display == "none") {
        ribbon.style.display = "flex";
    }
    else {
        ribbon.style.display = "none";
    }
}

function toggleSidebar() {
    if (sidebarOpen == true) {
        document.getElementById('sidebarMenu').style.width = "0px";
        document.getElementById('mainContainer').style.marginLeft = "0px";
        document.getElementById('editorRibbon').style.left = "0px";
        sidebarOpen = false;
    }
    else {
        document.getElementById('sidebarMenu').style.width = "var(--sidebar-width)";
        document.getElementById('mainContainer').style.marginLeft = "var(--sidebar-width)";
        document.getElementById('editorRibbon').style.left = "var(--sidebar-width)";
        sidebarOpen = true;
    }
}

async function DataDirDialog() {
    let result = await remote.dialog.showOpenDialogSync(remote.getCurrentWindow(), {
        properties: ['openDirectory']
    })

    if (result != undefined) {
        document.getElementById('dataDirInput').innerText = result[0];

        destroyOpenedNotebooks = true;
        saveData();

        canSaveData = false;
        applyPrefsRuntime(true);
    }
}

function revertToDefaultDataDir() {
    document.getElementById('dataDirInput').innerText = defaultDataDir;

    destroyOpenedNotebooks = true;
    saveData();

    canSaveData = false;
    applyPrefsRuntime(true);
}

function openAboutPage() {
    let about = new remote.BrowserWindow({
        width: 360,
        height: 480,
        resizable: false,
        icon: 'codex.ico',
        title: "About Codex",
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: false,
            worldSafeExecuteJavaScript: true
        },
        parent: remote.getCurrentWindow(),
        show: false
    });
    about.once('ready-to-show', () => {
        about.show()
    })
    about.setMenu(null);
    about.loadFile('about.html');
}

function toggleFavoritePage() {
    let page = save.notebooks[rightClickedNotebookIndex].pages[rightClickedPageIndex];

    page.favorite = !page.favorite;
    getExpandedNotebookData();
    saveData();
    displayNotebooks();
}

function updateFavoritesSection() {
    document.getElementById('favoritePagesContainer').innerHTML = '';
    let currentRow;

    for (let i = 0; i < favoritePages.length; i++) {
        let page = favoritePages[i];
        if (i % 5 == 0) {
            currentRow = document.createElement('div');
            currentRow.style.marginTop = "40px";
            currentRow.style.marginBottom = "40px";
            document.getElementById('favoritePagesContainer').appendChild(currentRow);
        }

        let title = page.title;
        if (title.length > 30) {
            title = title.substring(0, 30) + "...";
        }

        currentRow.innerHTML += `
    <div class="favoritePageBox shadow" title="${page.title}">
      <div class="d-flex" style="width: 100%">
        <div style="width: 32px;">
          <span data-feather="star" style="color: orange; height: 100%;"></span>
        </div>
        <div class="flex-grow-1" style="height: 100%; line-height: 61px; text-align: left">
          <span style="display: inline-block; line-height: 17px; vertical-align: middle;">${title}</span>
        </div>
      </div>
    </div>
    `;
    }

    feather.replace();
}

function _loadCloudSyncPage() {
    let tab = document.getElementById('helpTab');
    if (tab.getAttribute('aria-expanded') != "true") {
        $('#helpTab').click();
    }

    document.querySelectorAll('.my-sidebar-link').forEach(function (item) {
        item.classList.toggle('active', false);
    });
    let page = document.getElementById('cloudSyncPage');
    page.classList.toggle('active', true);

    showHelpPage();
    loadHelpPage('cloudsync.html');
}

function openDataDir() {
    remote.shell.openPath(prefs.dataDir);
}

ipcRenderer.on('updateAvailable', function (e, newVer) {

    setTimeout(() => {
        $('#updateBlock').fadeIn();
        document.getElementById('welcomeBlock').style.marginTop = "20px";
        feather.replace();

        if (document.getElementById('homePage').style.display == "none") {
            popup('Update', 'A new version of Codex is available!', 'Please visit www.codexnotes.com/download to update.');
        }
    }, 0);
})

async function printPage() {
    let content = window.view.dom.innerHTML;

    let workerWindow = new remote.BrowserWindow({
        parent: remote.getCurrentWindow(),
        show: false,
        backgroundColor: '#414950'
    });
    workerWindow.loadFile('pdf.html');
    await workerWindow.webContents.executeJavaScript(`document.body.innerHTML = \`${content}\``);
    //await workerWindow.webContents.executeJavaScript(`document.getElementById('codeStyleLink').href = 'hljs_styles/${prefs.codeStyle}.css';`);
    await workerWindow.webContents.executeJavaScript(`document.getElementById('codeStyleLink').href = './node_modules/highlight.js/styles/${prefs.codeStyle}.css';`);
    

    if (prefs.pdfDarkMode == true) {
        await workerWindow.webContents.executeJavaScript(`document.getElementById('darkStyleLink').href = 'css/dark.css';`);
    }

    if (prefs.pdfBreakOnH1 == true) {
        await workerWindow.webContents.executeJavaScript('enableBreaksOnH1()');
    }

    let path = remote.dialog.showSaveDialogSync(remote.getCurrentWindow(), {
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
        title: "Export page to PDF",
        defaultPath: "*/" + sanitizeStringForFiles(selectedPage.title) + ".pdf"
    });

    if (path) {

        var data = await workerWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true, scaleFactor: 100, marginsType: 1 });

        fs.writeFileSync(path, data, (err) => {
            console.log(err.message);
            workerWindow.destroy();
            return;
        });

        if (prefs.openPDFonExport == true)
            shell.openExternal('file:///' + path);

    }

    workerWindow.destroy();

}

function sanitizeStringForFiles(x) {
    return x.replace(/[\/\\:$*"<>|]+/g, " ");
}

function revertAccentColor() {
    prefs.accentColor = "#FF7A27";
    document.getElementById('accentColorPicker').value = "#FF7A27";
    document.documentElement.style.setProperty('--accent-color', prefs.accentColor);
}

let doingTutorial = false;
async function startTutorial() {

    doingTutorial = true;
    await sleep(300);

    $("#tutorialModal2").modal('show');

    let nbCount = save.notebooks.length;

    while (save.notebooks.length <= nbCount) {
        if (save.notebooks.length > nbCount) {
            break;
        }
        await sleep(500);
    }

    await sleep(300);
    $("#tutorialModal3").modal('show');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}