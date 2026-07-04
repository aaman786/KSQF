/**
 * @description  Controller for the File Manager LWC component.
 *               Manages Folder__c hierarchy and ContentDocument linking.
 */
public with sharing class FileManagerController {

    // Hardcoded setting: when a file is uploaded into a sub-folder, also link it
    // directly to the host record so it appears in the record's standard Files list.
    private static final Boolean LINK_FILES_TO_PARENT_RECORD = true;

    // ─── Folder Operations ────────────────────────────────────────────────────

    /**
     * Returns all folders for a given record, structured for tree rendering.
     * Returns flat list; JS builds the tree client-side.
     */
    @AuraEnabled(cacheable=true)
    public static List<Folder__c> getFolders(String recordId) {
        return [
            SELECT Id, Name, ParentFolder__c, RecordId__c
            FROM Folder__c
            WHERE RecordId__c = :recordId
            ORDER BY Name ASC
        ];
    }

    @AuraEnabled
    public static Folder__c createFolder(String name, String parentFolderId, String recordId) {
        Folder__c folder = new Folder__c(
            Name        = name,
            RecordId__c = recordId
        );
        if (String.isNotBlank(parentFolderId)) {
            folder.ParentFolder__c = parentFolderId;
        }
        insert folder;
        return folder;
    }

    @AuraEnabled
    public static void renameFolder(String folderId, String newName) {
        Folder__c folder = new Folder__c(Id = folderId, Name = newName);
        update folder;
    }

    @AuraEnabled
    public static void deleteFolder(String folderId) {
        // Recursively collect all child folder IDs first
        List<String> allFolderIds = new List<String>{ folderId };
        collectChildFolderIds(folderId, allFolderIds);

        // Delete all ContentDocumentLinks in those folders
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId IN :allFolderIds
        ];
        if (!links.isEmpty()) {
            List<ContentDocument> docs = new List<ContentDocument>();
            for (ContentDocumentLink link : links) {
                docs.add(new ContentDocument(Id = link.ContentDocumentId));
            }
            delete docs;
        }

        // Delete folders (child first via reverse order)
        List<Folder__c> foldersToDelete = [
            SELECT Id FROM Folder__c WHERE Id IN :allFolderIds
        ];
        delete foldersToDelete;
    }

    private static void collectChildFolderIds(String parentId, List<String> ids) {
        List<Folder__c> children = [
            SELECT Id FROM Folder__c WHERE ParentFolder__c = :parentId
        ];
        for (Folder__c child : children) {
            ids.add(child.Id);
            collectChildFolderIds(child.Id, ids);
        }
    }

    // ─── File Operations ──────────────────────────────────────────────────────

    /**
     * Returns files linked to a specific folder (or root of a record).
     * folderId can be null → returns root-level files for the record.
     */
    @AuraEnabled
    public static List<FileWrapper> getFiles(String linkedEntityId) {
        List<FileWrapper> files = new List<FileWrapper>();
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId,
                   ContentDocument.Title,
                   ContentDocument.FileExtension,
                   ContentDocument.ContentSize,
                   ContentDocument.CreatedDate,
                   ContentDocument.CreatedBy.Name,
                   ContentDocument.LatestPublishedVersionId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :linkedEntityId
            ORDER BY ContentDocument.Title ASC
        ];
        for (ContentDocumentLink link : links) {
            FileWrapper w     = new FileWrapper();
            w.id              = link.ContentDocumentId;
            w.name            = link.ContentDocument.Title;
            w.extension       = link.ContentDocument.FileExtension;
            w.sizeBytes       = link.ContentDocument.ContentSize;
            w.createdDate     = link.ContentDocument.CreatedDate;
            w.createdByName   = link.ContentDocument.CreatedBy.Name;
            w.versionId       = link.ContentDocument.LatestPublishedVersionId;
            files.add(w);
        }
        return files;
    }

    /**
     * When a file is uploaded into a folder, lightning-file-upload only links it to that
     * folder. This links the same files to the host record too, so they also surface in
     * the record's standard Files related list. No-op if the setting is off, or if the
     * file was already uploaded directly against the record (root upload).
     */
    @AuraEnabled
    public static void linkFilesToParentRecord(List<String> contentDocumentIds, String recordId) {
        if (!LINK_FILES_TO_PARENT_RECORD || contentDocumentIds == null || contentDocumentIds.isEmpty()) {
            return;
        }

        Set<String> alreadyLinkedDocIds = new Set<String>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId
            FROM ContentDocumentLink
            WHERE ContentDocumentId IN :contentDocumentIds
            AND LinkedEntityId = :recordId
        ]) {
            alreadyLinkedDocIds.add(link.ContentDocumentId);
        }

        List<ContentDocumentLink> linksToInsert = new List<ContentDocumentLink>();
        for (String docId : contentDocumentIds) {
            if (!alreadyLinkedDocIds.contains(docId)) {
                linksToInsert.add(new ContentDocumentLink(
                    ContentDocumentId = docId,
                    LinkedEntityId    = recordId,
                    ShareType         = 'V',
                    Visibility        = 'AllUsers'
                ));
            }
        }

        if (!linksToInsert.isEmpty()) {
            insert linksToInsert;
        }
    }

    @AuraEnabled
    public static void deleteFile(String contentDocumentId) {
        delete new ContentDocument(Id = contentDocumentId);
    }

    @AuraEnabled
    public static void renameFile(String contentDocumentId, String newTitle) {
        update new ContentDocument(Id = contentDocumentId, Title = newTitle);
    }

    // ─── Inner Wrapper ────────────────────────────────────────────────────────

    public class FileWrapper {
        @AuraEnabled public String   id;
        @AuraEnabled public String   name;
        @AuraEnabled public String   extension;
        @AuraEnabled public Long     sizeBytes;
        @AuraEnabled public DateTime createdDate;
        @AuraEnabled public String   createdByName;
        @AuraEnabled public String   versionId;
    }
}