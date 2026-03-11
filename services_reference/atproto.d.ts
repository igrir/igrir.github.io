declare module '@/services/atproto' {
    export interface NoteBlock {
        type: 'text' | 'h1' | 'h2' | 'h3' | 'quote' | 'code' | 'spacer' | 'image';
        content: string;
        language?: string;
        caption?: string;
        blob?: any;
        pendingFile?: File;
    }

    export interface NoteRecord {
        title: string;
        blocks: NoteBlock[];
        createdAt: string;
        isDraft?: boolean;
        tags?: string[];
    }

    export interface Note {
        uri: string;
        cid: string;
        author: {
            handle: string;
            did: string;
            displayName?: string;
            avatar?: string;
        };
        value: NoteRecord;
        indexedAt: string;
    }

    export interface AtprotoService {
        getNotes(repo: string): Promise<Note[]>;
        getNote(uri: string): Promise<Note>;
        createNote(title: string, blocks: NoteBlock[], tags?: string[], isDraft?: boolean): Promise<any>;
        updateNote(rkey: string, title: string, blocks: NoteBlock[], createdAt: string, tags?: string[], isDraft?: boolean): Promise<any>;
        deleteNote(rkey: string): Promise<any>;
        uploadBlob(file: File): Promise<any>;
        getPostThread(uri: string): Promise<any>;
        getFeedGenerator(uri: string): Promise<any>;
        getStarterPack(uri: string): Promise<any>;
        getList(uri: string): Promise<any>;
    }

    export const atproto: AtprotoService;
}
