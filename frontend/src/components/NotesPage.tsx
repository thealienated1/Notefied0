import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, memo } from 'react';
import axios, { AxiosError } from 'axios';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Code from '@tiptap/extension-code';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TrashIcon from './assets/icons/trash.svg';
import PlusIcon from './assets/icons/plus.svg';
import FirstCapIcon from './assets/icons/FirstCap.svg';
import AllCapIcon from './assets/icons/AllCap.svg';
import remixiconUrl from 'remixicon/fonts/remixicon.symbol.svg';
import striptags from 'striptags';
import { debounce } from 'lodash';

// Utility function to strip HTML tags
const stripHtml = (html: string): string => striptags(html);

// Interfaces
interface Note {
  id: number;
  user_id: number;
  title: string;
  content: string;
  updated_at: string;
}

interface TrashedNote extends Note {
  trashed_at: string;
}

interface NotesPageProps {
  token: string;
  setIsTrashView: React.Dispatch<React.SetStateAction<boolean>>;
  fetchNotes: () => Promise<Note[]>;
  fetchTrashedNotes: () => Promise<TrashedNote[]>;
  handleLogout: () => void;
}

interface NoteState {
  notes: Note[];
  selectedNoteId: number | null;
  newContent: string;
  originalContent: string;
  currentTitle: string;
  originalTitle: string;
  isTitleManual: boolean;
  tempDeletedNote: Note | null;
}

type NoteAction =
  | { type: 'SET_NOTES'; payload: Note[] }
  | { type: 'SELECT_NOTE'; payload: { id: number | null; content: string; title: string } }
  | { type: 'UPDATE_CONTENT'; payload: { content: string; tempDeletedNote?: Note | null } }
  | { type: 'SET_TITLE'; payload: { title: string; isManual: boolean } }
  | { type: 'RESET' };

// Reducer for note state
const noteReducer = (state: NoteState, action: NoteAction): NoteState => {
  switch (action.type) {
    case 'SET_NOTES':
      return { ...state, notes: action.payload };
    case 'SELECT_NOTE':
      return {
        ...state,
        selectedNoteId: action.payload.id,
        newContent: action.payload.content,
        originalContent: action.payload.content,
        currentTitle: action.payload.title,
        originalTitle: action.payload.title,
        tempDeletedNote: null,
      };
    case 'UPDATE_CONTENT':
      return {
        ...state,
        newContent: action.payload.content,
        tempDeletedNote: action.payload.tempDeletedNote ?? state.tempDeletedNote,
      };
    case 'SET_TITLE':
      return {
        ...state,
        currentTitle: action.payload.title,
        isTitleManual: action.payload.isManual,
      };
    case 'RESET':
      return {
        ...state,
        selectedNoteId: null,
        newContent: '',
        originalContent: '',
        currentTitle: '',
        originalTitle: '',
        isTitleManual: false,
        tempDeletedNote: null,
      };
    default:
      return state;
  }
};

// Debounce utility
const debounceFn = <T extends (...args: any[]) => any>(fn: T, delay: number) =>
  debounce(fn, delay, { leading: false, trailing: true });

// Parse note content for display
const parseNoteContent = (content: string): string => {
  if (!content) return '(No content)';
  try {
    const doc = new DOMParser().parseFromString(content, 'text/html');
    const paragraphs = Array.from(doc.querySelectorAll('p'))
      .map(p => p.textContent?.trim())
      .filter(Boolean);
    return paragraphs.slice(0, 2).join('\n') || '(No content)';
  } catch {
    return '(Invalid content)';
  }
};

// Memoized Note Tile component
interface NoteTileProps {
  note: Note;
  isSelected: boolean;
  onSelect: (id: number, content: string, title: string) => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>, noteId: number) => void;
  formatDate: (dateString: string) => string;
}

const NoteTile = memo(({ note, isSelected, onSelect, onContextMenu, formatDate }: NoteTileProps) => {
  return (
    <div
      className={`note-tile relative w-full h-[15vh] bg-[#1F1F1F] p-2 rounded-[15px] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)] mb-3 cursor-pointer hover:bg-[#383838] ${
        isSelected ? 'bg-[#2a2a2a]' : ''
      }`}
      onClick={e => {
        e.stopPropagation();
        onSelect(note.id, note.content, note.title);
      }}
      onContextMenu={e => onContextMenu(e, note.id)}
    >
      <div
        className={`absolute left-1 top-[12px] h-[96px] bg-gradient-to-b from-[#2996FC] via-[#1238D4] to-[#592BFF] ${
          isSelected ? 'w-[4px]' : 'w-0'
        } transition-all duration-300 rounded-[4px]`}
      ></div>
      <div className={`transition-all duration-300 ${isSelected ? 'ml-[7px]' : 'ml-0'}`}>
        <strong className="text-white note-title">{stripHtml(note.title) || '(Untitled)'}</strong>
        <p className="text-gray-400 note-content">{parseNoteContent(note.content)}</p>
      </div>
      <span className="absolute bottom-1 right-2 text-[10px] text-gray-500">{formatDate(note.updated_at)}</span>
    </div>
  );
});

const NotesPage: React.FC<NotesPageProps> = memo(({ token, setIsTrashView, fetchNotes, fetchTrashedNotes, handleLogout }) => {
  const [state, dispatch] = React.useReducer(noteReducer, {
    notes: [],
    selectedNoteId: null,
    newContent: '',
    originalContent: '',
    currentTitle: '',
    originalTitle: '',
    isTitleManual: false,
    tempDeletedNote: null,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ noteId: number; x: number; y: number } | null>(null);
  const [taskbarPosition, setTaskbarPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isFirstCapActive, setIsFirstCapActive] = useState(false);
  const [isAllCapActive, setIsAllCapActive] = useState(false);
  const taskbarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tiptap editor setup with debounced update
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { HTMLAttributes: { class: 'list-disc pl-5' } },
        orderedList: { HTMLAttributes: { class: 'list-decimal pl-5' } },
        heading: { levels: [1, 2, 3, 4] },
      }),
      Image,
      Underline,
      TextStyle,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Code,
      Link,
      Placeholder.configure({ placeholder: 'Start typing...' }),
    ],
    content: '',
    onUpdate: debounceFn(({ editor }) => {
      const content = editor.getHTML();
      dispatch({ type: 'UPDATE_CONTENT', payload: { content } });
    }, 300),
  });

  // Load notes on mount
  useEffect(() => {
    let isMounted = true;
    fetchNotes()
      .then(notes => isMounted && dispatch({ type: 'SET_NOTES', payload: notes }))
      .catch(error => {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          handleLogout();
        } else {
          console.error('Failed to fetch notes:', error);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [fetchNotes, handleLogout]);

  // Update editor content when selected note changes
  useEffect(() => {
    if (editor) {
      if (state.selectedNoteId === null) {
        editor.commands.setContent('');
        dispatch({ type: 'SET_TITLE', payload: { title: '', isManual: false } });
      } else {
        const note = state.notes.find(n => n.id === state.selectedNoteId);
        if (note) {
          editor.commands.setContent(note.content, false, { preserveWhitespace: 'full' });
          editor.commands.focus();
        }
      }
    }
  }, [state.selectedNoteId, state.notes, editor]);

  // Auto-generate title
  const generateTitle = useCallback((html: string): string => {
    if (!html || html.trim() === '<p></p>') return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    for (const h1 of doc.querySelectorAll('h1')) {
      const text = h1.textContent?.trim();
      if (text) return text;
    }
    for (const p of doc.querySelectorAll('p')) {
      const text = p.textContent?.trim();
      if (text) return text;
    }
    return '';
  }, []);

  useEffect(() => {
    if (!state.isTitleManual && editor) {
      const title = generateTitle(state.newContent);
      dispatch({ type: 'SET_TITLE', payload: { title, isManual: false } });
    }
  }, [state.newContent, state.isTitleManual, editor, generateTitle]);

  // Debug log (simplified)
  useEffect(() => {
    const buttons = [
      { name: 'First Cap', active: isFirstCapActive },
      { name: 'All Cap', active: isAllCapActive },
      { name: 'Bold', active: editor?.isActive('bold') },
      { name: 'Bullet List', active: editor?.isActive('bulletList') },
    ];
    console.log('Button states:', buttons);
    const editorInput = document.querySelector('.editor-input');
    console.log('Editor styling:', { paddingLeft: editorInput ? getComputedStyle(editorInput).paddingLeft : 'none' });
    console.log('Search performance:', { searchQuery, filterQuery, filteredNotes: filteredNotes.length });
  }, [editor, isFirstCapActive, isAllCapActive, state.newContent, searchQuery, filterQuery]);

  // Format date
  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return `${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}, ${date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })}`;
  }, []);

  // Precompute searchable text for notes
  const searchableNotes = React.useMemo(
    () =>
      state.notes.map(note => ({
        ...note,
        searchTitle: stripHtml(note.title).toLowerCase(),
        searchContent: stripHtml(note.content).toLowerCase(),
      })),
    [state.notes]
  );

  // Filter and sort notes (debounced)
  const filteredNotes = React.useMemo(() => {
    const query = filterQuery.toLowerCase();
    return searchableNotes
      .filter(note => note.searchTitle.includes(query) || note.searchContent.includes(query))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [searchableNotes, filterQuery]);

  // Debounced filter update
  const updateFilterQuery = React.useMemo(
    () =>
      debounceFn((value: string) => {
        setFilterQuery(value);
      }, 200),
    []
  );

  // Handle search input
  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value);
      updateFilterQuery(value);
    },
    [updateFilterQuery]
  );

  // Add a new note
  const addNote = useCallback(async () => {
    if (!token || !state.newContent.trim()) return;
    try {
      const response = await axios.post<Note>(
        `${import.meta.env.VITE_NOTES_SERVICE_URL || 'http://localhost:3002'}/notes`,
        { title: state.currentTitle, content: state.newContent },
        { headers: { Authorization: token } }
      );
      dispatch({
        type: 'SET_NOTES',
        payload: [response.data, ...state.notes].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
      });
      dispatch({ type: 'SELECT_NOTE', payload: { id: response.data.id, content: state.newContent, title: response.data.title } });
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        handleLogout();
      } else {
        console.error('Add note error:', axiosError.message);
        alert('Failed to add note');
      }
    }
  }, [token, state.newContent, state.currentTitle, state.notes, handleLogout]);

  // Reset note state
  const resetNoteState = useCallback(() => {
    dispatch({ type: 'RESET' });
    editor?.commands.setContent('');
    editor?.commands.focus();
  }, [editor]);

  // Delete a note
  const deleteNote = useCallback(
    async (id: number) => {
      if (!token) return;
      try {
        await axios.delete(`${import.meta.env.VITE_NOTES_SERVICE_URL || 'http://localhost:3002'}/notes/${id}`, { headers: { Authorization: token } });
        dispatch({ type: 'SET_NOTES', payload: state.notes.filter(note => note.id !== id) });
        await fetchTrashedNotes();
        if (state.selectedNoteId === id) resetNoteState();
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          handleLogout();
        } else {
          console.error('Delete note error:', axiosError.message);
          alert('Failed to move note to trash');
          await fetchNotes().then(notes => dispatch({ type: 'SET_NOTES', payload: notes }));
          await fetchTrashedNotes();
        }
      }
    },
    [token, state.notes, state.selectedNoteId, fetchTrashedNotes, fetchNotes, resetNoteState, handleLogout]
  );

  // Save edits
  const saveEdit = useCallback(async () => {
    if (!token || typeof state.selectedNoteId !== 'number') return;
    const contentToSave = state.newContent;
    const titleToSave = state.currentTitle || generateTitle(contentToSave);
    if (contentToSave === '' && state.tempDeletedNote) {
      dispatch({ type: 'RESET' });
      return;
    }
    try {
      const response = await axios.put<Note>(
        `${import.meta.env.VITE_NOTES_SERVICE_URL || 'http://localhost:3002'}/notes/${state.selectedNoteId}`,
        { title: titleToSave, content: contentToSave },
        { headers: { Authorization: token } }
      );
      dispatch({
        type: 'SET_NOTES',
        payload: state.notes
          .map(note =>
            note.id === state.selectedNoteId
              ? { ...note, title: titleToSave, content: contentToSave, updated_at: response.data.updated_at }
              : note
          )
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
      });
      dispatch({ type: 'SELECT_NOTE', payload: { id: state.selectedNoteId, content: contentToSave, title: titleToSave } });
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        handleLogout();
      } else {
        console.error('Update note error:', axiosError.message);
      }
    }
  }, [token, state.selectedNoteId, state.newContent, state.currentTitle, state.notes, state.tempDeletedNote, generateTitle, handleLogout]);

  // Debounced auto-save
  const debouncedSave = React.useMemo(
    () =>
      debounceFn(() => {
        if (!token || !state.newContent.trim()) return;
        if (state.selectedNoteId === null) {
          addNote();
        } else if (
          typeof state.selectedNoteId === 'number' &&
          (state.newContent !== state.originalContent || state.currentTitle !== state.originalTitle)
        ) {
          saveEdit();
          if (editor && editor.getHTML() !== state.newContent) {
            const { from, to } = editor.state.selection;
            editor.commands.setContent(state.newContent, false, { preserveWhitespace: 'full' });
            editor.commands.setTextSelection({ from, to });
          }
        }
      }, 2000),
    [token, state.newContent, state.selectedNoteId, state.originalContent, state.currentTitle, state.originalTitle, addNote, saveEdit, editor]
  );

  useEffect(() => {
    debouncedSave();
    return () => debouncedSave.cancel();
  }, [state.newContent, state.currentTitle, debouncedSave]);

  // Handle context menu
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>, noteId: number) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.right - 2;
    const y = rect.top + 10 > window.innerHeight - 100 ? rect.top - 100 : rect.top + 10;
    setContextMenu({ noteId, x, y });
  }, []);

  // Taskbar positioning
  useLayoutEffect(() => {
    const updateTaskbarPosition = () => {
      if (containerRef.current && taskbarRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const styles = window.getComputedStyle(containerRef.current);
        const paddingRight = parseFloat(styles.paddingRight) || 0;
        const taskbarWidth = containerRect.width * 0.34; // 80% of editor container width
        const boundaryOffset = 5;
        setTaskbarPosition({
          x: Math.max(boundaryOffset, containerRect.width - taskbarWidth - paddingRight - boundaryOffset),
          y: boundaryOffset,
        });
      }
    };
    updateTaskbarPosition();
    window.addEventListener('resize', updateTaskbarPosition);
    return () => window.removeEventListener('resize', updateTaskbarPosition);
  }, []);

  // Handle taskbar dragging
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (taskbarRef.current) {
      const rect = taskbarRef.current.getBoundingClientRect();
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setIsDragging(true);
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && containerRef.current && taskbarRef.current) {
        e.preventDefault();
        const containerRect = containerRef.current.getBoundingClientRect();
        const styles = window.getComputedStyle(containerRef.current);
        const paddingRight = parseFloat(styles.paddingRight) || 0;
        const paddingBottom = parseFloat(styles.paddingBottom) || 0;
        const taskbarWidth = containerRect.width * 0.34; // 80% of editor container width
        const taskbarHeight = 32;
        const boundaryOffset = 10;
        setTaskbarPosition({
          x: Math.max(
            boundaryOffset,
            Math.min(e.clientX - dragOffset.x - containerRect.left, containerRect.width - taskbarWidth - paddingRight - boundaryOffset)
          ),
          y: Math.max(
            boundaryOffset,
            Math.min(e.clientY - dragOffset.y - containerRect.top, containerRect.height - taskbarHeight - paddingBottom - boundaryOffset)
          ),
        });
      }
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Formatting functions
  const capitalizeFirst = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const tr = editor.state.tr;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isText && node.text) {
        const newText = node.text.replace(/\b\w+\b/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
        tr.insertText(newText, pos, pos + node.text.length);
      }
    });
    editor.view.dispatch(tr);
    editor.commands.focus();
    setIsFirstCapActive(true);
    setTimeout(() => setIsFirstCapActive(false), 100);
  }, [editor]);

  const capitalizeAll = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const tr = editor.state.tr;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isText && node.text) {
        const newText = node.text.toUpperCase();
        tr.insertText(newText, pos, pos + node.text.length);
      }
    });
    editor.view.dispatch(tr);
    editor.commands.focus();
    setIsAllCapActive(true);
    setTimeout(() => setIsAllCapActive(false), 100);
  }, [editor]);

  const applyTextFormat = useCallback(
    (format: 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code') => {
      editor?.chain().focus().toggleMark(format).run();
    },
    [editor]
  );

  const toggleBulletList = useCallback(() => {
    if (!editor) return;
    editor.isActive('bulletList')
      ? editor.chain().focus().liftListItem('listItem').setParagraph().run()
      : editor.chain().focus().toggleBulletList().run();
  }, [editor]);

  const setTextAlignment = useCallback(
    (alignment: 'left' | 'center' | 'right') => {
      editor?.chain().focus().setTextAlign(alignment).run();
    },
    [editor]
  );

  const setHeadingLevel = useCallback(
    (level: number | null) => {
      if (!editor) return;
      level === null
        ? editor.chain().focus().setParagraph().run()
        : editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 }).run();
    },
    [editor]
  );

  // Handle note selection
  const handleNoteSelect = useCallback(
    (id: number, content: string, title: string) => {
      if (id !== state.selectedNoteId) {
        dispatch({ type: 'SELECT_NOTE', payload: { id, content, title } });
        editor?.commands.focus();
      }
    },
    [state.selectedNoteId, editor]
  );

  return (
    <div className="flex w-full max-w-full h-full" onClick={() => setContextMenu(null)}>
      <style>
        {`
          .custom-scrollbar::-webkit-scrollbar { width: 8px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #888; border-radius: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
          .custom-scrollbar { scrollbar-width: thin; scrollbar-color: #888 transparent; }
          .note-tile { transition: all 0.3s; }
          .note-title {
            display: -webkit-box;
            -webkit-line-clamp: 1;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            max-height: 1.5em;
            font-size: 14px;
          }
          .note-content {
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            max-height: 4.5em;
            font-size: 12px;
            white-space: pre-line;
          }
          .editor-container { position: relative; height: 100%; width: 100%; overflow: hidden; }
          .editor-input {
            height: 100%;
            width: 100%;
            padding: 10px 10px 10px 20px;
            overflow-y: auto;
            overflow-x: auto;
            scrollbar-width: thin;
            scrollbar-color: #888 transparent;
            box-sizing: border-box;
            white-space: pre-wrap;
            background: linear-gradient(to bottom, #191919, #141414);
            border: 1px solid #5062E7;
            border-radius: 15px;
            color: white;
          }
          .editor-input::-webkit-scrollbar { width: 8px; height: 8px; }
          .editor-input::-webkit-scrollbar-track { background: transparent; }
          .editor-input::-webkit-scrollbar-thumb { background: #888; border-radius: 4px; }
          .editor-input::-webkit-scrollbar-thumb:hover { background: #555; }
          .editor-input:focus { border-color: #5062E7; outline: none; }
          .no-arrow { -webkit-appearance: none; -moz-appearance: none; appearance: none; text-align: center; }
          .editor-input ul { color: white; margin: 0; padding-left: 20px; }
          .editor-input ul li { color: white; margin: 0; }
          .editor-input ul li::marker { color: white; }
          .editor-input u { color: white; text-decoration: underline white; }
          .editor-input s { color: white; text-decoration: line-through white; }
          .editor-input .ProseMirror::before { color: #6b7280; }
          .editor-input .ProseMirror-focused { border: none !important; outline: none !important; }
          .editor-input h1 { font-size: 2em; font-weight: bold; margin: 0.67em 0; }
          .editor-input h2 { font-size: 1.5em; font-weight: bold; margin: 0.83em 0; }
          .editor-input h3 { font-size: 1.17em; font-weight: bold; margin: 1em 0; }
          .editor-input h4 { font-size: 1em; font-weight: bold; margin: 1.33em 0; }
          .editor-input .ProseMirror code {
            font-family: monospace;
            color: #787878;
            padding: 2px 4px;
            margin-left: 10px;
            display: inline-block;
          }
          .editor-input .ProseMirror mark {
            background-color: rgb(116, 96, 250);
            color: rgb(255, 255, 255);
            border-radius: 6px;
            padding: 2px 4px;
          }
          .taskbar {
            position: absolute;
            width: 34%;
            height: 32px;
            border-radius: 15px;
            background-color: #252525;
            cursor: pointer;
            display: flex;
            align-items: center;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4);
            z-index: 10;
            pointer-events: auto;
            user-select: none;
            padding: 0 25px;
            gap: 10px;
          }
          .taskbar-button.active svg { fill: #4ade80; }
          .taskbar-button:hover svg { fill: #6ee7b7; }
          .taskbar-button.active img { filter: hue-rotate(90deg) brightness(1.2); }
          .taskbar-button:hover img { filter: hue-rotate(90deg) brightness(1.4); }
          .heading-select.active { background-color: rgba(74, 222, 128, 0.5); }
          .heading-select:hover { background-color: rgba(110, 231, 183, 0.5); }
          .taskbar-button svg, .taskbar-button img { transition: fill 0.2s, filter 0.2s; }
          .search-input {
            height: 35px;
            width: 100%;
            background-color: #252525;
            color: white;
            padding: 0 16px;
            border-radius: 20px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4);
            transition: all 0.3s;
          }
          .search-input:focus { outline: none; border: 0.5px solid #5062E7; }
          .sidebar-button {
            width: 45px;
            height: 45px;
            background-color: #1F1F1F;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4);
            transition: background-color 0.3s;
          }
          .sidebar-button:hover { background-color: #383838; }
          .context-menu {
            position: absolute;
            background-color: #1F1F1F;
            color: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4);
            width: 120px;
            display: flex;
            flex-direction: column;
            padding: 8px 0;
            z-index: 50;
            transition: all 0.3s;
          }
          .context-menu-button {
            width: 100px;
            height: 25px;
            margin: 2px auto;
            text-align: left;
            padding-left: 12px;
            font-size: 14px;
            border-radius: 13px;
            background: transparent;
            color: white;
            border: none;
            cursor: pointer;
          }
          .context-menu-button:hover {
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4);
            background-color: #383838;
          }
          .context-menu-button.delete { color: #f87171; }
        `}
      </style>
      <div className="w-[20%] flex flex-col flex-shrink-0 h-full relative">
        <div className="flex-shrink-0">
          <input
            type="text"
            placeholder="Search Notes"
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            className="search-input mt-[10px]"
          />
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar mt-[10px] pb-20 pr-1">
          {!filteredNotes.length && !state.tempDeletedNote && <p className="text-center text-gray-500 mt-10">No notes yet.</p>}
          {filteredNotes.map(note => (
            <NoteTile
              key={note.id}
              note={note}
              isSelected={note.id === state.selectedNoteId}
              onSelect={handleNoteSelect}
              onContextMenu={handleContextMenu}
              formatDate={formatDate}
            />
          ))}
        </div>
        <div className="absolute bottom-[5px] left-0 right-2 h-18 flex items-center justify-end pr-4 z-10 backdrop-blur-sm rounded-[30px]">
          <button onClick={() => { setIsTrashView(true); setSearchQuery(''); setFilterQuery(''); }} className="sidebar-button mr-6">
            <img src={TrashIcon} alt="Trash" className="w-7 h-7" />
          </button>
          <button onClick={resetNoteState} className="sidebar-button">
            <img src={PlusIcon} alt="Add" className="w-7 h-7" />
          </button>
        </div>
      </div>
      <div className="flex-1 flex flex-col ml-[5px]">
        <div className="h-[55px] w-full flex-shrink-0"></div>
        <div ref={containerRef} className="flex-1 editor-container">
          <EditorContent editor={editor} className="editor-input" onClick={() => editor?.commands.focus()} />
          <div
            ref={taskbarRef}
            className="taskbar"
            style={{ left: taskbarPosition.x + 'px', top: taskbarPosition.y + 'px' }}
            onMouseDown={handleMouseDown}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className={`taskbar-button first-cap-btn ${isFirstCapActive ? 'active' : ''}`}
                style={{ width: '27px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={capitalizeFirst}
                onMouseDown={e => e.stopPropagation()}
              >
                <img src={FirstCapIcon} alt="First Cap" style={{ width: '27px', height: '16px', pointerEvents: 'none' }} />
              </button>
              <button
                className={`taskbar-button all-cap-btn ${isAllCapActive ? 'active' : ''}`}
                style={{ width: '28px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={capitalizeAll}
                onMouseDown={e => e.stopPropagation()}
              >
                <img src={AllCapIcon} alt="All Cap" style={{ width: '28px', height: '16px', pointerEvents: 'none' }} />
              </button>
              <select
                className={`no-arrow heading-select ${editor?.isActive('heading') ? 'active' : ''}`}
                style={{ width: '30px', height: '25px', backgroundColor: '#171717', borderRadius: '6px', color: '#FFFFFF', border: 'none', outline: 'none', cursor: 'pointer', textAlign: 'center' }}
                onChange={e => setHeadingLevel(e.target.value === '' ? null : Number(e.target.value))}
                onMouseDown={e => e.stopPropagation()}
              >
                <option value="">P</option>
                <option value="1">H1</option>
                <option value="2">H2</option>
                <option value="3">H3</option>
                <option value="4">H4</option>
              </select>
            </div>
            <div style={{ width: '1px', height: '20px', backgroundColor: '#888', margin: '0 8px' }}></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className={`taskbar-button bold-btn ${editor?.isActive('bold') ? 'active' : ''}`}
                style={{ width: '19px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => applyTextFormat('bold')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="19" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('bold') ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-bold`} />
                </svg>
              </button>
              <button
                className={`taskbar-button italic-btn ${editor?.isActive('italic') ? 'active' : ''}`}
                style={{ width: '18px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => applyTextFormat('italic')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="18" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('italic') ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-italic`} />
                </svg>
              </button>
              <button
                className={`taskbar-button underline-btn ${editor?.isActive('underline') ? 'active' : ''}`}
                style={{ width: '16px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => applyTextFormat('underline')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="16" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('underline') ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-underline`} />
                </svg>
              </button>
              <button
                className={`taskbar-button strike-btn ${editor?.isActive('strike') ? 'active' : ''}`}
                style={{ width: '36px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => applyTextFormat('strike')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="36" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('strike') ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-strikethrough`} />
                </svg>
              </button>
              <button
                className={`taskbar-button highlight-btn ${editor?.isActive('highlight') ? 'active' : ''}`}
                style={{ width: '18px', height: '18px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => applyTextFormat('highlight')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="18" height="18" style={{ pointerEvents: 'none', fill: editor?.isActive('highlight') ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-mark-pen-line`} />
                </svg>
              </button>
            </div>
            <div style={{ width: '1px', height: '20px', backgroundColor: '#888', margin: '0 8px' }}></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className={`taskbar-button bullet-btn ${editor?.isActive('bulletList') ? 'active' : ''}`}
                style={{ width: '16px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={toggleBulletList}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="16" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('bulletList') ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-list-unordered`} />
                </svg>
              </button>
            </div>
            <div style={{ width: '1px', height: '20px', backgroundColor: '#888', margin: '0 8px' }}></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className={`taskbar-button align-left-btn ${editor?.isActive('textAlign', { align: 'left' }) ? 'active' : ''}`}
                style={{ width: '16px', height: '16px', padding: 'none', border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => setTextAlignment('left')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="16" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('textAlign', { align: 'left' }) ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-align-left`} />
                </svg>
              </button>
              <button
                className={`taskbar-button align-center-btn ${editor?.isActive('textAlign', { align: 'center' }) ? 'active' : ''}`}
                style={{ width: '16px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => setTextAlignment('center')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="16" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('textAlign', { align: 'center' }) ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-align-center`} />
                </svg>
              </button>
              <button
                className={`taskbar-button align-right-btn ${editor?.isActive('textAlign', { align: 'right' }) ? 'active' : ''}`}
                style={{ width: '16px', height: '16px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => setTextAlignment('right')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="16" height="16" style={{ pointerEvents: 'none', fill: editor?.isActive('textAlign', { align: 'right' }) ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-align-right`} />
                </svg>
              </button>
            </div>
            <div style={{ width: '1px', height: '20px', backgroundColor: '#888', margin: '0 8px' }}></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className={`taskbar-button code-btn ${editor?.isActive('code') ? 'active' : ''}`}
                style={{ width: '18px', height: '18px', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                onClick={() => applyTextFormat('code')}
                onMouseDown={e => e.stopPropagation()}
              >
                <svg width="18" height="18" style={{ pointerEvents: 'none', fill: editor?.isActive('code') ? '#4ade80' : '#FFFFFF' }}>
                  <use href={`${remixiconUrl}#ri-code-view`} />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const note = state.notes.find(n => n.id === contextMenu.noteId);
              if (note) {
                dispatch({ type: 'SELECT_NOTE', payload: { id: note.id, content: note.content, title: note.title } });
                editor?.commands.focus();
              }
              setContextMenu(null);
            }}
            className="context-menu-button"
          >
            Edit
          </button>
          <button onClick={() => { alert('Pin not implemented.'); setContextMenu(null); }} className="context-menu-button">
            Pin
          </button>
          <button onClick={() => { deleteNote(contextMenu.noteId); setContextMenu(null); }} className="context-menu-button delete">
            Delete
          </button>
        </div>
      )}
    </div>
  );
});

export default NotesPage;