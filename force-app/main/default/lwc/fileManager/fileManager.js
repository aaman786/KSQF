import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent }                    from 'lightning/platformShowToastEvent';
import { refreshApex }                       from '@salesforce/apex';
import { NavigationMixin }                   from 'lightning/navigation';

import getFolders     from '@salesforce/apex/FileManagerController.getFolders';
import getFiles       from '@salesforce/apex/FileManagerController.getFiles';
import createFolder   from '@salesforce/apex/FileManagerController.createFolder';
import renameFolder   from '@salesforce/apex/FileManagerController.renameFolder';
import deleteFolder   from '@salesforce/apex/FileManagerController.deleteFolder';
import renameFile     from '@salesforce/apex/FileManagerController.renameFile';
import deleteFile     from '@salesforce/apex/FileManagerController.deleteFile';
import linkFilesToParentRecord from '@salesforce/apex/FileManagerController.linkFilesToParentRecord';

const ICON_MAP = {
    pdf  : 'doctype:pdf',
    doc  : 'doctype:word',
    docx : 'doctype:word',
    xls  : 'doctype:excel',
    xlsx : 'doctype:excel',
    ppt  : 'doctype:ppt',
    pptx : 'doctype:ppt',
    png  : 'doctype:image',
    jpg  : 'doctype:image',
    jpeg : 'doctype:image',
    gif  : 'doctype:image',
    zip  : 'doctype:zip',
    csv  : 'doctype:csv',
    txt  : 'doctype:txt',
    mp4  : 'doctype:mp4',
    mp3  : 'doctype:audio',
};

export default class FileManager extends NavigationMixin(LightningElement) {

    @api recordId;
    acceptedFormats = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
                       '.png','.jpg','.jpeg','.gif','.zip','.csv','.txt','.mp4'];

    // ── State ──────────────────────────────────────────────────────────────────
    @track allFolders     = [];          // flat list from apex
    @track currentFiles   = [];
    @track breadcrumb     = [{ id: null, name: 'Root', hasNext: false }];
    @track isLoading      = false;

    // Folder modal
    @track showFolderModal   = false;
    @track folderModalTitle  = '';
    @track folderModalName   = '';
    folderModalMode          = 'create';  // 'create' | 'rename'
    folderModalContext        = null;     // { parentFolderId } or { folderId }

    // Rename file modal
    @track showRenameFileModal = false;
    @track renameFileTitle     = '';
    renameFileId               = null;

    // Delete confirm
    @track showDeleteConfirm    = false;
    @track deleteConfirmMessage = '';
    deleteTarget                = null;  // { type: 'file'|'folder', id }

    _foldersWireResult;
    _selectedFolderId = null;   // null = root

    // ── Wire ──────────────────────────────────────────────────────────────────
    @wire(getFolders, { recordId: '$recordId' })
    wiredFolders(result) {
        this._foldersWireResult = result;
        if (result.data) {
            this.allFolders = result.data.map(f => ({
                id           : f.Id,
                name         : f.Name,
                parentId     : f.ParentFolder__c || null,
                children     : [],
                isExpanded   : false,
            }));
        } else if (result.error) {
            this.showToast('Error', result.error.body.message, 'error');
        }
    }

    // ── Computed ──────────────────────────────────────────────────────────────
    get rootFolders() {
        return this._buildTree(null);
    }

    _buildTree(parentId) {
        return this.allFolders
            .filter(f => f.parentId === parentId)
            .map(f => ({ ...f, children: this._buildTree(f.id) }));
    }

    get noFolders() {
        return this.allFolders.length === 0;
    }

    get hasFiles() {
        return this.currentFiles.length > 0;
    }

    get selectedFolderId() {
        return this._selectedFolderId;
    }

    get uploadTargetId() {
        // Files are linked to the folder record if one is selected, else the record itself
        return this._selectedFolderId || this.recordId;
    }

    get currentFolderName() {
        if (!this._selectedFolderId) return 'Root';
        const f = this.allFolders.find(x => x.id === this._selectedFolderId);
        return f ? f.name : '';
    }

    get rootItemClass() {
        return this._selectedFolderId === null
            ? 'fm-tree-node fm-tree-node--active'
            : 'fm-tree-node';
    }

    // ── Folder selection ──────────────────────────────────────────────────────
    selectRoot() {
        this._selectedFolderId = null;
        this.breadcrumb = [{ id: null, name: 'Root', hasNext: false }];
        this.loadFiles(this.recordId);
    }

    handleFolderSelect(evt) {
        const { id, name, ancestors } = evt.detail;
        this._selectedFolderId = id;
        // Build breadcrumb: Root → ... ancestors ... → current
        const crumbs = [
            { id: null, name: 'Root', hasNext: true },
            ...(ancestors || []).map(a => ({ id: a.id, name: a.name, hasNext: true })),
            { id, name, hasNext: false },
        ];
        this.breadcrumb = crumbs;
        this.loadFiles(id);
    }

    onCrumbClick(evt) {
        const id = evt.currentTarget.dataset.id || null;
        if (id === null) {
            this.selectRoot();
        } else {
            const folder = this.allFolders.find(f => f.id === id);
            if (folder) {
                // Re-use handleFolderSelect logic; compute ancestors
                const ancestors = this._getAncestors(id);
                this.handleFolderSelect({ detail: { id, name: folder.name, ancestors } });
            }
        }
    }

    _getAncestors(folderId) {
        const ancestors = [];
        let current = this.allFolders.find(f => f.id === folderId);
        while (current && current.parentId) {
            const parent = this.allFolders.find(f => f.id === current.parentId);
            if (parent) { ancestors.unshift({ id: parent.id, name: parent.name }); }
            current = parent;
        }
        return ancestors;
    }

    // ── Load files ────────────────────────────────────────────────────────────
    async loadFiles(entityId) {
        this.isLoading = true;
        try {
            const raw = await getFiles({ linkedEntityId: entityId });
            this.currentFiles = raw.map(f => ({
                ...f,
                iconName      : ICON_MAP[(f.extension || '').toLowerCase()] || 'doctype:unknown',
                sizeFriendly  : this._formatSize(f.sizeBytes),
            }));
        } catch (e) {
            this.showToast('Error loading files', e.body?.message || e.message, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    _formatSize(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    }

    // ── Upload ────────────────────────────────────────────────────────────────
    async handleUploadFinished(evt) {
        const uploaded = evt.detail.files;
        this.showToast('Success', `${uploaded.length} file(s) uploaded.`, 'success');

        // Files uploaded into a folder are only linked to the folder by lightning-file-upload.
        // Also link them to the host record so they show up in the record's own Files list.
        if (this._selectedFolderId) {
            try {
                await linkFilesToParentRecord({
                    contentDocumentIds : uploaded.map(f => f.documentId),
                    recordId           : this.recordId,
                });
            } catch (e) {
                this.showToast('Warning', 'Files uploaded, but linking to the record failed.', 'warning');
            }
        }

        this.loadFiles(this.uploadTargetId);
    }

    // ── Folder Modals ─────────────────────────────────────────────────────────
    openNewRootFolderModal() {
        this.folderModalTitle   = 'New Root Folder';
        this.folderModalName    = '';
        this.folderModalMode    = 'create';
        this.folderModalContext = { parentFolderId: null };
        this.showFolderModal    = true;
    }

    openNewSubFolderModal() {
        this.folderModalTitle   = 'New Sub-Folder';
        this.folderModalName    = '';
        this.folderModalMode    = 'create';
        this.folderModalContext = { parentFolderId: this._selectedFolderId };
        this.showFolderModal    = true;
    }

    handleNewSubFolder(evt) {
        this.folderModalTitle   = 'New Sub-Folder';
        this.folderModalName    = '';
        this.folderModalMode    = 'create';
        this.folderModalContext = { parentFolderId: evt.detail.parentId };
        this.showFolderModal    = true;
    }

    handleRenameFolder(evt) {
        this.folderModalTitle   = 'Rename Folder';
        this.folderModalName    = evt.detail.name;
        this.folderModalMode    = 'rename';
        this.folderModalContext = { folderId: evt.detail.id };
        this.showFolderModal    = true;
    }

    closeFolderModal() {
        this.showFolderModal = false;
    }

    onFolderNameChange(evt) {
        this.folderModalName = evt.detail.value;
    }

    async saveFolderModal() {
        const name = this.folderModalName.trim();
        if (!name) {
            this.showToast('Validation', 'Folder name cannot be empty.', 'warning');
            return;
        }
        try {
            if (this.folderModalMode === 'create') {
                await createFolder({
                    name           : name,
                    parentFolderId : this.folderModalContext.parentFolderId,
                    recordId       : this.recordId,
                });
                this.showToast('Success', `Folder "${name}" created.`, 'success');
            } else {
                await renameFolder({ folderId: this.folderModalContext.folderId, newName: name });
                this.showToast('Success', `Folder renamed to "${name}".`, 'success');
            }
            this.closeFolderModal();
            await refreshApex(this._foldersWireResult);
        } catch (e) {
            this.showToast('Error', e.body?.message || e.message, 'error');
        }
    }

    // ── Delete Folder ─────────────────────────────────────────────────────────
    handleDeleteFolder(evt) {
        this.deleteTarget       = { type: 'folder', id: evt.detail.id };
        this.deleteConfirmMessage = `Delete folder "${evt.detail.name}" and all its contents? This cannot be undone.`;
        this.showDeleteConfirm  = true;
    }

    // ── File Actions ──────────────────────────────────────────────────────────
    previewFile(evt) {
        const versionId = evt.currentTarget.dataset.version;
        this[NavigationMixin.Navigate]({
            type       : 'standard__namedPage',
            attributes : { pageName: 'filePreview' },
            state      : { selectedRecordId: versionId },
        });
    }

    openRenameFileModal(evt) {
        this.renameFileId    = evt.currentTarget.dataset.id;
        this.renameFileTitle = evt.currentTarget.dataset.name;
        this.showRenameFileModal = true;
    }

    closeRenameFileModal() {
        this.showRenameFileModal = false;
    }

    onRenameFileTitleChange(evt) {
        this.renameFileTitle = evt.detail.value;
    }

    async saveRenameFile() {
        try {
            await renameFile({ contentDocumentId: this.renameFileId, newTitle: this.renameFileTitle.trim() });
            this.showToast('Success', 'File renamed.', 'success');
            this.closeRenameFileModal();
            this.loadFiles(this.uploadTargetId);
        } catch (e) {
            this.showToast('Error', e.body?.message || e.message, 'error');
        }
    }

    openDeleteFileConfirm(evt) {
        this.deleteTarget         = { type: 'file', id: evt.currentTarget.dataset.id };
        this.deleteConfirmMessage = 'Permanently delete this file?';
        this.showDeleteConfirm    = true;
    }

    // ── Delete Confirm ────────────────────────────────────────────────────────
    closeDeleteConfirm() {
        this.showDeleteConfirm = false;
        this.deleteTarget      = null;
    }

    async confirmDelete() {
        try {
            if (this.deleteTarget.type === 'file') {
                await deleteFile({ contentDocumentId: this.deleteTarget.id });
                this.showToast('Deleted', 'File deleted.', 'success');
                this.loadFiles(this.uploadTargetId);
            } else {
                await deleteFolder({ folderId: this.deleteTarget.id });
                this.showToast('Deleted', 'Folder and its contents deleted.', 'success');
                if (this._selectedFolderId === this.deleteTarget.id) {
                    this.selectRoot();
                }
                await refreshApex(this._foldersWireResult);
            }
        } catch (e) {
            this.showToast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.closeDeleteConfirm();
        }
    }

    // ── Toast helper ──────────────────────────────────────────────────────────
    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    connectedCallback() {
        this.loadFiles(this.recordId);
    }
}