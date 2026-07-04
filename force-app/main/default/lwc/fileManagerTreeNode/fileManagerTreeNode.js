import { LightningElement, api, track } from 'lwc';

export default class FileManagerTreeNode extends LightningElement {

    @api node;
    @api selectedId;
    @api depth = 0;

    @track isExpanded = false;

    // ── Computed ──────────────────────────────────────────────────────────────
    get nodeClass() {
        const active = this.selectedId === this.node.id ? ' ftn-node--active' : '';
        return `ftn-node${active}`;
    }

    get chevronIcon() {
        if (!this.node.children || this.node.children.length === 0) {
            return 'utility:dash';
        }
        return this.isExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get folderIcon() {
        return this.isExpanded ? 'utility:open_folder' : 'utility:folder';
    }

    get indentStyle() {
        return `width:${this.depth * 16}px; display:inline-block;`;
    }

    get childDepth() {
        return this.depth + 1;
    }

    // ── Handlers ──────────────────────────────────────────────────────────────
    onNodeClick(evt) {
        evt.stopPropagation();
        // Build ancestor chain for breadcrumb
        this.dispatchEvent(new CustomEvent('folderselect', {
            bubbles  : true,
            composed : true,
            detail   : {
                id        : this.node.id,
                name      : this.node.name,
                ancestors : [],   // parent nodes fill this as it bubbles up
            },
        }));
    }

    toggleExpand(evt) {
        evt.stopPropagation();
        if (this.node.children && this.node.children.length > 0) {
            this.isExpanded = !this.isExpanded;
        }
    }

    onNewSubFolder(evt) {
        evt.stopPropagation();
        this.dispatchEvent(new CustomEvent('newfolder', {
            bubbles  : true,
            composed : true,
            detail   : { parentId: this.node.id },
        }));
    }

    onRename(evt) {
        evt.stopPropagation();
        this.dispatchEvent(new CustomEvent('renamefolder', {
            bubbles  : true,
            composed : true,
            detail   : { id: this.node.id, name: this.node.name },
        }));
    }

    onDelete(evt) {
        evt.stopPropagation();
        this.dispatchEvent(new CustomEvent('deletefolder', {
            bubbles  : true,
            composed : true,
            detail   : { id: this.node.id, name: this.node.name },
        }));
    }

    // Bubble events from nested children up through this node
    bubbleEvent(evt) {
        evt.stopPropagation();
        const detail = { ...evt.detail };

        // If this is a folderselect, prepend self as ancestor
        if (evt.type === 'folderselect' && detail.id !== this.node.id) {
            detail.ancestors = [
                { id: this.node.id, name: this.node.name },
                ...(detail.ancestors || []),
            ];
        }

        this.dispatchEvent(new CustomEvent(evt.type, {
            bubbles  : true,
            composed : true,
            detail,
        }));
    }

    stopProp(evt) {
        evt.stopPropagation();
    }
}